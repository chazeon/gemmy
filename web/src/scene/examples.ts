// The examples gallery of a hosted site: examples.json, an array of { name, title, description, thumbnail, structure },
// where thumbnail is the address of the example's picture, relative to examples.json, and structure is the example's
// structure file and the files its config reads, in its folder (see scene/source.ts pageStructureOf). The start screen
// (ui/home.ts) shows the gallery, and a card opens the structure. A site without the
// file (gemmy view, gemmy serve, or a 404) has no gallery. No DOM here, so the node tests run it.
import { type PageStructureSource, isPlainName, pageStructureOf } from "./source";

export const EXAMPLES_FILE = "examples.json";

export interface Example {
  name: string;
  title: string;
  description: string;
  thumbnail: string;
  structure: { structure: string; files: string[] };
}

// The examples, and the address examples.json was read from (the addresses are relative to it).
export interface Gallery {
  examples: Example[];
  base: string;
}

// The examples in a parsed examples.json. A malformed entry is skipped and reported on the console, so the others still
// show; a value that is not a list is an error.
export function parseExamples(value: unknown): Example[] {
  if (!Array.isArray(value)) throw new Error("examples.json should be a list of examples.");
  return value.filter((entry) => {
    const problem = problemWith(entry);
    if (problem !== null) console.warn(`examples.json: skipped an entry, ${problem}`);
    return problem === null;
  });
}

// What is wrong with an entry, or null: it needs a name, title, description, a thumbnail inside the site, and a structure
// whose file names are plain names in the example's folder.
function problemWith(value: unknown): string | null {
  const example = (value ?? {}) as Record<string, unknown>;
  const { name, thumbnail, structure } = example;
  const { structure: file, files } = (structure ?? {}) as Record<string, unknown>;
  if (!["name", "title", "description", "thumbnail"].every((key) => typeof example[key] === "string"))
    return "it lacks a name, title, description or thumbnail";
  if (!isPlainName(name as string)) return `"${name}" is not a plain folder name`;
  if (
    !isPlainName(file as string) ||
    !Array.isArray(files) ||
    !files.every((f) => typeof f === "string" && isPlainName(f))
  )
    return `${name}'s structure names a file that is not a plain file name`;
  const segments = (thumbnail as string).split("/");
  if (segments.length === 0 || !segments.every(isPlainName)) return `${name}'s thumbnail is not a path inside the site`;
  return null;
}

// An example's structure, from the gallery: its folder is the example's name beside examples.json, and the card opens it.
export function structureOf(gallery: Gallery, example: Example): PageStructureSource {
  const folder = new URL(`${encodeURIComponent(example.name)}/`, gallery.base).href;
  return pageStructureOf(example.structure.structure, example.structure.files, folder);
}

// The address of an example's thumbnail, from the gallery.
export function thumbnailAddressOf(gallery: Gallery, example: Example): string {
  return new URL(example.thumbnail.split("/").map(encodeURIComponent).join("/"), gallery.base).href;
}

// The gallery read from one address: null when the file is not there (a 404), else its examples. Read once per
// address, so the front page's check and the start screen share the read.
const galleries = new Map<string, Promise<Gallery | null>>();
export function galleryAt(address: string): Promise<Gallery | null> {
  let found = galleries.get(address);
  if (!found) {
    found = readGallery(address);
    galleries.set(address, found);
  }
  return found;
}

async function readGallery(address: string): Promise<Gallery | null> {
  const response = await fetch(address, { cache: "no-cache" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The server answered ${response.status} for ${address}.`);
  return { examples: parseExamples(await response.json()), base: address };
}

// The gallery beside a page: the examples.json of its own folder (the one page of a hosted site), or null.
export function galleryNear(pageHref: string): Promise<Gallery | null> {
  return galleryAt(new URL(EXAMPLES_FILE, pageHref).href);
}
