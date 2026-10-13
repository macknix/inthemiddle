"""Address search: Transitous first, topped up with Photon.

The MOTIS geocoder knows stop and place names but doesn't index postcodes,
so queries like "E8 1EA" come back empty. Photon (photon.komoot.io, OSM,
free) is built for search-as-you-type and fills that gap. Photon failures
degrade gracefully to whatever Transitous returned.
"""

import logging
from typing import Dict, List, Optional, Tuple

import requests

from .transitous import TransitousError

logger = logging.getLogger(__name__)

PHOTON_URL = "https://photon.komoot.io/api"
USER_AGENT = "inthemiddle/1.0 (personal project; mack.nixon@googlemail.com)"
REQUEST_TIMEOUT = 10

# If Transitous alone finds at least this many *relevant* results, don't
# bother Photon. Count alone isn't enough: for "E2 6LD" MOTIS fuzzy-matches
# three unrelated US places, which must not block the Photon top-up.
MIN_RESULTS_BEFORE_TOPUP = 3
MAX_RESULTS = 6


def _norm_text(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


def _matches_query(result: Dict, text: str) -> bool:
    """Does this result's name plausibly correspond to what was typed?"""
    name = _norm_text(result["name"])
    query = _norm_text(text)
    return bool(name and query) and (query in name or name in query)


def photon_geocode(text: str, bias: Optional[Tuple[float, float]] = None) -> List[Dict]:
    """Query Photon and normalise to the same shape as TransitousClient.geocode."""
    params = {"q": text, "limit": MAX_RESULTS}
    if bias:
        # Rank matches near the bias point first; scale 0.5 is strong enough
        # to put local postcodes above same-named places abroad.
        params.update(
            {"lat": bias[0], "lon": bias[1], "zoom": 12, "location_bias_scale": 0.5}
        )
    try:
        resp = requests.get(
            PHOTON_URL,
            params=params,
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        features = resp.json().get("features", [])
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Photon geocode failed for %r: %s", text, exc)
        return []

    results = []
    for f in features:
        props = f.get("properties", {})
        lon, lat = f.get("geometry", {}).get("coordinates", (None, None))
        if lat is None or lon is None:
            continue
        street = " ".join(
            part for part in (props.get("street"), props.get("housenumber")) if part
        )
        name = props.get("name") or street or props.get("postcode")
        if not name:
            continue
        label_parts = [name] + [
            part
            for part in (props.get("district"), props.get("city"), props.get("postcode"))
            if part and part != name
        ]
        results.append(
            {
                "name": name,
                "label": ", ".join(label_parts),
                "lat": lat,
                "lon": lon,
                "type": (props.get("type") or "place").upper(),
            }
        )
    return results


def _dedupe_key(result: Dict) -> tuple:
    return (result["name"].lower(), round(result["lat"], 3), round(result["lon"], 3))


def search(
    transitous_client, text: str, bias: Optional[Tuple[float, float]] = None
) -> List[Dict]:
    """Merged suggestions: Transitous results first, Photon tops up.

    Either source may fail without taking the dropdown down with it.
    """
    try:
        results = transitous_client.geocode(text, bias)
    except TransitousError as exc:
        logger.warning("Transitous geocode failed for %r: %s", text, exc)
        results = []

    relevant = sum(1 for r in results if _matches_query(r, text))
    if relevant < MIN_RESULTS_BEFORE_TOPUP:
        seen = {_dedupe_key(r) for r in results}
        for r in photon_geocode(text, bias):
            if _dedupe_key(r) not in seen:
                results.append(r)
                seen.add(_dedupe_key(r))

    # Results that look like the query beat fuzzy leftovers, whatever their
    # source; the sort is stable so source order survives within each group.
    results.sort(key=lambda r: 0 if _matches_query(r, text) else 1)
    return results[:MAX_RESULTS]
