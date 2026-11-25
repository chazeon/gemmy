// The colour theme. Auto follows the system's light or dark setting; Light and Dark set data-theme on <html>, which
// web/style.css reads (Light and Dark both override the system). The choice is kept per browser under THEME_KEY. The
// inline script in web/page.html reads the same key before the first paint, so keep the key and the values equal.
export type ThemeChoice = "auto" | "light" | "dark";

const THEME_KEY = "gemmy.theme";
export const THEME_CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];
const AUTO: ThemeChoice = "auto";
const THEME_ATTRIBUTE = "data-theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.some((choice) => choice === value);
}

// Who is told when the choice changes (the menu's segments).
type ThemeListener = (choice: ThemeChoice) => void;
const listeners: ThemeListener[] = [];

export function onThemeChange(listener: ThemeListener): void {
  listeners.push(listener);
}

// A stored choice that is not one of the three counts as Auto, as does a choice that storage refuses to give.
function readStoredChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return isThemeChoice(value) ? value : AUTO;
  } catch {
    return AUTO;
  }
}
function storeTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // storage refused: the choice lasts for this visit only
  }
}

// Auto takes the attribute away, so the system's scheme applies; Light and Dark put their name on <html>.
function applyToPage(choice: ThemeChoice): void {
  if (choice === AUTO) document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  else document.documentElement.setAttribute(THEME_ATTRIBUTE, choice);
}

let current: ThemeChoice = readStoredChoice();
applyToPage(current);

export function currentTheme(): ThemeChoice {
  return current;
}

export function setTheme(choice: ThemeChoice): void {
  current = choice;
  storeTheme(choice);
  applyToPage(choice);
  for (const listener of listeners) listener(choice);
}

// The next choice after the current one: Auto, then Light, then Dark, then Auto again.
export function cycleTheme(): void {
  const next = (THEME_CHOICES.indexOf(current) + 1) % THEME_CHOICES.length;
  setTheme(THEME_CHOICES[next]);
}
