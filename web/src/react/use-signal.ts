// The bridge from the viewer's signals (@preact/signals-core, in state.ts and the ui modules) to React: a component
// that reads a signal through this hook re-renders when the signal changes. The signal stays the source of truth; the
// hook only subscribes to it, so there is no second store.
import { effect, type ReadonlySignal } from "@preact/signals-core";
import { useSyncExternalStore } from "react";

export function useSignal<T>(source: ReadonlySignal<T>): T {
  return useSyncExternalStore(
    (notify) => {
      // effect runs its first time at once; that run only records the signal, so it is not a change.
      let started = false;
      return effect(() => {
        void source.value;
        if (started) notify();
        started = true;
      });
    },
    () => source.peek(),
  );
}
