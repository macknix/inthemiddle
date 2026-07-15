"""Tests for the Transitous client: response parsing, caching, errors.

All HTTP is faked — no network needed.
"""

import unittest
from unittest.mock import MagicMock

from server.transitous import TransitousClient, TransitousError


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


def make_client(payload, status_code=200):
    client = TransitousClient()
    client.session = MagicMock()
    client.session.get.return_value = FakeResponse(payload, status_code)
    return client


ONE_TO_ALL_PAYLOAD = {
    "one": {"lat": 51.5455, "lon": -0.0553},
    "all": [
        {
            "place": {
                "name": "Highbury & Islington",
                "stopId": "gb_HHY",
                "lat": 51.5464,
                "lon": -0.1031,
            },
            "duration": 28,
            "k": 1,
        },
        {
            "place": {
                "name": "Liverpool Street",
                "stopId": "gb_LST",
                "lat": 51.5179,
                "lon": -0.0812,
            },
            "duration": 31,
            "k": 3,
        },
        # No stopId (e.g. the origin itself) — must be skipped.
        {"place": {"name": "START", "lat": 51.5455, "lon": -0.0553}, "duration": 0, "k": 0},
    ],
}


class TestOneToAll(unittest.TestCase):
    def test_parses_stops_and_transfers(self):
        client = make_client(ONE_TO_ALL_PAYLOAD)
        reach = client.one_to_all(51.5455, -0.0553, 60)
        self.assertEqual(set(reach), {"gb_HHY", "gb_LST"})
        self.assertEqual(reach["gb_HHY"]["minutes"], 28)
        # k counts connections, so transfers = k - 1.
        self.assertEqual(reach["gb_HHY"]["transfers"], 0)
        self.assertEqual(reach["gb_LST"]["transfers"], 2)

    def test_caches_identical_requests(self):
        client = make_client(ONE_TO_ALL_PAYLOAD)
        client.one_to_all(51.5455, -0.0553, 60)
        client.one_to_all(51.5455, -0.0553, 60)
        self.assertEqual(client.session.get.call_count, 1)

    def test_different_budget_misses_cache(self):
        client = make_client(ONE_TO_ALL_PAYLOAD)
        client.one_to_all(51.5455, -0.0553, 60)
        client.one_to_all(51.5455, -0.0553, 45)
        self.assertEqual(client.session.get.call_count, 2)

    def test_http_error_raises(self):
        client = make_client({"error": "boom"}, status_code=500)
        with self.assertRaises(TransitousError):
            client.one_to_all(51.5455, -0.0553, 60)


GEOCODE_PAYLOAD = [
    {
        "type": "STOP",
        "name": "Hackney Town Hall",
        "lat": 51.5452,
        "lon": -0.0553,
        "areas": [
            {"name": "Greater London", "matched": False},
            {"name": "London Borough of Hackney", "matched": True},
        ],
    }
] * 10  # more than the client should return


class TestGeocode(unittest.TestCase):
    def test_bias_sends_place_params(self):
        client = make_client(GEOCODE_PAYLOAD)
        client.geocode("SW9", bias=(51.5074, -0.1278))
        params = client.session.get.call_args.kwargs["params"]
        self.assertEqual(params["place"], "51.5074,-0.1278")
        self.assertGreater(params["placeBias"], 1)

    def test_no_bias_omits_place_params(self):
        client = make_client(GEOCODE_PAYLOAD)
        client.geocode("SW9")
        params = client.session.get.call_args.kwargs["params"]
        self.assertNotIn("place", params)

    def test_parses_and_limits_results(self):
        client = make_client(GEOCODE_PAYLOAD)
        results = client.geocode("Hackney Town Hall")
        self.assertEqual(len(results), 6)
        first = results[0]
        self.assertEqual(first["name"], "Hackney Town Hall")
        self.assertIn("Greater London", first["label"])
        self.assertEqual(first["lat"], 51.5452)


PLAN_PAYLOAD = {
    "itineraries": [
        {
            "duration": 1740,
            "startTime": "2026-07-05T12:00:00Z",
            "endTime": "2026-07-05T12:29:00Z",
            "transfers": 0,
            "legs": [
                {
                    "mode": "WALK",
                    "from": {"name": "START"},
                    "to": {"name": "Hackney Central"},
                    "duration": 300,
                    "legGeometry": {"points": "abc", "precision": 6},
                },
                {
                    "mode": "SUBURBAN",
                    "routeShortName": "Mildmay",
                    "from": {"name": "Hackney Central"},
                    "to": {"name": "Highbury & Islington"},
                    "duration": 1440,
                    "legGeometry": {"points": "def", "precision": 6},
                },
            ],
        }
    ]
}


class TestPlan(unittest.TestCase):
    def test_parses_itinerary_legs(self):
        client = make_client(PLAN_PAYLOAD)
        itinerary = client.plan(51.5455, -0.0553, 51.5464, -0.1031)
        self.assertEqual(itinerary["duration"], 1740)
        self.assertEqual(len(itinerary["legs"]), 2)
        self.assertEqual(itinerary["legs"][1]["route"], "Mildmay")
        self.assertEqual(itinerary["legs"][1]["geometry"]["points"], "def")

    def test_returns_none_when_no_itineraries(self):
        client = make_client({"itineraries": []})
        self.assertIsNone(client.plan(51.5455, -0.0553, 51.5464, -0.1031))


if __name__ == "__main__":
    unittest.main()
