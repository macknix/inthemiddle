"""Tests for the Flask API endpoints.

The Transitous client is mocked with a small sample network modelled on the
Hackney ↔ Brixton search, so these run offline and deterministically.
"""

import unittest
from unittest.mock import patch

from server import app as app_module

HACKNEY = {"lat": 51.5455, "lon": -0.0553}
BRIXTON = {"lat": 51.4613, "lon": -0.1156}
PECKHAM = {"lat": 51.4703, "lon": -0.0694}


def stop(name, lat, lon, minutes, transfers=0):
    return {"name": name, "lat": lat, "lon": lon, "minutes": minutes, "transfers": transfers}


# Sample network: travel times (minutes) from each origin to shared stops.
# Highbury is the fair choice (max 28); Bank is faster in total but skewed.
REACH_FROM_HACKNEY = {
    "highbury": stop("Highbury & Islington", 51.5464, -0.1031, 28),
    "bank": stop("Bank", 51.5133, -0.0886, 33, transfers=1),
    "dalston": stop("Dalston Kingsland", 51.5486, -0.0759, 8),
}
REACH_FROM_BRIXTON = {
    "highbury": stop("Highbury & Islington", 51.5464, -0.1031, 27),
    "bank": stop("Bank", 51.5133, -0.0886, 20, transfers=0),
    "clapham": stop("Clapham Common", 51.4618, -0.1384, 6),
}
REACH_FROM_PECKHAM = {
    "highbury": stop("Highbury & Islington", 51.5464, -0.1031, 35),
    "bank": stop("Bank", 51.5133, -0.0886, 22),
}

REACH_BY_ORIGIN = {
    HACKNEY["lat"]: REACH_FROM_HACKNEY,
    BRIXTON["lat"]: REACH_FROM_BRIXTON,
    PECKHAM["lat"]: REACH_FROM_PECKHAM,
}

SAMPLE_ITINERARY = {
    "duration": 1680,
    "startTime": "2026-07-05T12:00:00Z",
    "endTime": "2026-07-05T12:28:00Z",
    "transfers": 0,
    "legs": [],
}


def fake_one_to_all(lat, lon, *_args):
    return REACH_BY_ORIGIN[lat]


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        app_module.app.config["TESTING"] = True
        self.http = app_module.app.test_client()


class TestMeet(ApiTestCase):
    def meet(self, body):
        with patch.object(
            app_module.client, "one_to_all", side_effect=fake_one_to_all
        ) as mock_ota:
            resp = self.http.post("/api/meet", json=body)
        return resp, mock_ota

    def test_returns_fairest_spot_first(self):
        resp, _ = self.meet({"points": [HACKNEY, BRIXTON]})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        names = [c["name"] for c in data["candidates"]]
        # Only the two shared stops qualify; Highbury wins on minimax
        # (28 vs Bank's 33) even though Bank has the lower total.
        self.assertEqual(names, ["Highbury & Islington", "Bank"])
        self.assertEqual(data["candidates"][0]["minutes"], [28, 27])

    def test_legacy_a_b_body_still_works(self):
        resp, _ = self.meet({"a": HACKNEY, "b": BRIXTON})
        self.assertEqual(resp.status_code, 200)
        names = [c["name"] for c in resp.get_json()["candidates"]]
        self.assertEqual(names, ["Highbury & Islington", "Bank"])

    def test_three_people(self):
        resp, mock_ota = self.meet({"points": [HACKNEY, BRIXTON, PECKHAM]})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(mock_ota.call_count, 3)
        # With Peckham added, Bank (33/20/22, minimax 33) beats
        # Highbury (28/27/35, minimax 35).
        self.assertEqual(data["candidates"][0]["name"], "Bank")
        self.assertEqual(data["candidates"][0]["minutes"], [33, 20, 22])

    def test_stats_and_midpoint_included(self):
        resp, _ = self.meet({"points": [HACKNEY, BRIXTON]})
        data = resp.get_json()
        self.assertEqual(data["stats"], {"reachable": [3, 3], "common": 2})
        self.assertTrue(BRIXTON["lat"] < data["geoMidpoint"]["lat"] < HACKNEY["lat"])

    def test_departure_anchor_defaults_to_the_current_minute(self):
        # The anchor is returned with the results and reused for route
        # lookups, so ranked minutes and displayed routes measure from the
        # same moment.
        resp, mock_ota = self.meet({"points": [HACKNEY, BRIXTON]})
        anchor = resp.get_json()["time"]
        self.assertRegex(anchor, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$")
        for call in mock_ota.call_args_list:
            self.assertEqual(call.args[3], anchor)

    def test_explicit_departure_time_is_kept(self):
        resp, mock_ota = self.meet(
            {"points": [HACKNEY, BRIXTON], "time": "2026-07-20T09:00:00Z"}
        )
        self.assertEqual(resp.get_json()["time"], "2026-07-20T09:00:00Z")
        self.assertEqual(mock_ota.call_args.args[3], "2026-07-20T09:00:00Z")

    def test_max_minutes_is_capped_at_90(self):
        _, mock_ota = self.meet({"points": [HACKNEY, BRIXTON], "maxMinutes": 240})
        for call in mock_ota.call_args_list:
            self.assertEqual(call.args[2], 90)

    def test_single_point_is_rejected(self):
        resp = self.http.post("/api/meet", json={"points": [HACKNEY]})
        self.assertEqual(resp.status_code, 400)

    def test_missing_pin_is_rejected(self):
        resp = self.http.post("/api/meet", json={"a": HACKNEY})
        self.assertEqual(resp.status_code, 400)

    def test_too_many_points_rejected(self):
        resp = self.http.post("/api/meet", json={"points": [HACKNEY] * 6})
        self.assertEqual(resp.status_code, 400)

    def test_no_common_stops_is_404(self):
        with patch.object(
            app_module.client,
            "one_to_all",
            side_effect=lambda lat, lon, *_args: (
                {"only_a": stop("A-land", 51.5, -0.1, 5)}
                if lat == HACKNEY["lat"]
                else {"only_b": stop("B-land", 51.4, -0.1, 5)}
            ),
        ):
            resp = self.http.post("/api/meet", json={"points": [HACKNEY, BRIXTON]})
        self.assertEqual(resp.status_code, 404)
        self.assertIn("error", resp.get_json())


class TestRoutes(ApiTestCase):
    def test_returns_itinerary_per_origin(self):
        with patch.object(app_module.client, "plan", return_value=SAMPLE_ITINERARY):
            resp = self.http.get(
                "/api/routes?from=51.5455,-0.0553&from=51.4613,-0.1156"
                "&from=51.4703,-0.0694&toLat=51.5464&toLon=-0.1031"
            )
        self.assertEqual(resp.status_code, 200)
        itineraries = resp.get_json()["itineraries"]
        self.assertEqual(len(itineraries), 3)
        self.assertEqual(itineraries[0]["duration"], 1680)

    def test_missing_params_rejected(self):
        resp = self.http.get("/api/routes?from=51.5,-0.1")
        self.assertEqual(resp.status_code, 400)

    def test_malformed_from_rejected(self):
        resp = self.http.get("/api/routes?from=oops&toLat=51.5&toLon=-0.1")
        self.assertEqual(resp.status_code, 400)


class TestGeocode(ApiTestCase):
    def test_short_query_returns_empty_without_upstream_call(self):
        with patch.object(app_module.geocoding, "search") as mock_search:
            resp = self.http.get("/api/geocode?q=ab")
        self.assertEqual(resp.get_json(), [])
        mock_search.assert_not_called()

    def test_query_is_passed_to_merged_search(self):
        with patch.object(
            app_module.geocoding, "search", return_value=[{"name": "x"}]
        ) as mock_search:
            resp = self.http.get("/api/geocode?q=Hackney")
        self.assertEqual(resp.get_json(), [{"name": "x"}])
        mock_search.assert_called_once_with(app_module.client, "Hackney", None)

    def test_map_centre_becomes_bias(self):
        with patch.object(app_module.geocoding, "search", return_value=[]) as mock_search:
            self.http.get("/api/geocode?q=SW9&lat=51.5074&lon=-0.1278")
        mock_search.assert_called_once_with(app_module.client, "SW9", (51.5074, -0.1278))


class TestRoomEndpoints(ApiTestCase):
    def create_room(self):
        resp = self.http.post("/api/rooms")
        self.assertEqual(resp.status_code, 201)
        return resp.get_json()["id"]

    def join(self, room_id, name=None):
        resp = self.http.post(
            f"/api/rooms/{room_id}/participants", json={"name": name} if name else {}
        )
        self.assertEqual(resp.status_code, 201)
        return resp.get_json()

    def locate(self, room_id, pid, point, label="somewhere"):
        return self.http.patch(
            f"/api/rooms/{room_id}/participants/{pid}", json={**point, "label": label}
        )

    def test_create_join_and_view(self):
        room_id = self.create_room()
        me = self.join(room_id, name="Mack")
        friend = self.join(room_id)
        self.assertEqual(me["name"], "Mack")
        self.assertEqual(friend["name"], "Person 2")

        view = self.http.get(f"/api/rooms/{room_id}").get_json()
        self.assertEqual([p["id"] for p in view["participants"]], [me["id"], friend["id"]])
        self.assertIsNone(view["results"])
        self.assertEqual(view["resultsVersion"], 0)

    def test_unknown_room_is_404(self):
        self.assertEqual(self.http.get("/api/rooms/nope").status_code, 404)
        self.assertEqual(self.http.post("/api/rooms/nope/participants", json={}).status_code, 404)
        self.assertEqual(self.http.post("/api/rooms/nope/meet", json={}).status_code, 404)

    def test_room_capacity_enforced(self):
        room_id = self.create_room()
        for _ in range(5):
            self.join(room_id)
        resp = self.http.post(f"/api/rooms/{room_id}/participants", json={})
        self.assertEqual(resp.status_code, 409)

    def test_update_location(self):
        room_id = self.create_room()
        me = self.join(room_id)
        resp = self.locate(room_id, me["id"], HACKNEY, label="Hackney Town Hall")
        self.assertEqual(resp.status_code, 200)
        p = self.http.get(f"/api/rooms/{room_id}").get_json()["participants"][0]
        self.assertEqual((p["lat"], p["lon"], p["label"]),
                         (HACKNEY["lat"], HACKNEY["lon"], "Hackney Town Hall"))

    def test_bad_location_rejected(self):
        room_id = self.create_room()
        me = self.join(room_id)
        resp = self.http.patch(
            f"/api/rooms/{room_id}/participants/{me['id']}",
            json={"lat": "not-a-number", "lon": 0},
        )
        self.assertEqual(resp.status_code, 400)

    def test_share_page_served_for_room_links(self):
        resp = self.http.get("/r/sunny-otter")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"in the middle", resp.data)

    def test_leave_room(self):
        room_id = self.create_room()
        me = self.join(room_id)
        friend = self.join(room_id)

        resp = self.http.delete(f"/api/rooms/{room_id}/participants/{me['id']}")
        self.assertEqual(resp.status_code, 204)
        view = self.http.get(f"/api/rooms/{room_id}").get_json()
        self.assertEqual([p["id"] for p in view["participants"]], [friend["id"]])

        # The sendBeacon alias, and idempotency for repeated beacons.
        resp = self.http.post(f"/api/rooms/{room_id}/participants/{me['id']}/leave")
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(
            self.http.post("/api/rooms/nope/participants/x/leave").status_code, 404
        )

    def test_meet_requires_two_located_participants(self):
        room_id = self.create_room()
        me = self.join(room_id)
        self.join(room_id)  # second person never sets a pin
        self.locate(room_id, me["id"], HACKNEY)
        resp = self.http.post(f"/api/rooms/{room_id}/meet", json={})
        self.assertEqual(resp.status_code, 400)

    def test_meet_stores_shared_results(self):
        room_id = self.create_room()
        me = self.join(room_id, name="Mack")
        friend = self.join(room_id, name="Sam")
        self.locate(room_id, me["id"], HACKNEY)
        self.locate(room_id, friend["id"], BRIXTON)

        with patch.object(app_module.client, "one_to_all", side_effect=fake_one_to_all):
            resp = self.http.post(f"/api/rooms/{room_id}/meet", json={})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["resultsVersion"], 1)
        self.assertEqual(data["candidates"][0]["name"], "Highbury & Islington")
        self.assertEqual([p["name"] for p in data["points"]], ["Mack", "Sam"])

        # The whole room sees the same results when polling, including the
        # departure anchor so everyone's route lookups line up.
        view = self.http.get(f"/api/rooms/{room_id}").get_json()
        self.assertEqual(view["resultsVersion"], 1)
        self.assertEqual(view["results"]["candidates"][0]["name"], "Highbury & Islington")
        self.assertEqual(view["results"]["time"], data["time"])
        self.assertRegex(data["time"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$")


if __name__ == "__main__":
    unittest.main()
