"""Unit tests for the minimax meeting-point logic — pure, no network.

Run the whole suite: python -m unittest discover -s server/tests -t .
"""

import unittest

from server import algorithms

# Sample coordinates (real places, used across the tests)
HACKNEY_TOWN_HALL = {"lat": 51.5455, "lon": -0.0553}
BRIXTON_STATION = {"lat": 51.4613, "lon": -0.1156}
HIGHBURY_ISLINGTON = {"lat": 51.5464, "lon": -0.1031}
LIVERPOOL_STREET = {"lat": 51.5179, "lon": -0.0812}


def stop(sid, lat, lon, minutes, transfers=0):
    return {
        "name": sid,
        "lat": lat,
        "lon": lon,
        "minutes": minutes,
        "transfers": transfers,
    }


def candidate(cid, lat, lon, *times):
    return {
        "id": cid,
        "name": cid,
        "lat": lat,
        "lon": lon,
        "minutes": list(times),
        "transfers": [0] * len(times),
    }


class TestDistance(unittest.TestCase):
    def test_one_hundredth_degree_latitude(self):
        a = {"lat": 51.5, "lon": -0.1}
        b = {"lat": 51.51, "lon": -0.1}
        self.assertAlmostEqual(algorithms.distance_m(a, b), 1113.2, delta=5)

    def test_hackney_to_brixton_sample(self):
        # Straight-line distance is ~10.3 km.
        d = algorithms.distance_m(HACKNEY_TOWN_HALL, BRIXTON_STATION)
        self.assertGreater(d, 9_500)
        self.assertLess(d, 11_000)

    def test_roughly_symmetric(self):
        # The equirectangular approximation scales longitude by the first
        # point's latitude, so reversing the arguments differs by a few
        # metres over 10 km — fine for a 400 m de-dupe threshold.
        self.assertAlmostEqual(
            algorithms.distance_m(HACKNEY_TOWN_HALL, BRIXTON_STATION),
            algorithms.distance_m(BRIXTON_STATION, HACKNEY_TOWN_HALL),
            delta=10,
        )

    def test_zero_for_same_point(self):
        self.assertEqual(algorithms.distance_m(BRIXTON_STATION, BRIXTON_STATION), 0)


class TestIntersect(unittest.TestCase):
    def test_only_common_stops_survive(self):
        reach_a = {"x": stop("x", 51.5, -0.1, 10), "y": stop("y", 51.6, -0.1, 20)}
        reach_b = {"y": stop("y", 51.6, -0.1, 30), "z": stop("z", 51.7, -0.1, 5)}
        candidates = algorithms.intersect_reachability([reach_a, reach_b])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["id"], "y")
        self.assertEqual(candidates[0]["minutes"], [20, 30])

    def test_three_people_all_must_reach(self):
        reach_a = {"x": stop("x", 51.5, -0.1, 10), "y": stop("y", 51.6, -0.1, 20)}
        reach_b = {"x": stop("x", 51.5, -0.1, 15), "y": stop("y", 51.6, -0.1, 25)}
        reach_c = {"y": stop("y", 51.6, -0.1, 12)}
        candidates = algorithms.intersect_reachability([reach_a, reach_b, reach_c])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["id"], "y")
        self.assertEqual(candidates[0]["minutes"], [20, 25, 12])

    def test_transfers_carried_through(self):
        reach_a = {"y": stop("y", 51.6, -0.1, 20, transfers=1)}
        reach_b = {"y": stop("y", 51.6, -0.1, 30, transfers=2)}
        c = algorithms.intersect_reachability([reach_a, reach_b])[0]
        self.assertEqual(c["transfers"], [1, 2])

    def test_empty_when_disjoint(self):
        self.assertEqual(
            algorithms.intersect_reachability([{"x": stop("x", 0, 0, 1)}, {}]), []
        )

    def test_empty_input(self):
        self.assertEqual(algorithms.intersect_reachability([]), [])


class TestRank(unittest.TestCase):
    def setUp(self):
        # Spread candidates out so distinct-place selection keeps them all.
        self.cands = [
            candidate("even", 51.50, -0.10, 25, 25),    # minimax 25, total 50
            candidate("skewed", 51.52, -0.20, 10, 24),  # minimax 24 — winner
            candidate("cheap", 51.54, -0.30, 5, 28),    # minimax 28, cheapest total
            candidate("far", 51.60, -0.40, 60, 61),     # slowest, ranks last
        ]

    def test_minimises_slowest_persons_journey(self):
        ranked = algorithms.rank(self.cands)
        self.assertEqual([c["id"] for c in ranked], ["skewed", "even", "cheap", "far"])

    def test_ties_broken_by_total_time(self):
        tied = [
            candidate("tied_slow", 51.50, -0.10, 30, 30),  # total 60
            candidate("tied_fast", 51.55, -0.20, 12, 30),  # total 42, same minimax
        ]
        ranked = algorithms.rank(tied)
        self.assertEqual(ranked[0]["id"], "tied_fast")

    def test_three_person_minimax(self):
        cands = [
            candidate("balanced", 51.50, -0.10, 20, 21, 22),  # minimax 22 — winner
            candidate("one_far", 51.55, -0.20, 5, 6, 40),     # minimax 40
        ]
        ranked = algorithms.rank(cands)
        self.assertEqual(ranked[0]["id"], "balanced")

    def test_nearby_duplicates_collapse_to_best(self):
        near_dupes = [
            candidate("worse", 51.5001, -0.1001, 30, 30),
            candidate("better", 51.5002, -0.1002, 20, 20),
        ]
        ranked = algorithms.rank(near_dupes)
        self.assertEqual([c["id"] for c in ranked], ["better"])

    def test_same_station_name_variants_collapse(self):
        variants = [
            candidate("Highbury & Islington", 51.5464, -0.1031, 20, 20),
            # >400 m away but same place name — still a duplicate.
            candidate("Highbury & Islington Station", 51.5510, -0.1031, 25, 25),
        ]
        ranked = algorithms.rank(variants)
        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0]["id"], "Highbury & Islington")

    def test_top_n_respected(self):
        self.assertEqual(len(algorithms.rank(self.cands, top_n=2)), 2)

    def test_empty_input(self):
        self.assertEqual(algorithms.rank([]), [])


class TestGeographicMidpoint(unittest.TestCase):
    def test_midpoint_between_equal_latitudes(self):
        mid = algorithms.geographic_midpoint(
            [{"lat": 51.5, "lon": -0.2}, {"lat": 51.5, "lon": 0.0}]
        )
        self.assertAlmostEqual(mid["lon"], -0.1, places=3)
        self.assertGreater(mid["lat"], 51.49)

    def test_hackney_brixton_midpoint_lands_between(self):
        mid = algorithms.geographic_midpoint([HACKNEY_TOWN_HALL, BRIXTON_STATION])
        self.assertTrue(BRIXTON_STATION["lat"] < mid["lat"] < HACKNEY_TOWN_HALL["lat"])
        self.assertTrue(BRIXTON_STATION["lon"] < mid["lon"] < HACKNEY_TOWN_HALL["lon"])

    def test_three_point_centroid_inside_triangle(self):
        mid = algorithms.geographic_midpoint(
            [HACKNEY_TOWN_HALL, BRIXTON_STATION, LIVERPOOL_STREET]
        )
        lats = [p["lat"] for p in (HACKNEY_TOWN_HALL, BRIXTON_STATION, LIVERPOOL_STREET)]
        lons = [p["lon"] for p in (HACKNEY_TOWN_HALL, BRIXTON_STATION, LIVERPOOL_STREET)]
        self.assertTrue(min(lats) < mid["lat"] < max(lats))
        self.assertTrue(min(lons) < mid["lon"] < max(lons))


if __name__ == "__main__":
    unittest.main()
