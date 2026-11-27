// The LAMMPS type map of a compile config (`types`). A key is a LAMMPS type number, written as a plain number from 1 to
// MAX_TYPE, and its label names the element of that type (elementOfLabel is the rule). config.ts takes lammpsTypes for
// the `types` key.
import * as z from "zod/mini";
import { elementOfLabel } from "../structure/elements";

// The largest type number: fastatoms keys its types as int32, so a larger one cannot be read.
export const MAX_TYPE = 2147483647;

// An issue the schema reports: its message, the value it refuses, and the key path it names, when it names one.
function customIssue(message: string, input: unknown, path?: string[]) {
  return { code: "custom" as const, message, input, path };
}

// A species label: it must name an element.
const speciesLabel = z.string().check((ctx) => {
  if (elementOfLabel(ctx.value) === undefined) {
    ctx.issues.push(customIssue(`Cannot tell which element the label '${ctx.value}' names`, ctx.value));
  }
});

// A type key as written: a plain number from 1. It is checked as text, so that `+1`, `01` and `1.0` are refused rather
// than read as 1.
const TYPE_KEY = /^[1-9][0-9]*$/;

// The message for a key that is not a type number, or null when it is one.
function typeKeyProblem(key: string): string | null {
  if (!TYPE_KEY.test(key)) {
    return `types.${key}: a LAMMPS type is a plain number from 1 (\`1\`, \`2\`, ...): no sign, spaces, leading zero, decimal point or underscore.`;
  }
  if (Number(key) > MAX_TYPE) return `types.${key}: a LAMMPS type is at most ${MAX_TYPE}.`;
  return null;
}

// The LAMMPS type map: each key a type number, each label the name of its element. The keys are checked as the user wrote
// them, before the record is built: a record takes `__proto__` as the object's prototype, not as a key.
export const lammpsTypes = z.pipe(
  z.unknown().check((ctx) => {
    if (typeof ctx.value !== "object" || ctx.value === null) return;
    for (const key of Object.keys(ctx.value)) {
      const problem = typeKeyProblem(key);
      if (problem !== null) ctx.issues.push(customIssue(problem, key, [key]));
    }
  }),
  z.record(z.string(), speciesLabel),
);
