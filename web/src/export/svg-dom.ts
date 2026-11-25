// The SVG export's elements, made with the DOM: createElementNS, setAttribute, append. The browser escapes every
// attribute and text value, so no string is ever written into markup. Browser only (it needs `document`); the node
// tests never load it.
import { fmt } from "./markup";

const SVG_NS = "http://www.w3.org/2000/svg";

// An attribute value: a number is written with fmt, a string as it is; undefined and false leave the attribute out.
export type Attrs = Record<string, string | number | false | undefined>;

// A child of an element: another node, a string (a text node), or null (skipped, so a missing part needs no check).
type Child = Node | string | null;

// An SVG element with its attributes set, in the order given, and its children appended.
export function svgEl(tag: string, attrs: Attrs, children: Child[] = []): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, typeof value === "number" ? fmt(value) : value);
  }
  node.append(...children.filter((child): child is Node | string => child !== null));
  return node;
}
