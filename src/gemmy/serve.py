"""`gemmy serve`: a local live previewer. Edit the config, save, the browser (and optionally a Blender image) updates.

Stdlib only; compile code is imported lazily inside `compile_build`. One `Preview` owns the state: it polls the
watched files, recompiles on change, keeps the last good scene, and wakes the server's event streams. A compile
error never replaces the last good scene; it is reported in the status until the next good compile. An optional
render step (a callable taking a scene.json path) runs in its own thread, never twice at once, and coalesces: a
compile that lands during a render triggers exactly one more render, with the latest scene.
"""

from __future__ import annotations

import dataclasses
import json
import re
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from collections.abc import Callable, Sequence
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .datafile import read_data
from .view import bounds_dict, render_live_page, validate_scene_dict

Stamp = tuple[tuple[str, int | None, int | None], ...]


def _stamp(paths: list[Path]) -> Stamp:
    out = []
    for path in paths:
        try:
            st = path.stat()
            out.append((str(path), st.st_mtime_ns, st.st_size))
        except OSError:
            out.append((str(path), None, None))
    return tuple(out)


def _message(exc: BaseException) -> str:
    text = str(exc).strip()
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__


# ---- what to build and what to watch ----


def scene_file_build(path: Path) -> tuple[Callable[[], dict[str, Any]], Callable[[], list[Path]]]:
    """Serve a fixed scene.json: re-read and validate it when it changes."""

    def build() -> dict[str, Any]:
        data = json.loads(path.read_text(encoding="utf-8"))
        validate_scene_dict(data)
        return data

    return build, lambda: [path]


def compile_build(
    config: Path, poscar: Path | None = None
) -> tuple[Callable[[], dict[str, Any]], Callable[[], list[Path]]]:
    """Compile the config (its structure, or `poscar` if given); watch the config, the structure and the files the
    config points to (relative to the config folder)."""

    def build() -> dict[str, Any]:
        from .compile.pipeline import compile_scene_from_files
        from .config import scene_to_dict

        return scene_to_dict(compile_scene_from_files(config, poscar))

    def watch() -> list[Path]:
        paths = [config] + ([poscar] if poscar is not None else [])
        try:
            raw = read_data(config)
            named = [raw.get("structure")] if poscar is None else []
            for section, key in (("labels", "file"), ("displacements", "data_file")):
                named.append((raw.get(section) or {}).get(key))
            for name in named:
                if isinstance(name, str) and name:
                    paths.append(config.resolve().parent / name)
        except Exception:  # noqa: BLE001  # an unreadable config is reported by build(); watch what we know
            pass
        return paths

    return build, watch


class BlenderRender:
    """The render step for `gemmy render`'s settings: resolve a plan for the scene, run Blender in the background.

    `use_view` swaps in the camera and cell box of a view exported from the page."""

    def __init__(self, blender: str, settings: Any, output: Path) -> None:
        self.blender = blender
        self.settings = dataclasses.replace(settings, out=str(Path(output).resolve()))

    def use_view(self, raw: dict[str, Any]) -> None:
        """Take `camera` and `cell_box` from page-exported render settings; ValueError names a bad key."""
        from .config import validate_settings

        view = validate_settings(raw)
        self.settings = dataclasses.replace(self.settings, camera=view.camera, cell_box=view.cell_box)

    def __call__(self, scene_path: Path) -> None:
        from .render.launch import build_command

        plan = json.dumps(dataclasses.asdict(self.settings.resolve(str(scene_path))), indent=2)
        with tempfile.TemporaryDirectory(prefix="gemmy-serve-") as tmp:
            plan_path = Path(tmp) / "plan.json"
            plan_path.write_text(plan, encoding="utf-8")
            result = subprocess.run(build_command(self.blender, str(plan_path)), capture_output=True, text=True)
        if result.returncode != 0:
            tail = "\n".join((result.stderr or result.stdout).strip().splitlines()[-12:])
            raise RuntimeError(f"Blender exited with {result.returncode}\n{tail}")


# ---- the live state ----


class Preview:
    def __init__(
        self,
        build: Callable[[], dict[str, Any]],
        watch: Callable[[], list[Path]],
        title: str,
        subtitle: str = "",
        render: Callable[[Path], None] | None = None,
        render_output: str = "image",
        scene_file: str = "scene.json",
        apply_view: Callable[[dict[str, Any]], None] | None = None,
        poll: float = 0.5,
        tabs: Sequence[tuple[str, str]] = (),
        tab: int = 0,
    ) -> None:
        """`tabs` is (name, "k") for every preview the server holds (the k-th is served at /k/); this one is `tab`."""
        self._build, self._watch, self._render, self.poll = build, watch, render, poll
        self._apply_view = apply_view
        self.page = render_live_page(title, subtitle, scene_file, tabs, tab).encode("utf-8")
        self.cond = threading.Condition()
        self.closed = False
        self.seq = 0
        self._token = time.time_ns()
        self._scene: bytes | None = None
        self._bounds = ""
        self._version: str | None = None
        self._error: str | None = None
        self._render_state = {
            "enabled": render is not None,
            "state": "idle",
            "output": render_output,
            "time": None,
            "error": None,
        }
        self._render_pending = False
        self._tmp = tempfile.TemporaryDirectory(prefix="gemmy-serve-")
        self._threads: list[threading.Thread] = []
        self._stamp: Stamp = ()

    # -- reading
    def scene_bytes(self) -> tuple[bytes, str] | None:
        """The scene and its framing bounds (JSON text), taken together so they always belong to one version."""
        with self.cond:
            return None if self._scene is None else (self._scene, self._bounds)

    def status(self) -> dict[str, Any]:
        with self.cond:
            return self._status_locked()

    def _status_locked(self) -> dict[str, Any]:
        return {"version": self._version, "error": self._error, "render": dict(self._render_state)}

    def _changed(self) -> None:  # call with the lock held
        self.seq += 1
        self.cond.notify_all()

    # -- compiling
    def recompile(self) -> bool:
        """Build the scene now. A failure keeps the last good scene and records the error. True if it built."""
        self._stamp = _stamp(self._watch())
        try:
            scene = self._build()
            body = json.dumps(scene).encode("utf-8")
            bounds = json.dumps(bounds_dict(scene))
        except Exception as exc:  # noqa: BLE001  # whatever the user typed must not kill the server
            message = _message(exc)
            print(f"error: {message}", file=sys.stderr, flush=True)
            with self.cond:
                self._error = message
                self._changed()
            return False
        with self.cond:
            self._scene = body
            self._bounds = bounds
            self._error = None
            self._version = f"{self._token}-{self.seq + 1}"
            self._render_pending = self._render is not None
            self._changed()
        return True

    def _watch_loop(self) -> None:
        while not self.closed:
            time.sleep(self.poll)
            if self.closed:
                return
            if _stamp(self._watch()) != self._stamp:
                self.recompile()

    # -- rendering
    def render_view(self, raw: Any) -> None:
        """Use the camera and cell box of `raw` (render settings JSON) and render again, coalesced like a compile.

        Raises LookupError when serve was not started with --render or there is no scene yet, ValueError for settings
        that do not validate."""
        if self._render is None or self._apply_view is None:
            raise LookupError("gemmy serve was started without --render")
        if not isinstance(raw, dict):
            raise ValueError("expected a JSON object with render settings")
        with self.cond:
            if self._scene is None:
                raise LookupError("there is no good scene to render yet")
        self._apply_view(raw)
        with self.cond:
            self._render_pending = True
            self._changed()

    def _render_loop(self) -> None:
        assert self._render is not None
        path = Path(self._tmp.name) / "scene.json"
        while True:
            with self.cond:
                while not self._render_pending and not self.closed:
                    self.cond.wait(0.5)
                if self.closed:
                    return
                self._render_pending = False  # a compile during this render sets it again: one more render
                path.write_bytes(self._scene or b"{}")
                self._render_state.update(state="rendering", error=None)
                self._changed()
            error = None
            try:
                self._render(path)
            except Exception as exc:  # noqa: BLE001  # a Blender failure is reported, the server goes on
                error = _message(exc)
                print(f"render error: {error}", file=sys.stderr, flush=True)
            with self.cond:
                self._render_state.update(state="idle", error=error)
                if error is None:
                    self._render_state["time"] = time.strftime("%H:%M:%S")
                self._changed()

    # -- lifecycle
    def start(self) -> None:
        """Compile once (a failure is reported, not raised), then watch and render in background threads."""
        self.recompile()
        targets = [self._watch_loop] + ([self._render_loop] if self._render is not None else [])
        for target in targets:
            thread = threading.Thread(target=target, daemon=True)
            thread.start()
            self._threads.append(thread)

    def stop(self) -> None:
        with self.cond:
            self.closed = True
            self.cond.notify_all()
        for thread in self._threads:
            thread.join(timeout=2)
        self._tmp.cleanup()


# ---- HTTP ----


class _Handler(BaseHTTPRequestHandler):
    server: PreviewServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # quiet: the terminal shows compile errors
        pass

    def _send(self, code: int, body: bytes, content_type: str, headers: dict[str, str] | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _route(self) -> tuple[Preview | None, str]:
        """/k/... is the k-th preview; any other path is the first one."""
        path = self.path.split("?", 1)[0]
        previews = self.server.previews
        match = re.fullmatch(r"/(\d+)(/.*)?", path)
        if match is None:
            return previews[0], path
        k = int(match.group(1))
        return (previews[k] if k < len(previews) else None), match.group(2) or ""

    def do_GET(self) -> None:
        preview, path = self._route()
        if preview is None:
            self._send(404, b"not found", "text/plain; charset=utf-8")
        elif path == "":  # /k: relative links in the page need the trailing slash
            self._send(301, b"", "text/plain; charset=utf-8", {"Location": self.path.split("?", 1)[0] + "/"})
        elif path == "/":
            self._send(200, preview.page, "text/html; charset=utf-8")
        elif path == "/scene.json":
            scene = preview.scene_bytes()
            if scene is None:
                self._send(404, json.dumps({"error": preview.status()["error"]}).encode(), "application/json")
            else:
                body, bounds = scene
                self._send(200, body, "application/json", {"X-Gemmy-Bounds": bounds})
        elif path == "/status":
            self._send(200, json.dumps(preview.status()).encode(), "application/json")
        elif path == "/events":
            self._events(preview)
        else:
            self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        preview, path = self._route()
        if preview is None or path != "/render-view":
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            preview.render_view(json.loads(body))
        except LookupError as exc:
            code, message = 409, str(exc)
        except (ValueError, TypeError) as exc:  # JSON syntax, validation and unknown keys
            code, message = 400, _message(exc)
        else:
            code, message = 200, None
        self._send(code, json.dumps({"error": message} if message else {"ok": True}).encode(), "application/json")

    def _events(self, preview: Preview) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        last = -1
        try:
            while not preview.closed:
                with preview.cond:
                    if preview.seq == last:
                        preview.cond.wait(15)
                    current, payload = preview.seq, json.dumps(preview._status_locked())
                if current != last:
                    last = current
                    self.wfile.write(f"event: status\ndata: {payload}\n\n".encode())
                else:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], previews: Sequence[Preview]) -> None:
        super().__init__(address, _Handler)
        self.previews = list(previews)


def make_server(previews: Sequence[Preview], host: str = "127.0.0.1", port: int = 8000) -> PreviewServer:
    return PreviewServer((host, port), previews)


def serve(previews: Sequence[Preview], host: str, port: int, open_browser: bool = False) -> int:
    """Run until Ctrl-C. Port 0 picks a free port; the URL printed is the real one."""
    try:
        server = make_server(previews, host, port)
    except OSError as exc:
        print(f"error: cannot listen on {host}:{port}: {exc}", file=sys.stderr)
        return 2
    url = f"http://{host}:{server.server_address[1]}/"
    for preview in previews:
        preview.start()
    print(f"Serving {url} (Ctrl-C to stop)", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("", flush=True)
    finally:
        for preview in previews:
            preview.stop()
        server.server_close()
    return 0
