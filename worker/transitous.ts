/* Transitous (MOTIS) client — port of server/transitous.py.
 *
 * Transitous is free and keyless but fair-use: identify yourself via
 * User-Agent, cache responses, and keep request volume low. Responses are
 * cached in the Workers Cache API for the same 10 minutes the Flask app
 * used, so repeated searches don't re-hit the upstream.
 */

import type { Reach } from "./algorithms";

const BASE_URL = "https://api.transitous.org";
const USER_AGENT = "inthemiddle/1.0 (personal project; mack.nixon@googlemail.com)";

/* Hard ceiling on the search budget, shared by the API layer (request
 * capping) and the plan() street-leg allowances below so ranked minutes and
 * displayed routes always come from the same ceiling. */
export const MAX_MAX_MINUTES = 90;

const CACHE_TTL_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 30_000;
// Autocomplete has to feel instant; give up early and let Photon cover it.
const GEOCODE_TIMEOUT_MS = 5_000;

export class TransitousError extends Error {}

export interface GeocodeResult {
  name: string;
  label: string;
  lat: number;
  lon: number;
  type: string | null;
}

export interface ItineraryLeg {
  mode: string;
  route: string | null;
  from: string;
  to: string;
  duration: number;
  geometry: { points?: string; precision?: number };
}

export interface Itinerary {
  duration: number;
  startTime: string;
  endTime: string;
  transfers: number;
  legs: ItineraryLeg[];
}

async function getJson(
  path: string,
  params: Record<string, string | number>,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<any> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (exc) {
    throw new TransitousError(`Transitous unreachable: ${exc}`);
  }
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 200);
    throw new TransitousError(`Transitous ${path} returned ${resp.status}: ${body}`);
  }
  try {
    // The abort timeout can also fire mid-body-read; that's still an
    // upstream problem, so keep it inside the TransitousError envelope.
    return await resp.json();
  } catch (exc) {
    throw new TransitousError(`Transitous ${path} response unreadable: ${exc}`);
  }
}

/* The Cache API needs a URL as key; this host never resolves — it only
 * namespaces our cached computations. */
async function withCache<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const cacheKey = new Request(`https://cache.inthemiddle.internal/${encodeURIComponent(key)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();
  const value = await compute();
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(value), {
      headers: { "Cache-Control": `max-age=${CACHE_TTL_SECONDS}` },
    })
  );
  return value;
}

/** Search stops, addresses and places matching free-form text.
 *
 * `bias` is an optional [lat, lon] to rank nearby matches first — without
 * it, "SW9" can resolve to Alabama before Brixton.
 */
export async function geocode(
  text: string,
  bias: [number, number] | null = null
): Promise<GeocodeResult[]> {
  const params: Record<string, string | number> = { text, language: "en" };
  if (bias) {
    params.place = `${bias[0]},${bias[1]}`;
    params.placeBias = 20;
  }
  const results = await getJson("/api/v1/geocode", params, GEOCODE_TIMEOUT_MS);
  return (results as any[]).slice(0, 6).map((r) => {
    const areas: string[] = (r.areas ?? [])
      .filter((a: any) => a.matched !== undefined && a.matched !== null)
      .map((a: any) => a.name);
    const labelParts = [r.name, ...areas.slice(0, 2).filter((a) => a !== r.name)];
    return {
      name: r.name,
      label: labelParts.join(", "),
      lat: r.lat,
      lon: r.lon,
      type: r.type ?? null,
    };
  });
}

/** Fastest transit travel time from (lat, lon) to every reachable stop. */
export async function oneToAll(
  lat: number,
  lon: number,
  maxMinutes: number,
  when: string | null = null
): Promise<Reach> {
  const key = `ota:${lat.toFixed(4)},${lon.toFixed(4)}:${maxMinutes}:${when}`;
  return withCache(key, async () => {
    const params: Record<string, string | number> = {
      one: `${lat},${lon}`,
      maxTravelTime: maxMinutes,
      // Let the street leg use the whole budget (default is 15 min):
      // walking can then be the entire journey (k=0 results), not just
      // a short hop to the first stop.
      maxPreTransitTime: maxMinutes * 60,
    };
    if (when) params.time = when;
    const data = await getJson("/api/v6/one-to-all", params);

    const reachable: Reach = {};
    for (const entry of data.all ?? []) {
      const place = entry.place;
      const stopId = place.stopId;
      if (!stopId) continue;
      // MOTIS "k" counts connections used, so transfers = k - 1.
      reachable[stopId] = {
        name: place.name,
        lat: place.lat,
        lon: place.lon,
        minutes: entry.duration,
        transfers: Math.max((entry.k ?? 1) - 1, 0),
      };
    }
    return reachable;
  });
}

/** Best transit itinerary between two coordinates, for map display. */
export async function plan(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  when: string | null = null
): Promise<Itinerary | null> {
  const key = `plan:${fromLat.toFixed(5)},${fromLon.toFixed(5)}:${toLat.toFixed(5)},${toLon.toFixed(5)}:${when}`;
  return withCache(key, async () => {
    const params: Record<string, string | number> = {
      fromPlace: `${fromLat},${fromLon}`,
      toPlace: `${toLat},${toLon}`,
      numItineraries: 3,
      // Mirror the one-to-all search that ranked this spot: street legs
      // and direct walks may use up to the budget cap (the upstream
      // defaults of 15/30 min would produce slower routes than the
      // minutes shown in the results list).
      maxDirectTime: MAX_MAX_MINUTES * 60,
      maxPreTransitTime: MAX_MAX_MINUTES * 60,
      maxPostTransitTime: MAX_MAX_MINUTES * 60,
    };
    if (when) params.time = when;
    const data = await getJson("/api/v6/plan", params);

    // MOTIS suppresses transit itineraries slower than the fastest direct
    // walk, so nearby destinations often have *only* a `direct` result.
    // Entries without an endTime are malformed — drop them rather than
    // letting them win (or crash) the earliest-arrival comparison.
    const options: any[] = [...(data.itineraries ?? []), ...(data.direct ?? []).slice(0, 1)]
      .filter((o) => o.endTime != null);
    if (options.length === 0) return null;

    // Earliest arrival, like the ranking metric — not MOTIS's own "best"
    // scoring. endTime strings are uniform ISO from one response, so they
    // compare safely; duration breaks ties in favour of leaving later.
    const it = options.reduce((best, o) =>
      o.endTime < best.endTime || (o.endTime === best.endTime && o.duration < best.duration)
        ? o
        : best
    );
    return {
      duration: it.duration,
      startTime: it.startTime,
      endTime: it.endTime,
      transfers: it.transfers ?? 0,
      legs: (it.legs as any[]).map((leg) => ({
        mode: leg.mode,
        route: leg.routeShortName ?? null,
        from: leg.from.name,
        to: leg.to.name,
        duration: leg.duration,
        geometry: leg.legGeometry ?? {},
      })),
    };
  });
}
