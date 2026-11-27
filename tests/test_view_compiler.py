"""The viewer's loading of the structure compiler (web/src/scene/compiler.ts): the compiler address's rules, the retry
address, the redacted load message and the check of the fetched script's reply, run in node through
tests/viewer_bundle.py. The fetch, the blob script and the DOM are not tested here."""

from __future__ import annotations

from typing import Any

import pytest

from viewer_bundle import available, node_json

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")
PAGE = "https://chazeon.github.io/gemmy/view/compile.js"


def _try(call: str, *args: Any) -> dict[str, Any]:
    """Runs `call` (an expression over args[0], args[1], ...): {"ok": its value} or {"error": the message}."""
    return node_json(
        f"let result; try {{ result = {{ ok: {call} }}; }} catch (error) {{ result = {{ error: error.message }}; }}",
        *args,
    )


def _retry(href: str, attempt: int) -> str:
    return node_json("const result = retryHref(args[0], args[1]);", href, attempt)


def _message(href: str, reason: str, protocol: str) -> str:
    return node_json("const result = compilerLoadMessage(args[0], args[1], args[2]);", href, reason, protocol)


def _compiler_url(content: str, page: str) -> dict[str, Any]:
    return _try("compilerUrl(args[0], args[1])", content, page)


def _reply_problem(url: str, status: int, content_type: str | None) -> str | None:
    reply = {"url": url, "status": status, "contentType": content_type}
    return node_json("const result = scriptReplyProblem(args[0], args[1]);", reply, PAGE)


def test_the_first_try_loads_the_href_as_it_is() -> None:
    assert _retry(PAGE, 0) == PAGE


def test_a_retry_adds_a_retry_query_and_keeps_the_others() -> None:
    assert _retry(PAGE, 1) == PAGE + "?retry=1"
    assert _retry(PAGE, 3) == PAGE + "?retry=3"
    assert _retry(PAGE + "?v=abc", 2) == PAGE + "?v=abc&retry=2"


def test_a_retry_replaces_an_earlier_retry_query() -> None:
    assert _retry(PAGE + "?retry=1&v=abc", 2) == PAGE + "?retry=2&v=abc"


def test_the_load_error_names_the_address_and_gives_the_reason() -> None:
    message = _message(PAGE, "the server answered 404", "https:")
    assert message == f"Could not load the compiler ({PAGE}). Reason: the server answered 404."


def test_the_load_error_drops_the_query_and_the_credentials() -> None:
    href = "https://user:secret@chazeon.github.io/gemmy/view/compile.js?token=abc123#frag"
    message = _message(href, "the browser could not fetch or run it", "https:")
    assert message == f"Could not load the compiler ({PAGE}). Reason: the browser could not fetch or run it."
    assert "secret" not in message and "token" not in message and "abc123" not in message


def test_a_file_page_is_told_to_serve_over_http() -> None:
    message = _message(PAGE, "the browser could not fetch or run it", "file:")
    assert message == (
        f"Could not load the compiler ({PAGE}). A hosted page must be served over http, not opened as a file."
        " Reason: the browser could not fetch or run it."
    )


def test_a_relative_compiler_address_resolves_against_the_page() -> None:
    assert _compiler_url("compile.js", PAGE) == {"ok": PAGE}
    assert _compiler_url("../compile.js", PAGE) == {"ok": "https://chazeon.github.io/gemmy/compile.js"}


def test_a_compiler_on_another_site_is_refused_without_its_query() -> None:
    result = _compiler_url("https://evil.example/compile.js", PAGE)
    assert "on another site" in result["error"]
    assert "https://evil.example" in result["error"]
    assert "on another site" in _compiler_url("//evil.example/compile.js", PAGE)["error"]


def test_the_refusal_of_another_site_leaves_out_the_credentials_and_the_query() -> None:
    result = _compiler_url("https://user:pw@evil.example/compile.js?t=1", PAGE)
    assert "pw" not in result["error"] and "t=1" not in result["error"]
    assert "https://evil.example/compile.js" in result["error"]


def test_a_compiler_that_is_not_http_is_refused() -> None:
    assert "not http or https" in _compiler_url("javascript:alert(1)", PAGE)["error"]


def test_a_meta_that_is_not_an_address_is_refused_with_a_message() -> None:
    assert _compiler_url("http://[", PAGE) == {"error": "The page's compiler meta is not a valid address."}


def test_a_file_page_is_told_to_serve_over_http_before_any_load() -> None:
    result = _compiler_url("compile.js", "file:///tmp/view.html")
    assert "must be served over http" in result["error"]


def test_a_script_reply_from_the_page_site_with_a_javascript_type_may_run() -> None:
    assert _reply_problem(PAGE, 200, "text/javascript; charset=utf-8") is None
    assert _reply_problem(PAGE, 200, "application/javascript") is None


def test_a_script_reply_with_an_error_status_is_refused() -> None:
    assert _reply_problem(PAGE, 404, "text/javascript") == "the server answered 404"


def test_a_script_reply_redirected_to_another_site_is_refused() -> None:
    problem = _reply_problem("https://evil.example/compile.js", 200, "text/javascript")
    assert problem == "it was served from another site"


def test_a_script_reply_that_is_not_javascript_is_refused() -> None:
    assert _reply_problem(PAGE, 200, "text/plain") == "it is served as text/plain, not JavaScript"
    assert _reply_problem(PAGE, 200, None) == "it is served as no type, not JavaScript"
