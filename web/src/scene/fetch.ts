// Fetching a scene from a URL or a gist. The page is on another origin than most scene hosts, so a failure is often
// CORS: the browser then gives no status, only a failed fetch, and the message says so.
import type { Scene } from "../types";
import { type GistFile, pickGistFile } from "./gist";
import { SceneError, readCapped, sceneFromBytes } from "./read";
import { type PageFile, resolveWebUrl } from "./source";

const GIST_API = "https://api.github.com/gists/";
const GIST_ACCEPT = "application/vnd.github+json";

async function get(url: string, accept?: string): Promise<Response> {
  let response: Response;
  try {
    // No referrer: the scene's host does not learn the viewer's address.
    response = await fetch(url, { headers: accept ? { Accept: accept } : {}, referrerPolicy: "no-referrer" });
  } catch {
    throw new SceneError(
      `Could not fetch ${url}: the network failed, or the server does not allow this page to read it (CORS).`,
    );
  }
  if (!response.ok) {
    const status = [response.status, response.statusText].filter(Boolean).join(" ");
    throw new SceneError(`The server answered ${status} for ${url}.`);
  }
  return response;
}

// A file of the page's own folder (a default structure or one of its files), as a File under its name, so it loads as a
// dropped file does.
export async function fetchPageFile(file: PageFile): Promise<File> {
  const response = await get(file.url);
  return new File([await response.blob()], file.name);
}

export async function fetchScene(url: string): Promise<Scene> {
  const response = await get(url);
  if (!response.body) throw new SceneError(`${url} sent no data.`);
  return sceneFromBytes(await readCapped(response.body, `The scene at ${url}`));
}

// The version gemmy serve holds now (its status), read before its scene so the scene is at least that version.
export async function fetchServedVersion(): Promise<string | null> {
  const response = await fetch("status", { cache: "no-store" });
  if (!response.ok) throw new SceneError(`The server answered ${response.status} for status.`);
  return (await response.json()).version ?? null;
}

// The scene gemmy serve holds now: its scene.json, never a cached copy (the server may have a newer one).
export async function fetchLive(): Promise<Scene> {
  const response = await fetch("scene.json", { cache: "no-store" });
  if (!response.ok) throw new SceneError(`The server answered ${response.status} for scene.json.`);
  return response.json();
}

// The gist's file (the first scene file, or the one named) and its contents, read from the file's own raw address.
export async function fetchGist(id: string, file: string | null): Promise<{ name: string; doc: Scene }> {
  const response = await get(GIST_API + encodeURIComponent(id), GIST_ACCEPT);
  let gist: { files?: Record<string, GistFile> };
  try {
    gist = await response.json();
  } catch {
    throw new SceneError(`GitHub sent no gist data for ${id}.`);
  }
  const picked = pickGistFile(gist.files ?? {}, file);
  const raw = resolveWebUrl(picked.raw_url, GIST_API);
  return { name: picked.filename, doc: await fetchScene(raw) };
}
