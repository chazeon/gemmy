// Where a scene comes from when the page embeds none: ?scene=<url> (one per scene) or ?gist=<id>[&file=<name>]. A URL
// is resolved against the page's own address, so a relative one (../nacl/scene.json.gz) works on a site, and whatever it
// resolves to must be http or https: a file: or data: scene is not fetched.
import { SCENE_FILE } from "./read";

export const SCENE_PARAM = "scene";
export const GIST_PARAM = "gist";
export const FILE_PARAM = "file";
const GIST_ID = /^[A-Za-z0-9]+$/; // GitHub's ids are hex; the check only keeps other characters out of the API path
const WEB_PROTOCOLS = ["http:", "https:"];

export type SceneSource = { kind: "url"; url: string } | { kind: "gist"; id: string; file: string | null };

// A message for the page to show as it is: the query or URL the user wrote is named in it.
export class SourceError extends Error {}

// The sources the address asks for: several scene= give several, a gist= gives one.
export function parseSources(search: string, base: string): SceneSource[] {
  const query = new URLSearchParams(search);
  const urls = query.getAll(SCENE_PARAM);
  const gist = query.get(GIST_PARAM);
  if (gist !== null && urls.length > 0) throw new SourceError("Give scene= or gist=, not both.");
  if (gist !== null) {
    if (!GIST_ID.test(gist)) throw new SourceError(`gist= should be a gist id (letters and digits), got "${gist}".`);
    return [{ kind: "gist", id: gist, file: query.get(FILE_PARAM) || null }];
  }
  return urls.map((value) => ({ kind: "url", url: resolveWebUrl(value, base) }));
}

// The absolute http(s) URL a user typed or a link gave, or a SourceError saying why not.
export function resolveWebUrl(value: string, base: string): string {
  if (value.trim() === "") throw new SourceError("scene= needs a URL.");
  let url: URL;
  try {
    url = new URL(value.trim(), base);
  } catch {
    throw new SourceError(`"${value}" is not a URL.`);
  }
  if (!WEB_PROTOCOLS.includes(url.protocol)) throw new SourceError(`Only http and https scene URLs can be opened, not "${value}".`);
  return url.href;
}

// The path segments of a URL, decoded.
function pathSegments(url: string): string[] {
  return new URL(url).pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

// The name a loaded scene is shown with: the last path segment.
export function sourceName(url: string): string {
  return pathSegments(url).at(-1) ?? url;
}

// A scene to open, and whether it is a default of the page (its link is then the page's own address, with no scene in it).
export interface Opening {
  source: SceneSource;
  byDefault: boolean;
}

// What the page opens, in order: the scenes the address asks for (?scene= or ?gist=), else the page's default scenes
// (the built site's front page has every example, an example's page its own), else none. Only the address can override them.
export function sourcesToOpen(search: string, base: string, defaults: readonly string[]): Opening[] {
  const sources = parseSources(search, base);
  if (sources.length > 0) return sources.map((source) => ({ source, byDefault: false }));
  return defaults.map((scene) => ({ source: { kind: "url", url: resolveWebUrl(scene, base) }, byDefault: true }));
}

// The address that opens a scene again: the page's address (without its #view) with the scene's query. A default scene
// needs none, so its link is the page's address.
export function linkFor(source: SceneSource, byDefault: boolean, pageHref: string): string {
  const link = new URL(pageHref);
  link.hash = "";
  const query: Record<string, string> = byDefault ? {}
    : source.kind === "gist" ? { gist: source.id, ...(source.file === null ? {} : { file: source.file }) }
    : { scene: source.url };
  link.search = new URLSearchParams(query).toString();
  return link.href;
}

// The label of a scene's tab: the folder of a scene file that is named scene.json(.gz) (nacl/scene.json.gz is "nacl"),
// else the file name without its extension; a gist's tab is its file.
export function tabLabel(source: SceneSource): string {
  if (source.kind === "gist") return source.file ?? `gist ${source.id}`;
  const segments = pathSegments(source.url);
  const stem = (segments.at(-1) ?? source.url).replace(SCENE_FILE, "");
  return stem === "scene" ? (segments.at(-2) ?? stem) : stem;
}
