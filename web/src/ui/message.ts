// The message line: one line under the toolbar, drawn by React (react/message-line.tsx). It shows the most important of
// the timed note (from `note`) and the standing messages the serve page keeps while they hold (`setStanding`). The note is
// the newest event, so it wins a tie. A note shows for its time, then fades and is cleared.
// The note's time counts only while it is the line on show: a standing error over it pauses its clock, and the clock
// resumes when the error clears. Only the note fades, never a standing message.
// STAY keeps it until the next note or clearNote(): the serve page shows its Blender progress that way. A note may carry
// one action (Undo, say), which expires with the note. Each message has a kind: its sign on the line.
import { computed, effect, signal } from "@preact/signals-core";

const DEFAULT_MS = 6000;
const FADE_MS = 400;
export const STAY = "stay";

// The kinds, least to most important: an info note, a warning, an error (the line's sign, and its role).
export type Kind = "info" | "warning" | "error";
const RANK: Record<Kind, number> = { info: 0, warning: 1, error: 2 };

export interface NoteAction {
  label: string;
  run(): void;
}

export interface NoteOptions {
  ms?: number | typeof STAY;
  action?: NoteAction;
  kind?: Kind;
}

export interface Note {
  text: string;
  kind: Kind;
  action: NoteAction | null;
}

// The timed note on show, or null.
export const timed = signal<Note | null>(null);
// The timed note while it fades (the note that is expiring), or null. Only that note fades: a standing message never does.
export const fadingNote = signal<Note | null>(null);
// The standing messages, by name (the serve page's "follow" and "error"): each stays until its owner sets it to null.
export const standing = signal<Record<string, Note | null>>({});

// The line on show: the most important of the note and the standing messages (error over warning over info), or null.
export const line = computed<Note | null>(() => {
  let best: Note | null = timed.value;
  for (const message of Object.values(standing.value)) {
    if (message && (best === null || RANK[message.kind] > RANK[best.kind])) best = message;
  }
  return best;
});

// The timed note's clock: the ms it has left (`left`) while it shows. `since` is when the running stretch began, or null
// while the note is hidden. Fading takes FADE_MS of the same time, so a note hidden while it fades waits as well.
interface Clock {
  left: number;
  since: number | null;
  fading: boolean;
}
let clock: Clock | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

// Runs the clock while the timed note is the line on show, and stops it otherwise (taking off the time it ran). It runs
// on every change of the line, and again when a fade starts.
function sync(): void {
  const shown = timed.value !== null && line.value === timed.value;
  clearTimeout(timer);
  timer = undefined;
  if (clock === null) return;
  if (clock.since !== null) {
    clock.left -= performance.now() - clock.since;
    clock.since = null;
  }
  if (!shown) return;
  clock.since = performance.now();
  timer = setTimeout(expire, Math.max(0, clock.left));
}
effect(sync);

export function note(text: string, options: NoteOptions = {}): void {
  const { ms = DEFAULT_MS, action = null, kind = "info" } = options;
  clearClock();
  clock = ms === STAY ? null : { left: ms, since: null, fading: false };
  timed.value = { text, kind, action };
}

// Sets (or, with null, clears) a standing message. It keeps its place until it is cleared, whatever notes come and go.
export function setStanding(name: string, text: string | null, kind: Kind = "info"): void {
  standing.value = { ...standing.value, [name]: text === null ? null : { text, kind, action: null } };
}

// The timed note's time is up: it fades (its own FADE_MS), then is cleared.
function expire(): void {
  timer = undefined;
  if (clock === null || timed.peek() === null) return;
  if (clock.fading) {
    clearNote();
    return;
  }
  clock.fading = true;
  clock.left = FADE_MS;
  clock.since = null;
  fadingNote.value = timed.peek();
  sync();
}

// Hides the timed note and expires its action (the standing messages stay).
export function clearNote(): void {
  clearClock();
  timed.value = null;
}

function clearClock(): void {
  clearTimeout(timer);
  timer = undefined;
  clock = null;
  fadingNote.value = null;
}

// Runs the note's action once, then clears the note. The note is cleared first, because the action may show a note
// of its own, and that note must not be cleared with it.
export function runNoteAction(): void {
  const action = timed.peek()?.action ?? null;
  clearNote();
  action?.run();
}

// The timed note's text ("" when there is none).
export function noteText(): string {
  return timed.peek()?.text ?? "";
}
