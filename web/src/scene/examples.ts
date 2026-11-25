// The examples gallery of a hosted site: examples.json, an array of { name, title, description, scene, thumbnail }, where
// scene and thumbnail are the addresses of the example's scene file and its picture, relative to examples.json. The
// start screen (ui/home.ts) shows the gallery; a site without the file (gemmy view, gemmy serve, or a 404) has no
// gallery. No DOM here, so the node tests run it.
export const EXAMPLES_FILE = "examples.json";

export interface Example {
  name: string;
  title: string;
  description: string;
  scene: string;
  thumbnail: string;
}

// The examples, and the address examples.json was read from (the scene addresses are relative to it).
export interface Gallery {
  examples: Example[];
  base: string;
}

// The list in a parsed examples.json. Anything else is refused, so a broken file shows no gallery rather than a
// card with nothing in it.
export function parseExamples(value: unknown): Example[] {
  if (!Array.isArray(value) || !value.every(isExample)) {
    throw new Error("examples.json should be a list of { name, title, description, scene, thumbnail } objects.");
  }
  return value;
}

function isExample(value: unknown): value is Example {
  if (typeof value !== "object" || value === null) return false;
  const example = value as Record<string, unknown>;
  return ["name", "title", "description", "scene", "thumbnail"].every((key) => typeof example[key] === "string");
}

// The address of an example's scene, from the gallery.
export function sceneAddressOf(gallery: Gallery, example: Example): string {
  return new URL(example.scene, gallery.base).href;
}

// The address of an example's thumbnail, from the gallery.
export function thumbnailAddressOf(gallery: Gallery, example: Example): string {
  return new URL(example.thumbnail, gallery.base).href;
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

// The gallery beside a page: its own folder's examples.json (the front page of a hosted site), else the site's root
// one (an example's page sits one folder down, so the same site's gallery is there).
export async function galleryNear(pageHref: string): Promise<Gallery | null> {
  return (
    (await galleryAt(new URL(EXAMPLES_FILE, pageHref).href)) ?? galleryAt(new URL(`../${EXAMPLES_FILE}`, pageHref).href)
  );
}
