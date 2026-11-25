// A press that moves the view and keeps moving while it is held (camera/fly.ts): it steps at once, smoothly, and while
// the press is held it goes on at the rate. A finger's press waits for a short hold first, so a swipe across a toolbar
// scrolls it (the browser cancels the press) instead of turning the view. The React toolbar and the zoom row take
// their presses from here, through the hook in src/react/press.ts.
import { type Held, type Motion, letGo, press } from "../camera/fly";

// A finger's press moves once it has lasted this long; a finger that lifts before that is a tap (see down).
const HOLD_DELAY_MS = 300;

// The parts of a pointer event a press reads: its kind, its id (to capture it), the element that got it.
interface PressEvent {
  pointerType: string;
  pointerId: number;
  currentTarget: EventTarget | null;
  preventDefault(): void;
}

export interface Press {
  down(event: PressEvent): void;
  up(): void; // the press is let go: its move stops after its tap
  cancel(): void; // the browser cancelled the press: nothing more moves
  click(detail: number): void; // a keyboard's Enter or Space clicks with detail 0: one tap
}

// One button's press. `motion` is read each time a move starts (null for a button that makes no move), and
// `beforeStart` runs first (a turn starts its pivot rule, ui/pivot.ts).
export function makePress(motion: () => Motion | null, beforeStart: () => void): Press {
  let held: Held | null = null; // this press's move, from its start until it is let go
  let pending = 0; // a finger's press: the timer that starts the move once the press has lasted the hold delay

  const start = () => {
    window.clearTimeout(pending);
    pending = 0;
    const move = motion();
    if (!move) return;
    beforeStart();
    held = press(move);
  };
  const release = () => {
    if (pending) start();
    if (held) {
      letGo(held);
      held = null;
    }
  };
  return {
    down(event) {
      if (event.pointerType === "touch") {
        pending = window.setTimeout(start, HOLD_DELAY_MS);
        return;
      }
      event.preventDefault();
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      start();
    },
    up: release,
    cancel() {
      window.clearTimeout(pending);
      pending = 0;
      if (held) letGo(held, true);
      held = null;
    },
    click(detail) {
      if (detail !== 0) return;
      start();
      release();
    },
  };
}
