// The viewer's tabs as plain data, with no DOM: a list of tabs and the index of the current one. Each operation returns
// a new list, so the tab bar (ui/loader.ts) only renders what the list says. The node tests run these
// (web/test/entry.ts).
export interface TabList<T> {
  readonly tabs: readonly T[];
  readonly current: number;
}

export function tabsOf<T>(tabs: readonly T[], current = 0): TabList<T> {
  return { tabs, current };
}

// A tab added at the end, which becomes the current one.
export function addTab<T>(list: TabList<T>, tab: T): TabList<T> {
  return { tabs: [...list.tabs, tab], current: list.tabs.length };
}

// The same list with tab k current. An index that is not a tab leaves the list as it is.
export function chooseTab<T>(list: TabList<T>, k: number): TabList<T> {
  return k >= 0 && k < list.tabs.length ? { tabs: list.tabs, current: k } : list;
}

// The list without tab k. Closing the current tab makes the one before it current (the first one, when it was the
// first), since a tab is closed from the right; closing another tab keeps the current one current. The last tab is
// never closed, so the page always has a scene to show.
export function closeTab<T>(list: TabList<T>, k: number): TabList<T> {
  if (list.tabs.length < 2 || k < 0 || k >= list.tabs.length) return list;
  const tabs = list.tabs.filter((_, j) => j !== k);
  if (k === list.current) return { tabs, current: Math.max(0, k - 1) };
  return { tabs, current: k < list.current ? list.current - 1 : list.current };
}

// The label a new tab gets among the labels taken: the label itself, or with the smallest " (n)" from 2 that is free,
// so two files with the same name stay apart in the bar.
export function uniqueLabel(label: string, taken: readonly string[]): string {
  if (!taken.includes(label)) return label;
  let n = 2;
  while (taken.includes(`${label} (${n})`)) n += 1;
  return `${label} (${n})`;
}
