"""Thin client for the Transitous public transit API (MOTIS engine).

Transitous is free and keyless but fair-use: identify yourself via
User-Agent, cache responses, and keep request volume low.
https://transitous.org/api/
"""

import threading
import time
from typing import Dict, List, Optional

import requests

BASE_URL = "https://api.transitous.org"
USER_AGENT = "inthemiddle/1.0 (personal project; mack.nixon@googlemail.com)"

# one-to-all results depend on the live timetable, so keep the TTL short
# enough that departure times stay roughly honest.
CACHE_TTL_SECONDS = 600
REQUEST_TIMEOUT = 30
# Autocomplete has to feel instant; give up early and let Photon cover it.
GEOCODE_TIMEOUT = 5


class TransitousError(Exception):
    """Raised when the Transitous API returns an error or is unreachable."""


class _TTLCache:
    def __init__(self, ttl: float):
        self.ttl = ttl
        self._data: Dict[str, tuple] = {}
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            entry = self._data.get(key)
            if entry and time.monotonic() - entry[0] < self.ttl:
                return entry[1]
            self._data.pop(key, None)
            return None

    def set(self, key: str, value):
        with self._lock:
            if len(self._data) > 200:
                self._data.clear()
            self._data[key] = (time.monotonic(), value)


class TransitousClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._cache = _TTLCache(CACHE_TTL_SECONDS)

    def _get(self, path: str, params: dict, timeout: float = REQUEST_TIMEOUT) -> dict:
        try:
            resp = self.session.get(f"{BASE_URL}{path}", params=params, timeout=timeout)
        except requests.RequestException as exc:
            raise TransitousError(f"Transitous unreachable: {exc}") from exc
        if resp.status_code != 200:
            raise TransitousError(
                f"Transitous {path} returned {resp.status_code}: {resp.text[:200]}"
            )
        return resp.json()

    def geocode(self, text: str, bias: Optional[tuple] = None) -> List[Dict]:
        """Search stops, addresses and places matching free-form text.

        `bias` is an optional (lat, lon) to rank nearby matches first —
        without it, "SW9" can resolve to Alabama before Brixton.
        """
        params = {"text": text, "language": "en"}
        if bias:
            params["place"] = f"{bias[0]},{bias[1]}"
            params["placeBias"] = 20
        results = self._get("/api/v1/geocode", params, timeout=GEOCODE_TIMEOUT)
        out = []
        for r in results[:6]:
            areas = [a["name"] for a in r.get("areas", []) if a.get("matched") is not None]
            label_parts = [r["name"]] + [a for a in areas[:2] if a != r["name"]]
            out.append(
                {
                    "name": r["name"],
                    "label": ", ".join(label_parts),
                    "lat": r["lat"],
                    "lon": r["lon"],
                    "type": r.get("type"),
                }
            )
        return out

    def one_to_all(
        self, lat: float, lon: float, max_minutes: int, when: Optional[str] = None
    ) -> Dict[str, Dict]:
        """Fastest transit travel time from (lat, lon) to every reachable stop.

        Returns {stop_id: {name, lat, lon, minutes, transfers}}.
        """
        cache_key = f"ota:{lat:.4f},{lon:.4f}:{max_minutes}:{when}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "one": f"{lat},{lon}",
            "maxTravelTime": max_minutes,
            # Let the street leg use the whole budget (default is 15 min):
            # walking can then be the entire journey (k=0 results), not just
            # a short hop to the first stop.
            "maxPreTransitTime": max_minutes * 60,
        }
        if when:
            params["time"] = when
        data = self._get("/api/v6/one-to-all", params)

        reachable = {}
        for entry in data.get("all", []):
            place = entry["place"]
            stop_id = place.get("stopId")
            if not stop_id:
                continue
            # MOTIS "k" counts connections used, so transfers = k - 1.
            reachable[stop_id] = {
                "name": place["name"],
                "lat": place["lat"],
                "lon": place["lon"],
                "minutes": entry["duration"],
                "transfers": max(entry.get("k", 1) - 1, 0),
            }
        self._cache.set(cache_key, reachable)
        return reachable

    def plan(
        self,
        from_lat: float,
        from_lon: float,
        to_lat: float,
        to_lon: float,
        when: Optional[str] = None,
    ) -> Optional[Dict]:
        """Best transit itinerary between two coordinates, for map display."""
        cache_key = f"plan:{from_lat:.5f},{from_lon:.5f}:{to_lat:.5f},{to_lon:.5f}:{when}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        params = {
            "fromPlace": f"{from_lat},{from_lon}",
            "toPlace": f"{to_lat},{to_lon}",
            "numItineraries": 3,
            # Mirror the one-to-all search that ranked this spot: street legs
            # and direct walks may use up to the 90-minute budget cap (the
            # upstream defaults of 15/30 min would produce slower routes than
            # the minutes shown in the results list).
            "maxDirectTime": 90 * 60,
            "maxPreTransitTime": 90 * 60,
            "maxPostTransitTime": 90 * 60,
        }
        if when:
            params["time"] = when
        data = self._get("/api/v6/plan", params)
        # MOTIS suppresses transit itineraries slower than the fastest direct
        # walk, so nearby destinations often have *only* a `direct` result.
        options = data.get("itineraries", []) + data.get("direct", [])[:1]
        if not options:
            return None

        # Earliest arrival, like the ranking metric — not MOTIS's own "best"
        # scoring. endTime strings are uniform ISO from one response, so they
        # compare safely; duration breaks ties in favour of leaving later.
        it = min(options, key=lambda o: (o["endTime"], o["duration"]))
        itinerary = {
            "duration": it["duration"],
            "startTime": it["startTime"],
            "endTime": it["endTime"],
            "transfers": it.get("transfers", 0),
            "legs": [
                {
                    "mode": leg["mode"],
                    "route": leg.get("routeShortName"),
                    "from": leg["from"]["name"],
                    "to": leg["to"]["name"],
                    "duration": leg["duration"],
                    "geometry": leg.get("legGeometry", {}),
                }
                for leg in it["legs"]
            ],
        }
        self._cache.set(cache_key, itinerary)
        return itinerary
