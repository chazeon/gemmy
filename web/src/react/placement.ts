// Where menus and popovers open: one gap (the 8 px between the page's islands, style.css) from what they open from. A
// menu from a button inside an island opens from the island's edge, past its 4 px padding, and lines up with it, so it
// does not overlap the bar.
// Both mirror style.css's tokens (--gap, --island-pad), which a menu's place is computed from in TypeScript.
export const GAP = 8;
const ISLAND_PADDING = 4;

export const ISLAND_MENU = { sideOffset: ISLAND_PADDING + GAP, alignOffset: -ISLAND_PADDING };
