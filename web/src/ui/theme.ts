// The colour theme. Auto follows the system's light or dark setting; Light and Dark set data-theme on <html>, which
// web/style.css reads (Light and Dark both override the system). The overlay's shadcn components read the same choice
// as the `dark` class on <html> (their dark variants). The choice is kept per browser under THEME_KEY. The inline
// script in web/page.html reads the same key before the first paint, so keep the key and the values equal.
import { computed, effect, signal } from "@preact/signals-core";
import { remembered } from "./storage";

type ThemeChoice = "auto" | "light" | "dark";

const THEME_KEY = "gemmy.theme";
const THEME_CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];
const AUTO: ThemeChoice = "auto";
const THEME_ATTRIBUTE = "data-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const DARK_CLASS = "dark"; // shadcn's dark variant (web/tailwind.css)

function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.some((choice) => choice === value);
}

// Auto takes the attribute away, so the system's scheme applies; Light and Dark put their name on <html>.
function applyToPage(choice: ThemeChoice): void {
  if (choice === AUTO) document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  else document.documentElement.setAttribute(THEME_ATTRIBUTE, choice);
}

const stored = remembered<ThemeChoice>(THEME_KEY, (raw) => (isThemeChoice(raw) ? raw : AUTO));
// The choice in use: the ☰ menu and the box's colour follow it.
export const theme = signal<ThemeChoice>(stored.read());
applyToPage(theme.peek());

// Whether the system is dark now. Auto follows it, so the box's colour follows it too.
const systemQuery = matchMedia(DARK_QUERY);
export const systemDark = signal(systemQuery.matches);
systemQuery.addEventListener("change", (event) => {
  systemDark.value = event.matches;
});

// The page is dark when the choice is Dark, or Auto with a dark system: the class on <html> follows that.
const isDark = computed(() => theme.value === "dark" || (theme.value === "auto" && systemDark.value));
effect(() => {
  document.documentElement.classList.toggle(DARK_CLASS, isDark.value);
});

// The page's attribute is set before the signal changes, so an effect that reads the colours sees the new ones.
function setTheme(choice: ThemeChoice): void {
  applyToPage(choice);
  stored.write(choice);
  theme.value = choice;
}

// The next choice after the current one: Auto, then Light, then Dark, then Auto again.
export function cycleTheme(): void {
  const next = (THEME_CHOICES.indexOf(theme.peek()) + 1) % THEME_CHOICES.length;
  setTheme(THEME_CHOICES[next]);
}
