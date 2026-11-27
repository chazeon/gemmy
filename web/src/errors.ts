// The text of an error for the page to show: its message when it is an Error, else the value as text.
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
