"""Generate the example POSCARs deterministically.

    uv run --with ase python examples/make_structures.py          # write examples/*/POSCAR
    uv run --with ase python examples/make_structures.py --check  # regenerate to a temp dir and diff

NaCl and ice are synthetic (ideal lattice parameters, seeded random proton ordering); stishovite uses
experimental lattice parameters.
"""

from __future__ import annotations

import argparse
import difflib
import random
import sys
import tempfile
from collections import deque
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SEED = 20240611


def poscar(comment, lattice, species, frac_by_species):
    """Format a VASP5 POSCAR; species may be labels such as H1 (kept by gemmy as style keys)."""
    lines = [comment, "1.0"]
    lines += [f"  {r[0]:.10f}  {r[1]:.10f}  {r[2]:.10f}" for r in lattice]
    lines.append("  " + "  ".join(species))
    lines.append("  " + "  ".join(str(len(f)) for f in frac_by_species))
    lines.append("Direct")
    for fracs in frac_by_species:
        lines += [f"  {f[0]:.10f}  {f[1]:.10f}  {f[2]:.10f}" for f in fracs]
    return "\n".join(lines) + "\n"


def rocksalt(name, a, cation, anion):
    lattice = np.eye(3) * a
    cat = [(0, 0, 0), (0, 0.5, 0.5), (0.5, 0, 0.5), (0.5, 0.5, 0)]
    ani = [(0.5, 0, 0), (0, 0.5, 0), (0, 0, 0.5), (0.5, 0.5, 0.5)]
    return poscar(f"{name} rock salt, a={a} A (synthetic)", lattice, [cation, anion], [cat, ani])


def stishovite():
    """Rutile-type SiO2, P4_2/mnm: Si on 2a, O on 4f (x, x, 0). a, c, x from Ross et al. (1990)."""
    a, c, x = 4.1801, 2.6678, 0.3062
    si = [(0, 0, 0), (0.5, 0.5, 0.5)]
    o = [(x, x, 0), (1 - x, 1 - x, 0), (0.5 + x, 0.5 - x, 0.5), (0.5 - x, 0.5 + x, 0.5)]
    return poscar(f"Stishovite SiO2 (rutile type), a={a} c={c} A, O x={x}", np.diag([a, a, c]), ["Si", "O"], [si, o])


def nacl():
    return rocksalt("NaCl", 5.640, "Na", "Cl")


# ---------------------------------------------------------------- ice Ih

A_HEX, C_HEX, OH = 4.52, 7.37, 1.0
REPEAT = (2, 2, 1)  # of the 8-molecule orthohexagonal cell -> 32 molecules


def ortho_oxygens():
    """Oxygen fractional coordinates of the 8-molecule orthohexagonal cell (wurtzite-type O lattice)."""
    hexpos = [(1 / 3, 2 / 3, 0), (2 / 3, 1 / 3, 0.5), (1 / 3, 2 / 3, 3 / 8), (2 / 3, 1 / 3, 7 / 8)]
    lx, ly = A_HEX, A_HEX * np.sqrt(3)
    found = {}
    for n1 in range(-3, 4):
        for n2 in range(-3, 4):
            for x, y, z in hexpos:
                x, y = x + n1, y + n2
                f = np.array([(x - y / 2) * A_HEX / lx, (y * np.sqrt(3) / 2) * A_HEX / ly, z]) % 1.0
                f = np.round(f, 6) % 1.0
                found[tuple(f)] = f
    out = sorted(found.values(), key=lambda f: (round(f[2], 4), round(f[0], 4), round(f[1], 4)))
    assert len(out) == 8, len(out)
    return out


def _edges(oxy_cart, cell):
    """Undirected O-O links as (i, j, vec) with vec = r_j + shift - r_i (periodic)."""
    from ase import Atoms
    from ase.neighborlist import neighbor_list

    atoms = Atoms(f"O{len(oxy_cart)}", positions=oxy_cart, cell=cell, pbc=True)
    i, j, s, d = neighbor_list("ijSD", atoms, 3.2)
    edges = []
    for a, b, sh, vec in zip(i, j, s, d, strict=True):
        if (a, b, tuple(sh)) < (b, a, tuple(-sh)):
            edges.append((int(a), int(b), vec))
    return edges


def _orient(n, edges, rng):
    """Random proton ordering obeying the ice rules; donor[e] is the O that holds the H of link e."""
    donor = [e[rng.randrange(2)] for e in edges]
    out = [[] for _ in range(n)]  # out[o] = links o donates
    for k, d in enumerate(donor):
        out[d].append(k)

    def other(k, o):
        return edges[k][1] if edges[k][0] == o else edges[k][0]

    def flip(k):
        o = donor[k]
        out[o].remove(k)
        donor[k] = other(k, o)
        out[donor[k]].append(k)

    # Phase 1: reverse paths from O with >2 donated H to O with <2.
    while any(len(o) > 2 for o in out):
        src = next(i for i in range(n) if len(out[i]) > 2)
        prev = {src: None}
        queue = deque([src])
        dst = None
        while queue and dst is None:
            u = queue.popleft()
            for k in out[u]:
                v = other(k, u)
                if v not in prev:
                    prev[v] = (u, k)
                    if len(out[v]) < 2:
                        dst = v
                        break
                    queue.append(v)
        path = []
        while prev[dst] is not None:
            u, k = prev[dst]
            path.append(k)
            dst = u
        for k in path:
            flip(k)
    # Phase 2: randomise by reversing directed loops (keeps every O at exactly 2 donated H).
    for _ in range(20 * len(edges)):
        nodes, links = [rng.randrange(n)], []
        while True:
            k = rng.choice(out[nodes[-1]])
            nxt = other(k, nodes[-1])
            links.append(k)
            if nxt in nodes:
                loop = links[nodes.index(nxt) :]
                break
            nodes.append(nxt)
        for k in loop:
            flip(k)
    return donor


def ice_ih():
    rng = random.Random(SEED)
    base = ortho_oxygens()
    lx, ly, lz = A_HEX, A_HEX * np.sqrt(3), C_HEX
    nx, ny, nz = REPEAT
    cell = np.diag([lx * nx, ly * ny, lz * nz])
    frac = []
    for ix in range(nx):
        for iy in range(ny):
            for iz in range(nz):
                for f in base:
                    frac.append((f + [ix, iy, iz]) / [nx, ny, nz])
    frac = np.array(frac)
    cart = frac @ cell
    n = len(frac)
    edges = _edges(cart, cell)
    assert len(edges) == 2 * n, (len(edges), n)
    donor = _orient(n, edges, rng)

    h1, h2 = [], []
    stats = {"OH": [], "OO": [], "HO": []}
    hcart = []
    for k, (i, j, vec) in enumerate(edges):
        src, tgt = (i, j) if donor[k] == i else (j, i)
        v = vec if donor[k] == i else -vec
        u = v / np.linalg.norm(v)
        hpos = cart[src] + OH * u
        hcart.append((src, tgt, hpos, u))
        stats["OO"].append(np.linalg.norm(v))
    for _src, _tgt, hpos, u in hcart:
        f = (hpos @ np.linalg.inv(cell)) % 1.0
        (h1 if u[2] > 0 else h2).append(f)
    h1.sort(key=lambda f: tuple(np.round(f, 6)))
    h2.sort(key=lambda f: tuple(np.round(f, 6)))

    _verify(cart, np.array(h1 + h2) @ cell, cell, edges, donor, stats)
    text = poscar(
        f"Ice Ih, proton-disordered (ice rules), {n} H2O (synthetic, seed {SEED})",
        cell,
        ["O", "H1", "H2"],
        [frac, h1, h2],
    )
    return text


def _verify(ocart, hcart, cell, edges, donor, stats):
    """Assert the ice rules on the final coordinates and print O-H / O...O statistics."""
    from ase import Atoms
    from ase.neighborlist import neighbor_list

    n = len(ocart)
    atoms = Atoms(f"O{n}H{len(hcart)}", positions=np.vstack([ocart, hcart]), cell=cell, pbc=True)
    i, j, d = neighbor_list("ijd", atoms, 2.2)
    near = [0] * n  # H covalently bound to each O (< 1.2 A)
    far = [0] * n  # H hydrogen-bonded to each O (1.5 - 2.0 A)
    hbound = {}
    oh, hb = [], []
    for a, b, dist in zip(i, j, d, strict=True):
        if a < n <= b:
            if dist < 1.2:
                near[a] += 1
                hbound.setdefault(b, []).append(a)
                oh.append(dist)
            elif 1.5 < dist < 2.0:
                far[a] += 1
                hb.append(dist)
    assert all(c == 2 for c in near), "each O must have exactly 2 near H"
    assert all(c == 2 for c in far), "each O must accept exactly 2 H bonds"
    assert len(hbound) == len(hcart) and all(len(v) == 1 for v in hbound.values()), "each H bound to one O"
    assert len(hcart) == 2 * n
    # each O-O link carries exactly one H (donor[k] holds it): 2n links, 2n H
    assert len(edges) == len(hcart)
    oo = np.array(stats["OO"])
    oh, hb = np.array(oh), np.array(hb)
    print(f"ice Ih: {n} O, {len(hcart)} H, {len(edges)} O-O links; ice rules satisfied")
    print(f"  O-H   : n={len(oh)} mean={oh.mean():.3f} min={oh.min():.3f} max={oh.max():.3f} A")
    print(f"  H...O : n={len(hb)} mean={hb.mean():.3f} min={hb.min():.3f} max={hb.max():.3f} A")
    print(f"  O...O : n={len(oo)} mean={oo.mean():.3f} min={oo.min():.3f} max={oo.max():.3f} A")


GENERATORS = {"nacl": nacl, "ice-ih": ice_ih, "stishovite": stishovite}


def write_all(root: Path) -> None:
    for name, gen in GENERATORS.items():
        out = root / name / "POSCAR"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(gen())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="regenerate to a temp dir and diff against committed POSCARs")
    args = ap.parse_args()
    if not args.check:
        write_all(HERE)
        return 0
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        write_all(Path(tmp))
        for name in GENERATORS:
            new = (Path(tmp) / name / "POSCAR").read_text().splitlines()
            old_path = HERE / name / "POSCAR"
            old = old_path.read_text().splitlines() if old_path.exists() else []
            diff = list(difflib.unified_diff(old, new, f"committed/{name}", f"generated/{name}", lineterm=""))
            if diff:
                bad += 1
                print("\n".join(diff[:40]))
    print("examples up to date" if not bad else f"{bad} POSCAR(s) differ")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
