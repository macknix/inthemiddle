"""In-memory store for shared meeting rooms.

A room is a shareable id plus each participant's pin, so a link like
`/?room=abc123` puts everyone on the same map. Rooms are deliberately
ephemeral: they live in process memory and expire ROOM_TTL_SECONDS after
the last write, which suits a single-process personal deployment. Restarting
the server empties all rooms.
"""

import secrets
import threading
import time
from typing import Dict, List, Optional

ROOM_TTL_SECONDS = 24 * 3600
# Every located participant costs a Transitous one-to-all query per search,
# so keep rooms small out of fair-use politeness.
MAX_PARTICIPANTS = 5

# Room ids are short word pairs so the share link stays tiny and readable
# aloud. That makes them guessable in principle — acceptable for ephemeral
# rooms that only ever hold self-reported pins on a personal deployment.
ADJECTIVES = [
    "amber", "bold", "brave", "breezy", "bright", "calm", "cheery", "clever",
    "cosy", "eager", "fancy", "fuzzy", "gentle", "giddy", "golden", "happy",
    "jolly", "keen", "kind", "lively", "lucky", "mellow", "merry", "nimble",
    "perky", "plucky", "proud", "quick", "quiet", "rosy", "shiny", "snug",
    "spry", "sunny", "swift", "tidy", "warm", "wise", "witty", "zesty",
]
ANIMALS = [
    "badger", "bee", "crow", "deer", "dove", "duck", "ferret", "finch",
    "fox", "frog", "goose", "hare", "heron", "koala", "lark", "lemur",
    "lynx", "mole", "newt", "otter", "owl", "panda", "pony", "puffin",
    "quail", "robin", "seal", "shrew", "sparrow", "squid", "stoat", "swan",
    "tapir", "toad", "trout", "vole", "walrus", "weasel", "wren", "yak",
]


def _now() -> float:
    return time.monotonic()


def _random_name(taken) -> str:
    """A friendly display name like "Sunny Otter", unique within the room."""
    for _ in range(20):
        name = f"{secrets.choice(ADJECTIVES).title()} {secrets.choice(ANIMALS).title()}"
        if name not in taken:
            return name
    return f"Person {len(taken) + 1}"


def _friendly_id(taken) -> str:
    """A word-pair id like `sunny-otter`, digits appended if space runs out."""
    for _ in range(20):
        rid = f"{secrets.choice(ADJECTIVES)}-{secrets.choice(ANIMALS)}"
        if rid not in taken:
            return rid
    while True:
        rid = f"{secrets.choice(ADJECTIVES)}-{secrets.choice(ANIMALS)}-{secrets.randbelow(90) + 10}"
        if rid not in taken:
            return rid


class RoomStore:
    def __init__(self, ttl: float = ROOM_TTL_SECONDS):
        self.ttl = ttl
        self._rooms: Dict[str, Dict] = {}
        self._lock = threading.Lock()

    def create(self) -> str:
        with self._lock:
            self._evict_expired()
            room_id = _friendly_id(self._rooms)
            self._rooms[room_id] = {
                "participants": {},  # pid -> participant dict
                "join_counter": 0,
                "results": None,
                "results_version": 0,
                "touched": _now(),
            }
            return room_id

    def _live(self, room_id: str) -> Optional[Dict]:
        """Room dict if it exists and hasn't expired. Caller holds the lock."""
        room = self._rooms.get(room_id)
        if room is None:
            return None
        if _now() - room["touched"] > self.ttl:
            del self._rooms[room_id]
            return None
        return room

    def _evict_expired(self) -> None:
        cutoff = _now() - self.ttl
        for rid in [r for r, room in self._rooms.items() if room["touched"] < cutoff]:
            del self._rooms[rid]

    def view(self, room_id: str) -> Optional[Dict]:
        """Public snapshot of a room, or None if unknown/expired."""
        with self._lock:
            room = self._live(room_id)
            if room is None:
                return None
            participants = sorted(
                room["participants"].values(), key=lambda p: p["order"]
            )
            return {
                "id": room_id,
                "participants": [dict(p) for p in participants],
                "results": room["results"],
                "resultsVersion": room["results_version"],
            }

    def add_participant(self, room_id: str, name: Optional[str] = None) -> Optional[Dict]:
        """Add a participant; None if the room is unknown, False if it's full."""
        with self._lock:
            room = self._live(room_id)
            if room is None:
                return None
            if len(room["participants"]) >= MAX_PARTICIPANTS:
                return False
            room["join_counter"] += 1
            pid = secrets.token_urlsafe(8)
            taken = {p["name"] for p in room["participants"].values()}
            participant = {
                "id": pid,
                "order": room["join_counter"],
                "name": name or _random_name(taken),
                "lat": None,
                "lon": None,
                "label": None,
            }
            room["participants"][pid] = participant
            room["touched"] = _now()
            return dict(participant)

    def update_participant(self, room_id: str, pid: str, fields: Dict) -> Optional[Dict]:
        """Merge name/lat/lon/label into a participant; None if unknown."""
        with self._lock:
            room = self._live(room_id)
            if room is None:
                return None
            participant = room["participants"].get(pid)
            if participant is None:
                return None
            for key in ("name", "lat", "lon", "label"):
                if key in fields:
                    participant[key] = fields[key]
            room["touched"] = _now()
            return dict(participant)

    def remove_participant(self, room_id: str, pid: str) -> Optional[bool]:
        """Drop a participant (e.g. they closed the tab); None if room unknown.

        Returns whether the participant was present — removing twice is fine,
        which keeps the unload beacon idempotent.
        """
        with self._lock:
            room = self._live(room_id)
            if room is None:
                return None
            found = room["participants"].pop(pid, None) is not None
            if found:
                room["touched"] = _now()
            return found

    def located_participants(self, room_id: str) -> Optional[List[Dict]]:
        """Participants that have a pin, in join order; None if room unknown."""
        view = self.view(room_id)
        if view is None:
            return None
        return [p for p in view["participants"] if p["lat"] is not None]

    def set_results(self, room_id: str, results: Dict) -> Optional[int]:
        """Store shared results, returning the new version; None if unknown."""
        with self._lock:
            room = self._live(room_id)
            if room is None:
                return None
            room["results"] = results
            room["results_version"] += 1
            room["touched"] = _now()
            return room["results_version"]
