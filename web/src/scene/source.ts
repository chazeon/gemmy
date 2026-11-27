// Where a tab's scene comes from. A tab is one source: the page's own scene (embedded in the page, or live from
// gemmy serve), a scene the address names (?scene= or ?gist=), a file the user dropped or chose, or the home tab, which has no scene (the start screen). Each source says
// what it is called and what link opens it again (linkOf); loader.ts loads it. A URL is resolved against the page's own address, so a relative one
// (nacl/scene.json.gz) works on a site, and whatever it resolves to must be http or https: a file: or data: scene is
// not fetched.
import type { TypeMap } from "../structure/types";
import type { Scene } from "../types";
import { SCENE_FILE } from "./read";

const SCENE_PARAM = "scene";
const GIST_PARAM = "gist";
const FILE_PARAM = "file";
const GIST_ID = /^[A-Za-z0-9]+$/; // GitHub's ids are hex; the check only keeps other characters out of the API path
const HOME_NAME = "New tab";
const WEB_PROTOCOLS = ["http:", "https:"];

// The page's own names: its title, and the line under it.
export interface PageNames {
  name: string;
  from: string;
}

// A scene the address names.
export type SceneSource = { kind: "url"; url: string } | { kind: "gist"; id: string; file: string | null };

// A file of an example's folder on the site, by its name and its address.
export interface PageFile {
  name: string;
  url: string;
}

export type Source =
  | SceneSource
  | { kind: "embedded"; doc: Scene; page: PageNames }
  | { kind: "live"; page: PageNames }
  | { kind: "file"; file: File }
  // A structure the page compiles (compile.js). `sidecars` are the other dropped files (its config, label and
  // displacement files). `types` is the LAMMPS type map the user gave, once asked (a retry replaces the source).
  | { kind: "structure"; file: File; sidecars: readonly File[]; types?: TypeMap }
  // A structure of an example's folder on the hosted site (a gallery card opens it): the same as a structure, its files
  // fetched when the tab loads. Its link is the page.
  | PageStructureSource
  | { kind: "home" };

export interface PageStructureSource {
  kind: "page-structure";
  file: PageFile;
  sidecars: readonly PageFile[];
  types?: TypeMap;
}

// The sources that take a LAMMPS type map (the form's writes go to them).
export function hasTypes(source: Source): source is Extract<Source, { kind: "structure" | "page-structure" }> {
  return source.kind === "structure" || source.kind === "page-structure";
}

// The structure of an example's folder (`base` is the folder's address): its structure file and the files its config reads,
// all fetched from there.
export function pageStructureOf(structure: string, files: readonly string[], base: string): PageStructureSource {
  for (const name of [structure, ...files]) {
    if (!isPlainName(name)) throw new SourceError(`"${name}" is not a plain file name in the example's folder.`);
  }
  const pageFile = (name: string): PageFile => ({ name, url: new URL(encodeURIComponent(name), base).href });
  return { kind: "page-structure", file: pageFile(structure), sidecars: files.map(pageFile) };
}

// A file or folder name that stays in its own folder: not empty, no slash, not . or .. (a URL has slashes).
export function isPlainName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[/\\]/.test(name);
}

export const HOME: Source = { kind: "home" };

// A message for the page to show as it is: the query or URL the user wrote is named in it.
class SourceError extends Error {}

// The gist a user typed: a gist id, or an address of a gist (https://gist.github.com/<user>/<id>).
export function gistSourceOf(text: string): SceneSource {
  const value = text.trim();
  const id = GIST_ID.test(value) ? value : lastPathSegment(value);
  if (!GIST_ID.test(id)) throw new SourceError(`"${value}" is not a gist id or a gist address.`);
  return { kind: "gist", id, file: null };
}

function lastPathSegment(value: string): string {
  try {
    return new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return "";
  }
}

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
  if (!WEB_PROTOCOLS.includes(url.protocol))
    throw new SourceError(`Only http and https scene URLs can be opened, not "${value}".`);
  return url.href;
}

// The path segments of a URL, decoded.
function pathSegments(url: string): string[] {
  return new URL(url).pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

// The name of a source: its tab's label starts from it, and the page's title is it (a gist's file is named once
// loaded).
export function nameOf(source: Source): string {
  switch (source.kind) {
    case "embedded":
    case "live":
      return source.page.name;
    case "file":
    case "structure":
      return source.file.name;
    case "page-structure":
      return source.file.name;
    case "home":
      return HOME_NAME;
    case "url":
    case "gist":
      return sceneName(source);
  }
}

// The line under the title: where the scene came from.
export function fromOf(source: Source): string {
  switch (source.kind) {
    case "embedded":
    case "live":
      return source.page.from;
    case "home":
      return "";
    case "file":
      return "local file";
    case "structure":
      return "local structure, compiled in the page";
    case "page-structure":
      return source.file.url;
    case "url":
      return source.url;
    case "gist":
      return `gist ${source.id}`;
  }
}

// The address that opens the source again, or null when no address can: an embedded scene or a dropped file (the link
// then gives the view only). A live scene and an example's structure are opened by the page itself, so their link is
// the page.
export function linkOf(source: Source, pageHref: string): string | null {
  const query = queryOf(source);
  if (query === null) return null;
  const link = new URL(pageHref);
  link.hash = "";
  link.search = query;
  return link.href;
}

function queryOf(source: Source): string | null {
  switch (source.kind) {
    case "embedded":
    case "file":
    case "structure":
    case "home":
      return null;
    case "live":
    case "page-structure":
      return "";
    case "url":
      return new URLSearchParams({ [SCENE_PARAM]: source.url }).toString();
    case "gist":
      return new URLSearchParams({
        [GIST_PARAM]: source.id,
        ...(source.file === null ? {} : { [FILE_PARAM]: source.file }),
      }).toString();
  }
}

// The display name of a scene source: the folder of a scene file that is named scene.json(.gz) (nacl/scene.json.gz is
// "nacl"), else the file name without its extension; a gist is its file, or its id when none is named.
export function sceneName(source: SceneSource): string {
  if (source.kind === "gist") return source.file ?? `gist ${source.id}`;
  const segments = pathSegments(source.url);
  const stem = (segments.at(-1) ?? source.url).replace(SCENE_FILE, "");
  return stem === "scene" ? (segments.at(-2) ?? stem) : stem;
}
