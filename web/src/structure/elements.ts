// The element rule, one definition for the page: which element a species label names. A test holds the symbol list to
// ASE's chemical symbols (test_ts_config.py).

// ase.data.chemical_symbols: index 0 is the dummy element X, and index z the element of atomic number z.
const SYMBOL_TEXT =
  "X H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br " +
  "Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er " +
  "Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md " +
  "No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og";
export const CHEMICAL_SYMBOLS: readonly string[] = SYMBOL_TEXT.split(" ");

// The dummy element: a LAMMPS type that the map and the file do not resolve. It has no radius and no bonds.
export const DUMMY_ELEMENT = "X";

const ELEMENT_SET: ReadonlySet<string> = new Set(CHEMICAL_SYMBOLS);
const ATOMIC_NUMBERS: ReadonlyMap<string, number> = new Map(CHEMICAL_SYMBOLS.map((symbol, z) => [symbol, z]));

// The atomic number of an element symbol (X is 0), or -1 for a name that is not an element.
export function atomicNumber(symbol: string): number {
  return ATOMIC_NUMBERS.get(symbol) ?? -1;
}

// The two letters that stand for hydrogen isotopes, which name hydrogen.
const ISOTOPE_ELEMENTS: Readonly<Record<string, string>> = { D: "H", T: "H" };

// The element a label names, or undefined when it names none. The leading letters decide: two letters name an element
// first when they spell one in any case (`fe` is Fe), else the first letter does (`Hx` is H, `Xc` is the dummy X), and D
// and T are hydrogen. So `Fe1`, `Fe_pv`, `fe` and `O2-` name an element, while `Qq`, `Fee` and `1` name none.
export function elementOfLabel(label: string): string | undefined {
  const head = /^[A-Za-z]*/.exec(label)?.[0] ?? "";
  if (head.length < 1 || head.length > 2) return undefined;
  const pair = head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
  if (head.length === 2 && ELEMENT_SET.has(pair)) return pair;
  const first = head.charAt(0).toUpperCase();
  if (Object.hasOwn(ISOTOPE_ELEMENTS, first)) return ISOTOPE_ELEMENTS[first];
  return ELEMENT_SET.has(first) ? first : undefined;
}

// Whether a label names an element (elementOfLabel finds one).
export function isElementLabel(label: string): boolean {
  return elementOfLabel(label) !== undefined;
}
