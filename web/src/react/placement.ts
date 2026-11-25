// Where menus and popovers open: one gap (the 8 px between the page's islands, style.css) from what they open from. A
// menu from a button inside an island opens from the island's edge, past its 4 px padding, and lines up with it, so it
// does not overlap the bar.
export const GAP = 8;
const ISLAND_PADDING = 4;

export const ISLAND_MENU = { sideOffset: ISLAND_PADDING + GAP, alignOffset: -ISLAND_PADDING };
