from __future__ import annotations

import importlib.util
import unittest

SCIPY_AVAILABLE = importlib.util.find_spec("scipy") is not None
if SCIPY_AVAILABLE:
    from gemmy.compile.lattice import convex_hull_faces


@unittest.skipUnless(SCIPY_AVAILABLE, "SciPy is required for geometry tests.")
class TestGeometry(unittest.TestCase):
    def test_convex_hull_octahedron(self) -> None:
        points = [
            (1.0, 0.0, 0.0),
            (-1.0, 0.0, 0.0),
            (0.0, 1.0, 0.0),
            (0.0, -1.0, 0.0),
            (0.0, 0.0, 1.0),
            (0.0, 0.0, -1.0),
        ]
        faces = convex_hull_faces(points)
        unique_faces = {tuple(sorted(f)) for f in faces}
        self.assertEqual(len(unique_faces), 8)


if __name__ == "__main__":
    unittest.main()
