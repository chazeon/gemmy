// A choice the user makes, kept per browser in localStorage. `parse` takes the stored text (null when nothing is
// stored) and returns a usable value, the default for anything it does not accept. Storage that refuses (a private
// window, blocked site data) reads as nothing stored, and a write then lasts for this visit only.
export function remembered<T>(key: string, parse: (raw: string | null) => T) {
  return {
    read(): T {
      try {
        return parse(localStorage.getItem(key));
      } catch {
        return parse(null);
      }
    },
    write(value: T): void {
      try {
        localStorage.setItem(key, String(value));
      } catch {
        // storage refused: the choice lasts for this visit only
      }
    },
  };
}
