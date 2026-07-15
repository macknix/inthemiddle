"""Meeting-point algorithm.

One `one-to-all` transit query per person gives the true door-to-stop
travel time to every stop the network can reach. Intersecting the sets
yields every stop everyone can get to; ranking is minimax — minimise the
slowest person's travel time, i.e. the earliest moment you can all be there
(ties broken by combined travel time).
"""

import math
from typing import Dict, List

# Results closer together than this are the same "place" — a station and its
# entrances, or several bus stops on one junction.
MIN_SEPARATION_M = 400


def intersect_reachability(reaches: List[Dict[str, Dict]]) -> List[Dict]:
    """Stops reachable by everyone, with each person's travel time.

    `reaches` is one {stop_id: {name, lat, lon, minutes, transfers}} dict per
    person; candidate `minutes`/`transfers` lists follow the same order.
    """
    if not reaches:
        return []
    common_ids = set(reaches[0])
    for reach in reaches[1:]:
        common_ids &= set(reach)

    candidates = []
    for stop_id in common_ids:
        first = reaches[0][stop_id]
        candidates.append(
            {
                "id": stop_id,
                "name": first["name"],
                "lat": first["lat"],
                "lon": first["lon"],
                "minutes": [reach[stop_id]["minutes"] for reach in reaches],
                "transfers": [reach[stop_id]["transfers"] for reach in reaches],
            }
        )
    return candidates


def minimax_key(c: Dict) -> tuple:
    return (max(c["minutes"]), sum(c["minutes"]))


def _norm_name(name: str) -> str:
    n = name.lower().strip()
    for suffix in (" station", " underground station", " rail station"):
        n = n.removesuffix(suffix)
    return n


def distance_m(c1: Dict, c2: Dict) -> float:
    """Approximate ground distance between two {lat, lon} dicts in metres."""
    dlat = (c2["lat"] - c1["lat"]) * 111_320
    dlon = (c2["lon"] - c1["lon"]) * 111_320 * math.cos(math.radians(c1["lat"]))
    return math.hypot(dlat, dlon)


def _select_distinct(sorted_candidates: List[Dict], top_n: int) -> List[Dict]:
    """Greedily pick the best candidates that are genuinely different places."""
    picked: List[Dict] = []
    names = set()
    for c in sorted_candidates:
        name = _norm_name(c["name"])
        if name in names:
            continue
        if any(distance_m(c, p) < MIN_SEPARATION_M for p in picked):
            continue
        picked.append(c)
        names.add(name)
        if len(picked) == top_n:
            break
    return picked


def rank(candidates: List[Dict], top_n: int = 8) -> List[Dict]:
    """Top N distinct meeting spots, fairest (minimax) first."""
    if not candidates:
        return []
    return _select_distinct(sorted(candidates, key=minimax_key), top_n)


def geographic_midpoint(points: List[Dict]) -> Dict[str, float]:
    """Spherical centroid of N points — kept for showing why distance-middle lies.

    Mean of the unit vectors, so for two points it is the great-circle midpoint.
    """
    x = y = z = 0.0
    for p in points:
        lat, lon = math.radians(p["lat"]), math.radians(p["lon"])
        x += math.cos(lat) * math.cos(lon)
        y += math.cos(lat) * math.sin(lon)
        z += math.sin(lat)
    n = len(points)
    x, y, z = x / n, y / n, z / n
    return {
        "lat": math.degrees(math.atan2(z, math.hypot(x, y))),
        "lon": math.degrees(math.atan2(y, x)),
    }
