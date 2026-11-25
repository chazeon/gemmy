// Fetching a scene from a URL or a gist. The page is on another origin than most scene hosts, so a failure is often CORS:
// the browser then gives no status, only a failed fetch, and the message says so.
import type { Scene } from "../types";
import { type GistFile, pickGistFile } from "./gist";
import { SceneError, readCapped, sceneFromBytes } from "./read";
import { resolveWebUrl } from "./source";

const GIST_API = "https://api.github.com/gists/";
const GIST_ACCEPT = "application/vnd.github+json";

async function get(url: string, accept?: string): Promise<Response> {
  let response: Response;
  try {
    // No referrer: the scene's host does not learn the viewer's address.
    response = await fetch(url, { headers: accept ? { Accept: accept } : {}, referrerPolicy: "no-referrer" });
  } catch {
    throw new SceneError(`Could not fetch ${url}: the network failed, or the server does not allow this page to read it (CORS).`);
  }
  if (!response.ok) {
    const status = [response.status, response.statusText].filter(Boolean).join(" ");
    throw new SceneError(`The server answered ${status} for ${url}.`);
  }
  return response;
}

export async function fetchScene(url: string): Promise<Scene> {
  const response = await get(url);
  if (!response.body) throw new SceneError(`${url} sent no data.`);
  return sceneFromBytes(await readCapped(response.body, `The scene at ${url}`));
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
