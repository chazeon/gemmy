// A load of a tab is an attempt. A tab counts its attempts: each new load takes the next number, and closing the tab
// takes one more, so an attempt is current while it is still the tab's latest and the tab is still open. A load checks
// that after each await and before its native work (the read, the neighbour search, the compile), and stops when it is
// not, so a tab that was closed or reloaded does not show a scene or finish work nobody will see. Pure, so the node
// tests cover it.
export interface Attemptable {
  attempt: number;
}

export interface Attempt {
  current(): boolean;
}

// Thrown by a load that stopped because it is no longer current. Nothing shows it: the caller checks the attempt first.
export class LoadStopped extends Error {
  constructor() {
    super("the load was superseded");
  }
}

// The attempt with this number on the tab, open or not: current while the tab's count is still this number.
export function attemptOf(tab: Attemptable, id: number, isOpen: () => boolean): Attempt {
  return { current: () => tab.attempt === id && isOpen() };
}

// A new attempt on the tab: the tab's count moves on, so every earlier attempt is no longer current.
export function beginAttempt(tab: Attemptable, isOpen: () => boolean): Attempt {
  tab.attempt += 1;
  return attemptOf(tab, tab.attempt, isOpen);
}

// Ends the tab's attempts (its tab is closed).
export function invalidateAttempts(tab: Attemptable): void {
  tab.attempt += 1;
}

export function stopIfStale(attempt: Attempt): void {
  if (!attempt.current()) throw new LoadStopped();
}
