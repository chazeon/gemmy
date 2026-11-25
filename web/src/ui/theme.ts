// The colour theme. Auto follows the system's light or dark setting; Light and Dark set data-theme on <html>, which
// web/style.css reads (Light and Dark both override the system). The choice is kept per browser under THEME_KEY. The
// inline script in web/page.html reads the same key before the first paint, so keep the key and the values equal.
import { effect, signal } from "@preact/signals-core";
import { remembered } from "./storage";

type ThemeChoice = "auto" | "light" | "dark";

const THEME_KEY = "gemmy.theme";
const THEME_CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];
const AUTO: ThemeChoice = "auto";
const THEME_ATTRIBUTE = "data-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.some((choice) => choice === value);
}

// Auto takes the attribute away, so the system's scheme applies; Light and Dark put their name on <html>.
function applyToPage(choice: ThemeChoice): void {
  if (choice === AUTO) document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  else document.documentElement.setAttribute(THEME_ATTRIBUTE, choice);
}

const stored = remembered<ThemeChoice>(THEME_KEY, (raw) => (isThemeChoice(raw) ? raw : AUTO));
// The choice in use: the menu's segments and the box's colour follow it.
export const theme = signal<ThemeChoice>(stored.read());
applyToPage(theme.peek());

// Whether the system is dark now. Auto follows it, so the box's colour follows it too.
const systemQuery = matchMedia(DARK_QUERY);
export const systemDark = signal(systemQuery.matches);
systemQuery.addEventListener("change", (event) => {
  systemDark.value = event.matches;
});

// The page's attribute is set before the signal changes, so an effect that reads the colours sees the new ones.
export function setTheme(choice: ThemeChoice): void {
  applyToPage(choice);
  stored.write(choice);
  theme.value = choice;
}

// The next choice after the current one: Auto, then Light, then Dark, then Auto again.
export function cycleTheme(): void {
  const next = (THEME_CHOICES.indexOf(theme.peek()) + 1) % THEME_CHOICES.length;
  setTheme(THEME_CHOICES[next]);
}

// ---- the theme row of the ☰ menu ----
// Three segments, Auto, Light and Dark; the one in use is pressed. A key press (T) can change the choice while the menu
// is shut, so the segments follow the choice.
const themeSegments = [...document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")];
for (const segment of themeSegments) {
  segment.addEventListener("click", () => {
    const choice = segment.dataset.themeChoice;
    if (isThemeChoice(choice)) setTheme(choice);
  });
}
effect(() => {
  for (const segment of themeSegments) {
    segment.setAttribute("aria-pressed", String(segment.dataset.themeChoice === theme.value));
  }
});
