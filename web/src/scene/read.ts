// Turning bytes into a scene: gzip or plain JSON, a size cap on both the download and the decompressed text, and the
// checks that make a scene safe to build (its schema version and the parts the viewer reads).
import { GEMMY } from "../config";
import type { Scene } from "../types";
import { errorText } from "../errors";

export const SCENE_FILE = /\.json(\.gz)?$/i; // the names a scene file can have
export const MEGABYTE = 1024 * 1024;
// The most a file may take, downloaded or decompressed, unless a caller gives a lower limit. A scene is far smaller;
// this only stops a runaway download.
export const MAX_FILE_BYTES = 200 * MEGABYTE;
const GZIP_FIRST_BYTE = 0x1f;
const GZIP_SECOND_BYTE = 0x8b;

// A message for the page to show. Its text is plain: the page never puts it into HTML.
export class SceneError extends Error {}

const isObject = (value: unknown): boolean => typeof value === "object" && value !== null;

// Gzip files begin with two magic bytes, whatever their name says.
export function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === GZIP_FIRST_BYTE && bytes[1] === GZIP_SECOND_BYTE;
}

// The name of a file without a trailing .gz: a sidecar's name once its bytes are gunzipped (so scene.json.gz is scene.json).
export function unzippedName(name: string): string {
  return name.replace(/\.gz$/i, "");
}

// All the bytes of a stream, refused once they pass `limit` (the stream is then cancelled).
export async function readCapped(
  stream: ReadableStream<Uint8Array>,
  what: string,
  limit: number = MAX_FILE_BYTES,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new SceneError(`${what} is larger than ${limit / MEGABYTE} MB.`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}

// The text in the bytes: gunzipped first when they are gzip (DecompressionStream, so no library). Scenes, structure files
// and sidecars are read this way; `limit` caps the decompressed text.
export async function fileText(bytes: Uint8Array, limit: number = MAX_FILE_BYTES): Promise<string> {
  if (!isGzip(bytes)) return new TextDecoder().decode(bytes);
  let plain: Uint8Array;
  try {
    const unzipped = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    plain = await readCapped(unzipped, "The decompressed file", limit);
  } catch (error) {
    if (error instanceof SceneError) throw error;
    throw new SceneError(`The gzip data could not be read: ${errorText(error)}`);
  }
  return new TextDecoder().decode(plain);
}

export async function sceneFromBytes(bytes: Uint8Array): Promise<Scene> {
  return parseScene(await fileText(bytes));
}

// A local .json or .json.gz file, read in this page; it is never uploaded.
export async function sceneFromFile(file: File): Promise<Scene> {
  if (!SCENE_FILE.test(file.name)) throw new SceneError(`${file.name} is not a .json or .json.gz scene file.`);
  if (file.size > MAX_FILE_BYTES) throw new SceneError(`${file.name} is larger than ${MAX_FILE_BYTES / MEGABYTE} MB.`);
  return sceneFromBytes(new Uint8Array(await file.arrayBuffer()));
}

export function parseScene(text: string): Scene {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SceneError(`The scene is not valid JSON: ${errorText(error)}`);
  }
  return checkScene(value);
}

// The checks before anything is built. gemmy's own validation (in the outer process) covers the rest; these only catch
// what would make the page fail with an obscure error. The schema version is the one scene/ defines (scene.py).
function checkScene(value: unknown): Scene {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SceneError("The JSON is not a gemmy scene (it is not an object).");
  }
  const { schema_version: version } = value as { schema_version?: unknown };
  if (version !== GEMMY.sceneSchemaVersion) {
    throw new SceneError(
      `This scene has schema_version ${String(version)}; this viewer reads version ${GEMMY.sceneSchemaVersion}. ` +
        "Recompile the scene from its config.",
    );
  }
  const doc = value as Scene;
  if (!Array.isArray(doc.points) || !isObject(doc.primitives) || !isObject(doc.materials)) {
    throw new SceneError(
      "The JSON has a schema_version but no points, primitives and materials: it is not a gemmy scene.",
    );
  }
  return doc;
}
