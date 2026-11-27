// The React side of a section's pane: StylePane mounts the Tweakpane adapter on a div and disposes it on unmount, and
// useEdits gives a section its commit function. A rejected edit goes to onError and re-renders the section, so the pane
// refreshes to the config's value (the adapter writes the values back on every render).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Apply, applier } from "../../ui/style-panel-model";
import type { SectionId } from "../inspector/contract";
import { styleReveal, takeReveal } from "./style-reveal";
import { useSignal } from "../use-signal";
import type { SectionProps } from "./props";
import type { PaneNode } from "./pane-model";
import { PaneAdapter } from "./tweakpane-adapter";

// A pane of a section that a click can show a folder in (section): the request for its section is taken once, here.
export function StylePane({ nodes, section }: { nodes: PaneNode[]; section?: SectionId }) {
  const host = useRef<HTMLDivElement>(null);
  const adapter = useRef<PaneAdapter | null>(null);
  const request = useSignal(styleReveal);
  useEffect(() => {
    if (request === null || section === undefined) return;
    const reveal = takeReveal(section);
    if (reveal !== null) adapter.current?.reveal(reveal.key, reveal.focus);
  }, [request, section]);
  // Every render writes the nodes: a change of structure rebuilds the pane, a change of values refreshes it in place.
  useLayoutEffect(() => {
    adapter.current ??= new PaneAdapter(host.current!);
    adapter.current.sync(nodes);
  });
  useEffect(
    () => () => {
      adapter.current?.dispose();
      adapter.current = null;
    },
    [],
  );
  return <div ref={host} className="style-pane" />;
}

// The section's commit: an edit that the config accepts goes to onChange; one it refuses goes to onError, and the section
// re-renders (the state below changes) so that the pane shows the config's value again.
export function useEdits({ onChange, onError }: Pick<SectionProps, "onChange" | "onError">): Apply {
  const [, setRejections] = useState(0);
  return applier(onChange, (message) => {
    onError(message);
    setRejections((count) => count + 1);
  });
}
