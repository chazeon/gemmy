// The overlay's icons: their sizes (Lucide, each with its stroke weight), so the controls of one kind draw alike. Spread
// them on an icon: <Icon {...ICON} />. And the colour a button's icon is cut out with (CUTOUT).

// The toolbar, the corner buttons, the lens row and the menu's button: 20 px, a 1.75 stroke (crisp at 1x and 2x).
export const ICON = { size: 20, strokeWidth: 1.75 };
// The zoom buttons, the keyboard help's mice and the start screen's address icon: 16 px, the same stroke.
export const ICON_SMALL = { size: 16, strokeWidth: 1.75 };
// The rows of the menus and the Export menu: 16 px at Lucide's own 2 stroke.
export const MENU_ICON = { size: 16, strokeWidth: 2 };

// A button's cut-out: the colour that the lens number's halo and the move icon's fill take, set on the button as --cutout.
// It is the bar's colour at rest and the hover's on hover, so the icon's part that cuts into a neighbouring stroke matches
// the background it sits on.
export const CUTOUT = "[--cutout:var(--bar)] hover:[--cutout:var(--hover)]";
