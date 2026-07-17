"""Unit tests for the in-memory room store — pure, no network."""

import unittest
from unittest.mock import patch

from server import rooms as rooms_module
from server.rooms import RoomStore


class TestRoomStore(unittest.TestCase):
    def setUp(self):
        self.store = RoomStore()

    def test_create_returns_unique_ids(self):
        ids = {self.store.create() for _ in range(20)}
        self.assertEqual(len(ids), 20)

    def test_ids_are_friendly_word_pairs(self):
        for _ in range(10):
            self.assertRegex(self.store.create(), r"^[a-z]+-[a-z]+(-\d\d)?$")

    def test_ids_stay_unique_when_word_pairs_run_out(self):
        # Force every plain pair to collide so the digit fallback kicks in.
        with patch.object(rooms_module, "ADJECTIVES", ["sunny"]), \
             patch.object(rooms_module, "ANIMALS", ["otter"]):
            first = self.store.create()
            second = self.store.create()
        self.assertEqual(first, "sunny-otter")
        self.assertRegex(second, r"^sunny-otter-\d\d$")

    def test_view_unknown_room_is_none(self):
        self.assertIsNone(self.store.view("nope"))

    def test_participants_named_by_join_order(self):
        rid = self.store.create()
        p1 = self.store.add_participant(rid)
        p2 = self.store.add_participant(rid, name="Sam")
        p3 = self.store.add_participant(rid)
        self.assertEqual(p1["name"], "Person 1")
        self.assertEqual(p2["name"], "Sam")
        self.assertEqual(p3["name"], "Person 3")
        view = self.store.view(rid)
        self.assertEqual([p["id"] for p in view["participants"]],
                         [p1["id"], p2["id"], p3["id"]])

    def test_capacity(self):
        rid = self.store.create()
        for _ in range(rooms_module.MAX_PARTICIPANTS):
            self.assertIsInstance(self.store.add_participant(rid), dict)
        self.assertIs(self.store.add_participant(rid), False)

    def test_update_and_located_participants(self):
        rid = self.store.create()
        p1 = self.store.add_participant(rid)
        self.store.add_participant(rid)
        self.assertEqual(self.store.located_participants(rid), [])
        self.store.update_participant(rid, p1["id"], {"lat": 51.5, "lon": -0.1, "label": "home"})
        located = self.store.located_participants(rid)
        self.assertEqual(len(located), 1)
        self.assertEqual(located[0]["label"], "home")

    def test_remove_participant(self):
        rid = self.store.create()
        p1 = self.store.add_participant(rid)
        p2 = self.store.add_participant(rid)
        self.assertIs(self.store.remove_participant(rid, p1["id"]), True)
        view = self.store.view(rid)
        self.assertEqual([p["id"] for p in view["participants"]], [p2["id"]])
        # Idempotent: leaving again is not an error.
        self.assertIs(self.store.remove_participant(rid, p1["id"]), False)
        self.assertIsNone(self.store.remove_participant("nope", p1["id"]))

    def test_removed_participant_frees_a_seat(self):
        rid = self.store.create()
        pids = [self.store.add_participant(rid)["id"]
                for _ in range(rooms_module.MAX_PARTICIPANTS)]
        self.store.remove_participant(rid, pids[0])
        self.assertIsInstance(self.store.add_participant(rid), dict)

    def test_update_unknown_participant_is_none(self):
        rid = self.store.create()
        self.assertIsNone(self.store.update_participant(rid, "ghost", {"lat": 0, "lon": 0}))

    def test_results_versioning(self):
        rid = self.store.create()
        self.assertEqual(self.store.view(rid)["resultsVersion"], 0)
        self.assertEqual(self.store.set_results(rid, {"candidates": []}), 1)
        self.assertEqual(self.store.set_results(rid, {"candidates": []}), 2)
        view = self.store.view(rid)
        self.assertEqual(view["resultsVersion"], 2)
        self.assertEqual(view["results"], {"candidates": []})

    def test_rooms_expire_after_ttl(self):
        store = RoomStore(ttl=100)
        with patch.object(rooms_module, "_now", return_value=0.0):
            rid = store.create()
        with patch.object(rooms_module, "_now", return_value=50.0):
            self.assertIsNotNone(store.view(rid))
        with patch.object(rooms_module, "_now", return_value=200.0):
            self.assertIsNone(store.view(rid))
            self.assertIsNone(store.add_participant(rid))
            self.assertIsNone(store.set_results(rid, {}))

    def test_writes_keep_room_alive(self):
        store = RoomStore(ttl=100)
        with patch.object(rooms_module, "_now", return_value=0.0):
            rid = store.create()
            pid = store.add_participant(rid)["id"]
        with patch.object(rooms_module, "_now", return_value=80.0):
            store.update_participant(rid, pid, {"lat": 51.5, "lon": -0.1})
        with patch.object(rooms_module, "_now", return_value=150.0):
            # 150 is past the original create+TTL but within 80+TTL.
            self.assertIsNotNone(store.view(rid))


if __name__ == "__main__":
    unittest.main()
