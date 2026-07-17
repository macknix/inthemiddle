"""Flask app: serves the frontend and the meeting-point API."""

import concurrent.futures
import logging
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from . import algorithms, geocoding
from .rooms import MAX_PARTICIPANTS, RoomStore
from .transitous import MAX_MAX_MINUTES, TransitousClient, TransitousError

logging.basicConfig(level=logging.INFO)

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
DEFAULT_MAX_MINUTES = 60

app = Flask(__name__, static_folder=str(PUBLIC_DIR), static_url_path="")
client = TransitousClient()
rooms = RoomStore()


@app.route("/")
def index():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/r/<room_id>")
def room_page(room_id):
    """Share links are /r/<id>; the frontend reads the id from the path."""
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/api/geocode")
def geocode():
    query = request.args.get("q", "").strip()
    if len(query) < 3:
        return jsonify([])
    try:
        bias = (float(request.args["lat"]), float(request.args["lon"]))
    except (KeyError, ValueError):
        bias = None
    return jsonify(geocoding.search(client, query, bias))


def _parse_max_minutes(body):
    """The capped time budget; junk input falls back to the default."""
    try:
        minutes = int(body.get("maxMinutes", DEFAULT_MAX_MINUTES))
    except (TypeError, ValueError):
        minutes = DEFAULT_MAX_MINUTES
    return min(minutes, MAX_MAX_MINUTES)


def _departure_anchor(body):
    """The departure time every number in a search is measured from.

    An explicit "leave at" wins; otherwise "now" rounded down to the minute.
    The anchor is returned with the results and reused for later route
    lookups, so the ranked minutes and the displayed routes agree instead of
    each being timed from whenever their request happened to fire. Rounding
    keeps the upstream cache useful for repeated searches.
    """
    when = body.get("time")
    if when:
        return when
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    return now.isoformat().replace("+00:00", "Z")


def _compute_meet(points, max_minutes, when):
    """Reachability intersection for N starting points.

    Returns the response dict, or an (error dict, status) tuple when no
    common stop exists.
    """
    # The reachability queries are independent; run them together.
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(points)) as pool:
        futures = [
            pool.submit(client.one_to_all, p["lat"], p["lon"], max_minutes, when)
            for p in points
        ]
        reaches = [f.result() for f in futures]

    candidates = algorithms.intersect_reachability(reaches)
    if not candidates:
        return (
            {
                "error": "No spot is reachable by everyone within "
                f"{max_minutes} minutes. Try a bigger time budget.",
                "stats": {"reachable": [len(r) for r in reaches], "common": 0},
            },
            404,
        )

    return {
        "candidates": algorithms.rank(candidates),
        "geoMidpoint": algorithms.geographic_midpoint(points),
        "time": when,
        "stats": {
            "reachable": [len(r) for r in reaches],
            "common": len(candidates),
        },
    }


def _parse_points(body):
    """Starting points from a request body: `points` list, or legacy a/b."""
    raw = body.get("points")
    if raw is None and "a" in body and "b" in body:
        raw = [body["a"], body["b"]]
    points = []
    for p in raw or []:
        points.append({"lat": float(p["lat"]), "lon": float(p["lon"])})
    return points


@app.route("/api/meet", methods=["POST"])
def meet():
    body = request.get_json(force=True, silent=True) or {}
    try:
        points = _parse_points(body)
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Each starting point needs lat and lon."}), 400
    if not 2 <= len(points) <= MAX_PARTICIPANTS:
        return jsonify(
            {"error": f"Between 2 and {MAX_PARTICIPANTS} starting points required."}
        ), 400

    max_minutes = _parse_max_minutes(body)
    when = _departure_anchor(body)

    result = _compute_meet(points, max_minutes, when)
    if isinstance(result, tuple):
        return jsonify(result[0]), result[1]
    return jsonify(result)


@app.route("/api/routes")
def routes():
    try:
        origins = []
        for raw in request.args.getlist("from"):
            lat, lon = raw.split(",")
            origins.append((float(lat), float(lon)))
        to_lat, to_lon = float(request.args["toLat"]), float(request.args["toLon"])
    except (KeyError, ValueError):
        return jsonify({"error": "from=lat,lon (repeated) and toLat/toLon required."}), 400
    if not 1 <= len(origins) <= MAX_PARTICIPANTS:
        return jsonify({"error": f"Between 1 and {MAX_PARTICIPANTS} origins required."}), 400
    when = request.args.get("time") or None

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(origins)) as pool:
        futures = [
            pool.submit(client.plan, lat, lon, to_lat, to_lon, when)
            for lat, lon in origins
        ]
        return jsonify({"itineraries": [f.result() for f in futures]})


# ---------- rooms: shared sessions behind /?room=<id> links ----------


@app.route("/api/rooms", methods=["POST"])
def create_room():
    return jsonify({"id": rooms.create()}), 201


@app.route("/api/rooms/<room_id>")
def get_room(room_id):
    view = rooms.view(room_id)
    if view is None:
        return jsonify({"error": "Room not found (it may have expired)."}), 404
    return jsonify(view)


@app.route("/api/rooms/<room_id>/participants", methods=["POST"])
def join_room(room_id):
    body = request.get_json(force=True, silent=True) or {}
    name = (body.get("name") or "").strip()[:40] or None
    participant = rooms.add_participant(room_id, name)
    if participant is None:
        return jsonify({"error": "Room not found (it may have expired)."}), 404
    if participant is False:
        return jsonify({"error": f"This room is full ({MAX_PARTICIPANTS} people max)."}), 409
    return jsonify(participant), 201


@app.route("/api/rooms/<room_id>/participants/<pid>", methods=["PATCH"])
def update_participant(room_id, pid):
    body = request.get_json(force=True, silent=True) or {}
    fields = {}
    try:
        if "lat" in body and "lon" in body:
            fields["lat"] = float(body["lat"])
            fields["lon"] = float(body["lon"])
        if "label" in body:
            fields["label"] = str(body["label"] or "")[:120]
        if "name" in body:
            name = str(body["name"] or "").strip()[:40]
            if name:
                fields["name"] = name
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lon must be numbers."}), 400

    participant = rooms.update_participant(room_id, pid, fields)
    if participant is None:
        return jsonify({"error": "Room or participant not found."}), 404
    return jsonify(participant)


@app.route("/api/rooms/<room_id>/participants/<pid>", methods=["DELETE"])
@app.route("/api/rooms/<room_id>/participants/<pid>/leave", methods=["POST"])
def leave_room(room_id, pid):
    # The POST alias exists because navigator.sendBeacon (used when a tab
    # closes) can only POST. Idempotent: leaving twice is still a 204.
    if rooms.remove_participant(room_id, pid) is None:
        return jsonify({"error": "Room not found (it may have expired)."}), 404
    return "", 204


@app.route("/api/rooms/<room_id>/meet", methods=["POST"])
def room_meet(room_id):
    located = rooms.located_participants(room_id)
    if located is None:
        return jsonify({"error": "Room not found (it may have expired)."}), 404
    if len(located) < 2:
        return jsonify(
            {"error": "Need at least two people with locations before searching."}
        ), 400

    body = request.get_json(force=True, silent=True) or {}
    max_minutes = _parse_max_minutes(body)
    when = _departure_anchor(body)

    result = _compute_meet(located, max_minutes, when)
    if isinstance(result, tuple):
        return jsonify(result[0]), result[1]

    # Freeze the points the times refer to — participants can join later.
    result["points"] = [
        {"id": p["id"], "name": p["name"], "lat": p["lat"], "lon": p["lon"]}
        for p in located
    ]
    version = rooms.set_results(room_id, result)
    if version is None:
        return jsonify({"error": "Room not found (it may have expired)."}), 404
    return jsonify({**result, "resultsVersion": version})


@app.errorhandler(TransitousError)
def transitous_error(exc):
    logging.getLogger(__name__).error("Transitous error: %s", exc)
    return jsonify({"error": "The transit routing service had a problem. Try again in a moment."}), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
