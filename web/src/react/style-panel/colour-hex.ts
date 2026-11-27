// A colour as the hex text the style panel's colour fields show: #rrggbbaa for a colour that takes transparency (its row's
// `alpha` flag, not its current alpha), else #rrggbb. A Tweakpane binding keeps the format it was made with, so the
// adapter builds the binding with the row's flag and the text's length never changes with the value. No Tweakpane import
// here, so the node test reads it.
import type { Rgba } from "./pane-model";

// Tweakpane's int channel is 0 to 255 per channel; the nodes hold 0 to 1.
export const CHANNEL_MAX = 255;

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;

export function toHex(rgba: Rgba, alpha: boolean): string {
  const channels = alpha ? [rgba.r, rgba.g, rgba.b, rgba.a] : [rgba.r, rgba.g, rgba.b];
  const bytes = channels.map((channel) => {
    const byte = Math.min(CHANNEL_MAX, Math.max(0, Math.round(channel * CHANNEL_MAX)));
    return byte.toString(16).padStart(2, "0");
  });
  return `#${bytes.join("")}`;
}

// The colour a hex text holds, or null when the text is not hex. The alpha is the previous colour's when the text's alpha
// byte is the one it already has (so an edit of the channels does not round the alpha to 1/255), and a six-digit text
// (an opaque colour) keeps the previous alpha too.
export function fromHex(text: string, previous: Rgba): Rgba | null {
  const match = HEX.exec(text);
  if (match === null) return null;
  const channel = (digits: string) => Number.parseInt(digits, 16) / CHANNEL_MAX;
  const alphaDigits = match[4];
  const alpha =
    alphaDigits === undefined || Number.parseInt(alphaDigits, 16) === Math.round(previous.a * CHANNEL_MAX)
      ? previous.a
      : channel(alphaDigits);
  return { r: channel(match[1]), g: channel(match[2]), b: channel(match[3]), a: alpha };
}
