// The icons that mark a rule's origin on its folder row (tweakpane-adapter.ts): WandSparkles for a detected (automatic)
// rule, PencilLine for the user's own (manual) rule. They are Lucide's paths (ISC), as SVG markup, like eye-icons.ts.
export const ORIGIN_ICONS = {
  automatic: {
    label: "Automatic",
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>',
  },
  manual: {
    label: "Manual",
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 21h8"/><path d="m15 5 4 4"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>',
  },
} as const;
