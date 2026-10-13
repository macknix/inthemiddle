"""Tests for merged geocoding (Transitous + Photon top-up) — no network."""

import unittest
from unittest.mock import MagicMock, patch

from server import geocoding


def result(name, lat, lon, label=None):
    return {"name": name, "label": label or name, "lat": lat, "lon": lon, "type": "STOP"}


def photon_feature(name=None, lat=51.545, lon=-0.056, **props):
    return {
        "properties": {"name": name, **props},
        "geometry": {"coordinates": [lon, lat]},
    }


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class TestPhotonGeocode(unittest.TestCase):
    @patch("server.geocoding.requests.get")
    def test_postcode_only_result_uses_postcode_as_name(self, mock_get):
        # What Photon actually returns for "E8 1EA": no name, just a postcode.
        mock_get.return_value = FakeResponse(
            {"features": [photon_feature(postcode="E8 1EA", city="London")]}
        )
        results = geocoding.photon_geocode("E8 1EA")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["name"], "E8 1EA")
        self.assertIn("London", results[0]["label"])
        self.assertAlmostEqual(results[0]["lat"], 51.545)

    @patch("server.geocoding.requests.get")
    def test_address_name_falls_back_to_street_and_number(self, mock_get):
        mock_get.return_value = FakeResponse(
            {"features": [photon_feature(street="Mare Street", housenumber="25")]}
        )
        self.assertEqual(geocoding.photon_geocode("25 Mare St")[0]["name"], "Mare Street 25")

    @patch("server.geocoding.requests.get")
    def test_unusable_features_are_skipped(self, mock_get):
        mock_get.return_value = FakeResponse(
            {"features": [{"properties": {}, "geometry": {"coordinates": [0, 0]}}]}
        )
        self.assertEqual(geocoding.photon_geocode("nowhere"), [])

    @patch("server.geocoding.requests.get")
    def test_bias_sends_location_params(self, mock_get):
        mock_get.return_value = FakeResponse({"features": []})
        geocoding.photon_geocode("SW9", bias=(51.5074, -0.1278))
        params = mock_get.call_args.kwargs["params"]
        self.assertEqual((params["lat"], params["lon"]), (51.5074, -0.1278))
        self.assertIn("location_bias_scale", params)

    @patch("server.geocoding.requests.get")
    def test_network_failure_returns_empty(self, mock_get):
        mock_get.side_effect = geocoding.requests.RequestException("photon down")
        self.assertEqual(geocoding.photon_geocode("E8 1EA"), [])


class TestSearch(unittest.TestCase):
    def client_returning(self, results):
        client = MagicMock()
        client.geocode.return_value = results
        return client

    @patch("server.geocoding.photon_geocode")
    def test_enough_relevant_transitous_results_skip_photon(self, mock_photon):
        client = self.client_returning(
            [
                result("Hackney Town Hall", 51.5452, -0.0553),
                result("Hackney Central", 51.5470, -0.0560),
                result("Hackney Downs", 51.5488, -0.0605),
            ]
        )
        results = geocoding.search(client, "Hackney")
        self.assertEqual(len(results), 3)
        mock_photon.assert_not_called()

    @patch("server.geocoding.photon_geocode")
    def test_e2_6ld_regression_fuzzy_junk_does_not_block_topup(self, mock_photon):
        # Real behaviour observed for "E2 6LD": MOTIS fuzzy-matches three
        # unrelated US places, which used to satisfy the "enough results"
        # count and suppress the Photon call entirely.
        client = self.client_returning(
            [
                result("Field E2", 33.2707, -111.7446),   # Arizona
                result("E236L", 33.2541, -97.1533),       # Texas
                result("E296L", 33.2542, -97.1532),       # Texas
            ]
        )
        mock_photon.return_value = [result("E2 6LD", 51.5258, -0.0572)]
        results = geocoding.search(client, "E2 6LD", bias=(51.5074, -0.1278))
        mock_photon.assert_called_once()
        # The exact postcode match must outrank the fuzzy junk.
        self.assertEqual(results[0]["name"], "E2 6LD")

    @patch("server.geocoding.photon_geocode")
    def test_postcode_query_topped_up_by_photon(self, mock_photon):
        client = self.client_returning([])  # Transitous finds nothing for postcodes
        mock_photon.return_value = [result("E8 1EA", 51.5451, -0.0564)]
        results = geocoding.search(client, "E8 1EA")
        self.assertEqual([r["name"] for r in results], ["E8 1EA"])

    @patch("server.geocoding.photon_geocode")
    def test_bias_reaches_both_sources(self, mock_photon):
        client = self.client_returning([])
        mock_photon.return_value = []
        bias = (51.5074, -0.1278)
        geocoding.search(client, "SW9", bias)
        client.geocode.assert_called_once_with("SW9", bias)
        mock_photon.assert_called_once_with("SW9", bias)

    @patch("server.geocoding.photon_geocode")
    def test_duplicates_between_sources_are_dropped(self, mock_photon):
        client = self.client_returning([result("Hackney Town Hall", 51.5452, -0.0553)])
        mock_photon.return_value = [
            result("Hackney Town Hall", 51.54521, -0.05532),  # same place, ~1 m off
            result("Hackney Central", 51.5470, -0.0560),
        ]
        results = geocoding.search(client, "Hackney")
        self.assertEqual(
            [r["name"] for r in results], ["Hackney Town Hall", "Hackney Central"]
        )

    @patch("server.geocoding.photon_geocode")
    def test_transitous_failure_falls_back_to_photon(self, mock_photon):
        client = MagicMock()
        client.geocode.side_effect = geocoding.TransitousError("timed out")
        mock_photon.return_value = [result("E8 1EA", 51.5451, -0.0564)]
        results = geocoding.search(client, "E8 1EA")
        self.assertEqual([r["name"] for r in results], ["E8 1EA"])

    @patch("server.geocoding.photon_geocode")
    def test_capped_at_max_results(self, mock_photon):
        client = self.client_returning([result("Stop", 51.5, -0.1)])
        mock_photon.return_value = [
            result(f"Place {i}", 51.6 + i * 0.01, -0.1) for i in range(10)
        ]
        self.assertEqual(len(geocoding.search(client, "query")), geocoding.MAX_RESULTS)


if __name__ == "__main__":
    unittest.main()
