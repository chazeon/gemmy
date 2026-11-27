// The partly occupied sites of a CIF (R12), from the occupancy table fastatoms reads into info, and the one line that
// says them. The same rules as readers/record.py's partial_sites and partial_note.
import type { PartialSite } from "./structure";

// An occupancy within this of 1 is whole (a CIF's rounding is not a vacancy).
const WHOLE_TOLERANCE = 1e-6;

// The occupancy table: a row of the asymmetric unit -> {symbol: occupancy}. `kinds` gives each atom's row.
type OccupancyTable = Record<string, Record<string, number>>;

// The partly occupied sites: an atom whose row is not one species at occupancy 1. No table (a CIF with no occupancy
// column) gives none.
export function partialSites(occupancy: unknown, kinds: ArrayLike<number> | undefined): PartialSite[] {
  if (occupancy === undefined || occupancy === null || kinds === undefined) return [];
  const table = occupancy as OccupancyTable;
  const sites: PartialSite[] = [];
  for (let index = 0; index < kinds.length; index++) {
    const row = table[String(kinds[index])];
    if (row === undefined || isWhole(row)) continue;
    sites.push({ index, occupants: rankedOccupants(row) });
  }
  return sites;
}

function isWhole(row: Record<string, number>): boolean {
  const shares = Object.values(row);
  return shares.length === 1 && Math.abs(shares[0] - 1) <= WHOLE_TOLERANCE;
}

// The occupants, the largest share first and the symbols in code-point order on a tie (as the Python rule sorts).
function rankedOccupants(row: Record<string, number>): Record<string, number> {
  const ranked = Object.entries(row).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(ranked);
}

// The one line that says a read's partly occupied sites: the page's message line shows it, and so does `gemmy compile`
// (record.py's partial_note has the same wording). Null when there are none.
export function partialNote(sites: PartialSite[]): string | null {
  if (sites.length === 0) return null;
  const count = sites.length;
  const kind = sites.every((site) => Object.keys(site.occupants).length > 1) ? "mixed" : "partly occupied";
  const first = Object.entries(sites[0].occupants)
    .map(([symbol, share]) => `${symbol} ${shareText(share)}`)
    .join(" over ");
  const kept = count === 1 ? `kept the larger share (${first})` : `kept the larger share at each (first: ${first})`;
  const noun = count === 1 ? "site" : "sites";
  return `${count} ${kind} ${noun}: ${kept}. Partial occupancy isn't drawn.`;
}

// An occupancy as the Python rule writes it: rounded to 6 decimals, without trailing zeros.
function shareText(share: number): string {
  return String(Number(share.toFixed(6)));
}
