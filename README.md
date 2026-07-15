# in the middle

Find the fair place to meet — measured by **public transit time**, not
distance. Open the page, share the room link with whoever you're meeting
(up to 5 people), and everyone's pin lands on the same map. Ranked meeting
spots come back with real journey times and routes for everyone.

No API keys, no billing. All data comes from free services:

- [Transitous](https://transitous.org) — community-run transit routing
  (MOTIS engine, worldwide GTFS + OpenStreetMap)
- [Photon](https://photon.komoot.io) — OSM geocoding for addresses and postcodes
- [CARTO / OpenStreetMap](https://www.openstreetmap.org) — map tiles

## Run it

```bash
python3 -m venv env && source env/bin/activate
pip install -r requirements.txt
python run.py            # http://127.0.0.1:5001
```

Tests (fully offline, all HTTP mocked):

```bash
python -m unittest discover -s server/tests -t .
```

## Two modes

**Shared room (default).** Opening the page creates a room and rewrites the
URL to `/?room=<id>` — that URL *is* the invite. The page asks for your
location to pre-fill your pin (adjust it by dragging, clicking the map, or
searching). Everyone who opens the link joins as a participant with their
own pin; pins sync every few seconds, and when someone hits **Find the
middle** the results appear for the whole room.

**Two addresses (toggle in the panel).** The original single-screen mode:
type or click two starting points yourself, no sharing involved.

### Trying the room mode on one machine

1. `python run.py`, open http://127.0.0.1:5001 — a room is created and the
   browser asks for your location (geolocation works on `localhost` without
   HTTPS).
2. Click **Copy link** and paste it into a **new tab or window** — participant
   identity is per-tab (`sessionStorage`), so every tab acts as another
   person. Don't *duplicate* the tab, which copies the identity.
3. In the second tab, set the "friend's" position: search an address, click
   the map, or override geolocation in Chrome DevTools (⋮ → More tools →
   Sensors → Location).
4. With two pins set, **Find the middle** in either tab — both tabs get the
   results within a poll interval.

To test from a phone on the same network, run
`flask --app server.app run --host 0.0.0.0 --port 5001` and open
`http://<your-mac-ip>:5001?room=<id>`. Browsers only allow the geolocation
API on HTTPS or localhost, so on the phone type an address instead.

Rooms live in server memory (they expire 24 h after the last change and
vanish on restart) — fine for a personal tool, no database needed.

## How it works

1. One MOTIS `one-to-all` query per person returns the fastest transit time
   from their pin to *every* stop reachable within the time budget
   (~16k stops for 60 minutes in London).
2. Intersecting the sets gives every stop *everyone* can reach, with each
   person's true travel time attached.
3. That set is ranked by **minimax fairness**: minimise the *slowest*
   person's journey — the earliest moment you can all be there — with ties
   broken by combined travel time.

Nearby stops are de-duplicated (minimum 400 m separation, station-name
variants collapsed) so the results are distinct places rather than five bus
stops on one junction. Selecting a result fetches the actual itinerary for
each person and draws all the routes on the map.

## Components

```
run.py
server/
  app.py
  transitous.py
  geocoding.py
  algorithms.py
  rooms.py
  tests/
public/
  index.html
  styles/main.css
  scripts/main.js
```

### `run.py`
Entry point. Starts the Flask dev server on `http://127.0.0.1:5001`, which
serves both the API and the static frontend — there is no separate frontend
build or server.

### `server/app.py`
The Flask application and its JSON endpoints:

- `GET /api/geocode?q=&lat=&lon=` — search suggestions for the address
  inputs. `lat`/`lon` (the current map centre) bias results towards where
  the user is looking.
- `POST /api/meet` — direct search for 2–5 starting points (`points` list;
  the legacy `a`/`b` body still works). Optional time budget (capped at
  90 minutes) and departure time; reachability queries run concurrently and
  the top 8 meeting spots come back with per-person `minutes`/`transfers`.
- `GET /api/routes?from=lat,lon&from=…&toLat=&toLon=` — one door-to-spot
  itinerary per origin, used to draw the routes on the map.
- `POST /api/rooms` / `GET /api/rooms/<id>` — create a room / poll its state
  (participants plus the latest shared results and a version counter).
- `POST /api/rooms/<id>/participants` — join a room;
  `PATCH /api/rooms/<id>/participants/<pid>` — update your pin, label or name.
- `POST /api/rooms/<id>/meet` — run the search over every located
  participant and store the results in the room for everyone to see.

### `server/rooms.py`
The in-memory room store: participants keyed by id with join order, a
results slot with a version counter (so polling clients know when to
re-render), a 24-hour TTL refreshed on writes, and a 5-person cap to keep
Transitous usage polite. Thread-safe; deliberately no persistence.

### `server/transitous.py`
Client for the Transitous/MOTIS API. Wraps three endpoints — `geocode`,
`one-to-all` (travel time to every reachable stop) and `plan` (a full
itinerary) — and normalises their responses. Includes a 10-minute TTL cache
and an identifying `User-Agent`, both required etiquette for a community-run
service. Geocoding uses a short 5-second timeout so autocomplete stays
responsive even when the service is slow.

### `server/geocoding.py`
Merged address search. Transitous's geocoder is strong on stop and venue
names but has no postcode index, so results are topped up from Photon
whenever Transitous returns fewer than three suggestions that actually
resemble the typed query (count alone is not enough — fuzzy matching can
produce plausible-looking junk). Suggestions whose names match the query
always rank above fuzzy leftovers, near-duplicates between the two sources
are dropped, and either source can fail without emptying the dropdown.

### `server/algorithms.py`
The meeting-point maths, pure functions with no I/O:

- `intersect_reachability` — joins N reachability sets on stop ID.
- `rank` — minimax ordering plus de-duplication, so the top results are
  genuinely different places.
- `distance_m` — fast equirectangular ground distance, used by the
  de-duplication threshold.
- `geographic_midpoint` — the spherical centroid of the starting points,
  returned alongside results to show how far the *fair* point sits from
  the *geometric* one.

### `server/tests/`
Offline unit tests (~71) covering the ranking maths, API response parsing,
caching, geocoding merge rules (including postcode regressions like
`E2 6LD`), the room store (capacity, TTL expiry, results versioning) and
the Flask endpoints. All HTTP is mocked; the suite runs in well under a
second.

### `public/`
The frontend: a single HTML page, one stylesheet and one script — vanilla
JS with [Leaflet](https://leafletjs.com), no build step.

- `index.html` — full-screen map with a floating control panel and the
  room/classic mode tabs.
- `scripts/main.js` — room lifecycle (create/join from the URL, per-tab
  identity, 3-second polling, shared results), pin placement (geolocation,
  typed search with autocomplete, map clicks, draggable markers), calls to
  the API, the results list, and route drawing (decodes the polyline
  geometry returned per itinerary leg).
- `styles/main.css` — panel, marker and results styling.

## Fair use

Transitous and Photon are free, keyless, community-hosted services. The
backend identifies itself via `User-Agent`, caches reachability responses
for 10 minutes, rooms are capped at 5 people, and each search costs one
upstream request per participant. Keep it that way — if this ever becomes
more than a personal tool, [talk to Transitous](https://transitous.org/api/)
or self-host MOTIS.
