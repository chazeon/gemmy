// The file of a gist the viewer loads: the one named by file=, else the first whose name ends in .json or .json.gz.
import { SCENE_FILE } from "./read";

export interface GistFile {
  filename: string;
  raw_url: string; // the file's own address: a truncated file in the API reply is only whole there
}

export function pickGistFile(files: Record<string, GistFile>, wanted: string | null): GistFile {
  const all = Object.values(files);
  if (wanted !== null) {
    const named = all.find((file) => file.filename === wanted);
    if (!named) throw new Error(`The gist has no file named "${wanted}".`);
    return named;
  }
  const scene = all.find((file) => SCENE_FILE.test(file.filename));
  if (!scene) throw new Error("The gist has no .json or .json.gz file.");
  return scene;
}
