// A user-written data file (datafile.py): TOML when its name ends in .toml, else JSON. The page and node both hand
// over the text, so this takes the name and the text rather than a path.
import { parse as parseToml } from "smol-toml";
import { errorText } from "../errors";

// The file is missing or does not parse; the message names the file.
export class DataFileError extends Error {}

export function readData(name: string, text: string): unknown {
  if (name.toLowerCase().endsWith(".toml")) {
    try {
      return parseToml(text);
    } catch (error) {
      throw new DataFileError(`${name} is not valid TOML: ${errorText(error)}`);
    }
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DataFileError(`${name} is not valid JSON: ${errorText(error)}`);
  }
}
