// The theme button beside Export: one icon for the choice in use (Contrast for Auto, Sun for Light, Moon for Dark), a click
// moves to the next (Auto, then Light, then Dark). The choice is ui/theme.ts's signal, and the `t` key cycles it too.
import { Contrast, Moon, Sun } from "lucide-react";
import { SHORTCUT } from "../ui/keyboard";
import { cycleTheme, theme } from "../ui/theme";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";
import { spin } from "./motion";

const ICONS = { auto: Contrast, light: Sun, dark: Moon } as const;
const TIPS = {
  auto: "Theme: auto (follows the system). Click for light.",
  light: "Theme: light. Click for dark.",
  dark: "Theme: dark. Click for auto.",
} as const;

export function ThemeButton() {
  const choice = useSignal(theme);
  const Icon = ICONS[choice];
  return (
    <TipButton
      id="theme-button"
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${choice}`}
      tip={TIPS[choice]}
      shortcut={SHORTCUT.theme}
      onClick={cycleTheme}
      style={spin(1)}
      className="size-11 rounded-[var(--radius)] bg-[var(--bar)] text-[var(--fg)] shadow-[var(--shadow)]"
    >
      <Icon size={20} strokeWidth={1.75} />
    </TipButton>
  );
}
