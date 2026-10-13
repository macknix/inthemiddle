/* Worker entry point — port of server/app.py.
 *
 * Static assets (public/) are served by the assets binding before this code
 * runs; the Worker handles /api/* and rewrites /r/<room-id> share links to
 * index.html. The API mirrors the Flask app exactly so the frontend runs
 * unchanged against either backend.
 */

import * as algorithms from "./algorithms";
import type { Point } from "./algorithms";
import * as geocoding from "./geocoding";
import { MAX_PARTICIPANTS, Participant, Room } from "./rooms";
import { MAX_MAX_MINUTES, oneToAll, plan, TransitousError } from "./transitous";
import { ADJECTIVES, ANIMALS, pick, randomInt } from "./words";

export { Room };

const DEFAULT_MAX_MINUTES = 60;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const ROOM_NOT_FOUND = { error: "Room not found (it may have expired)." };

/** The departure time every number in a search is measured from.
 *
 * An explicit "leave at" wins; otherwise "now" rounded down to the minute.
 * The anchor is returned with the results and reused for later route
 * lookups, so the ranked minutes and the displayed routes agree. Rounding
 * keeps the response cache useful for repeated searches.
 */
function departureAnchor(body: Record<string, unknown>): string {
  const when = body.time;
  if (typeof when === "string" && when) return when;
  const nowMinute = Math.floor(Date.now() / 60_000) * 60_000;
  return new Date(nowMinute).toISOString().replace(".000Z", "Z");
}

function parseMaxMinutes(body: Record<string, unknown>): number {
  const raw = Number(body.maxMinutes ?? DEFAULT_MAX_MINUTES);
  return Math.min(Number.isFinite(raw) ? Math.trunc(raw) : DEFAULT_MAX_MINUTES, MAX_MAX_MINUTES);
}

/** Starting points from a request body: `points` list, or legacy a/b. */
function parsePoints(body: Record<string, unknown>): Point[] {
  let raw = body.points as unknown[] | undefined;
  if (raw === undefined && body.a !== undefined && body.b !== undefined) {
    raw = [body.a, body.b];
  }
  return (raw ?? []).map((p) => {
    const { lat, lon } = p as { lat: unknown; lon: unknown };
    const point = { lat: Number(lat), lon: Number(lon) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
      throw new RangeError("bad point");
    }
    return point;
  });
}

/** Reachability intersection for N starting points; the queries run
 * concurrently. Returns the payload or an error Response. */
async function computeMeet(
  points: Point[],
  maxMinutes: number,
  when: string
): Promise<Record<string, unknown> | Response> {
  const reaches = await Promise.all(points.map((p) => oneToAll(p.lat, p.lon, maxMinutes, when)));
  const candidates = algorithms.intersectReachability(reaches);
  if (candidates.length === 0) {
    return json(
      {
        error:
          `No spot is reachable by everyone within ${maxMinutes} minutes. ` +
          "Try a bigger time budget.",
        stats: { reachable: reaches.map((r) => Object.keys(r).length), common: 0 },
      },
      404
    );
  }
  return {
    candidates: algorithms.rank(candidates),
    geoMidpoint: algorithms.geographicMidpoint(points),
    time: when,
    stats: {
      reachable: reaches.map((r) => Object.keys(r).length),
      common: candidates.length,
    },
  };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function handleGeocode(url: URL): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length < 3) return json([]);
  // Both params must be present: Number(null) is 0, which would otherwise
  // silently bias results toward the Greenwich meridian.
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const bias: [number, number] | null =
    url.searchParams.has("lat") &&
    url.searchParams.has("lon") &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
      ? [lat, lon]
      : null;
  return json(await geocoding.search(query, bias));
}

async function handleMeet(request: Request): Promise<Response> {
  const body = await readBody(request);
  let points: Point[];
  try {
    points = parsePoints(body);
  } catch {
    return json({ error: "Each starting point needs lat and lon." }, 400);
  }
  if (points.length < 2 || points.length > MAX_PARTICIPANTS) {
    return json({ error: `Between 2 and ${MAX_PARTICIPANTS} starting points required.` }, 400);
  }
  const result = await computeMeet(points, parseMaxMinutes(body), departureAnchor(body));
  return result instanceof Response ? result : json(result);
}

async function handleRoutes(url: URL): Promise<Response> {
  const origins: [number, number][] = [];
  for (const raw of url.searchParams.getAll("from")) {
    const parts = raw.split(",").map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) {
      return json({ error: "from=lat,lon (repeated) and toLat/toLon required." }, 400);
    }
    origins.push([parts[0], parts[1]]);
  }
  const toLat = Number(url.searchParams.get("toLat"));
  const toLon = Number(url.searchParams.get("toLon"));
  if (!Number.isFinite(toLat) || !Number.isFinite(toLon)) {
    return json({ error: "from=lat,lon (repeated) and toLat/toLon required." }, 400);
  }
  if (origins.length < 1 || origins.length > MAX_PARTICIPANTS) {
    return json({ error: `Between 1 and ${MAX_PARTICIPANTS} origins required.` }, 400);
  }
  const when = url.searchParams.get("time") || null;
  const itineraries = await Promise.all(
    origins.map(([lat, lon]) => plan(lat, lon, toLat, toLon, when))
  );
  return json({ itineraries });
}

async function createRoom(env: Env): Promise<Response> {
  // Word pairs first; digits only if the pair space is congested.
  for (let attempt = 0; attempt < 30; attempt++) {
    let id = `${pick(ADJECTIVES)}-${pick(ANIMALS)}`;
    if (attempt >= 20) id = `${id}-${randomInt(10, 100)}`;
    if (await env.ROOMS.getByName(id).create()) return json({ id }, 201);
  }
  return json({ error: "Could not allocate a room id." }, 500);
}

async function handleRoomApi(
  request: Request,
  env: Env,
  segments: string[]
): Promise<Response> {
  // segments: [<room_id>, ...rest] under /api/rooms/
  const roomId = segments[0];
  if (!/^[\w-]{1,64}$/.test(roomId)) return json(ROOM_NOT_FOUND, 404);
  const room = env.ROOMS.getByName(roomId);
  const rest = segments.slice(1);

  // GET /api/rooms/<id>
  if (rest.length === 0 && request.method === "GET") {
    const view = await room.view();
    if (!view) return json(ROOM_NOT_FOUND, 404);
    // Hot path (every client polls this every 3s): splice the stored
    // results JSON in verbatim instead of parse + re-stringify.
    const body =
      `{"id":${JSON.stringify(roomId)}` +
      `,"participants":${JSON.stringify(view.participants)}` +
      `,"results":${view.resultsJson ?? "null"}` +
      `,"resultsVersion":${view.resultsVersion}}`;
    return new Response(body, { headers: { "Content-Type": "application/json" } });
  }

  // POST /api/rooms/<id>/participants
  if (rest.length === 1 && rest[0] === "participants" && request.method === "POST") {
    const body = await readBody(request);
    const name = String(body.name ?? "").trim().slice(0, 40) || null;
    const participant = await room.addParticipant(name);
    if (participant === null) return json(ROOM_NOT_FOUND, 404);
    if (participant === false) {
      return json({ error: `This room is full (${MAX_PARTICIPANTS} people max).` }, 409);
    }
    return json(participant, 201);
  }

  // PATCH /api/rooms/<id>/participants/<pid>
  if (rest.length === 2 && rest[0] === "participants" && request.method === "PATCH") {
    const body = await readBody(request);
    const fields: Partial<Pick<Participant, "name" | "lat" | "lon" | "label">> = {};
    if ("lat" in body && "lon" in body) {
      fields.lat = Number(body.lat);
      fields.lon = Number(body.lon);
      if (!Number.isFinite(fields.lat) || !Number.isFinite(fields.lon)) {
        return json({ error: "lat and lon must be numbers." }, 400);
      }
    }
    // `||` (not ??) to mirror Flask's `or`: falsy values blank the field.
    if ("label" in body) fields.label = String(body.label || "").slice(0, 120);
    if ("name" in body) {
      const name = String(body.name || "").trim().slice(0, 40);
      if (name) fields.name = name;
    }
    const participant = await room.updateParticipant(rest[1], fields);
    return participant ? json(participant) : json({ error: "Room or participant not found." }, 404);
  }

  // DELETE /api/rooms/<id>/participants/<pid>, or the sendBeacon-friendly
  // POST .../<pid>/leave alias (beacons can only POST). Idempotent.
  const isDelete = rest.length === 2 && rest[0] === "participants" && request.method === "DELETE";
  const isLeave =
    rest.length === 3 &&
    rest[0] === "participants" &&
    rest[2] === "leave" &&
    request.method === "POST";
  if (isDelete || isLeave) {
    const removed = await room.removeParticipant(rest[1]);
    if (removed === null) return json(ROOM_NOT_FOUND, 404);
    return new Response(null, { status: 204 });
  }

  // POST /api/rooms/<id>/meet
  if (rest.length === 1 && rest[0] === "meet" && request.method === "POST") {
    const view = await room.view();
    if (!view) return json(ROOM_NOT_FOUND, 404);
    const located = view.participants.filter((p) => p.lat !== null && p.lon !== null);
    if (located.length < 2) {
      return json({ error: "Need at least two people with locations before searching." }, 400);
    }
    const body = await readBody(request);
    const points = located.map((p) => ({ lat: p.lat as number, lon: p.lon as number }));
    const result = await computeMeet(points, parseMaxMinutes(body), departureAnchor(body));
    if (result instanceof Response) return result;

    // Freeze the points the times refer to — participants can join later.
    result.points = located.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }));
    const version = await room.setResults(JSON.stringify(result));
    if (version === null) return json(ROOM_NOT_FOUND, 404);
    return json({ ...result, resultsVersion: version });
  }

  return json({ error: "Not found." }, 404);
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const segments = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);

  if (segments[0] === "geocode" && request.method === "GET") return handleGeocode(url);
  if (segments[0] === "meet" && request.method === "POST") return handleMeet(request);
  if (segments[0] === "routes" && request.method === "GET") return handleRoutes(url);
  if (segments[0] === "rooms") {
    if (segments.length === 1 && request.method === "POST") return createRoom(env);
    if (segments.length >= 2) return handleRoomApi(request, env, segments.slice(1));
  }
  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }
      // Share links are /r/<id>; the frontend reads the id from the path.
      if (/^\/r\/[\w-]+$/.test(url.pathname)) {
        return env.ASSETS.fetch(new URL("/index.html", url.origin));
      }
      return new Response("Not found", { status: 404 });
    } catch (exc) {
      if (exc instanceof TransitousError) {
        console.error(`Transitous error: ${exc.message}`);
        return json(
          { error: "The transit routing service had a problem. Try again in a moment." },
          502
        );
      }
      console.error(exc);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
