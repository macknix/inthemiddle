/* Meeting-point maths — direct port of server/algorithms.py.
 *
 * One `one-to-all` transit query per person gives the true door-to-stop
 * travel time to every stop the network can reach. Intersecting the sets
 * yields every stop everyone can get to; ranking is minimax — minimise the
 * slowest person's travel time (ties broken by combined travel time).
 */

export interface Point {
  lat: number;
  lon: number;
}

export interface ReachableStop {
  name: string;
  lat: number;
  lon: number;
  minutes: number;
  transfers: number;
}

/** stop id → fastest journey there, for one person. */
export type Reach = Record<string, ReachableStop>;

export interface Candidate {
  id: string;
  name: string;
  lat: number;
  lon: number;
  minutes: number[];
  transfers: number[];
}

/* Results closer together than this are the same "place" — a station and its
 * entrances, or several bus stops on one junction. */
const MIN_SEPARATION_M = 400;

export function intersectReachability(reaches: Reach[]): Candidate[] {
  if (reaches.length === 0) return [];
  let commonIds = Object.keys(reaches[0]);
  for (const reach of reaches.slice(1)) {
    commonIds = commonIds.filter((id) => id in reach);
  }
  return commonIds.map((stopId) => {
    const first = reaches[0][stopId];
    return {
      id: stopId,
      name: first.name,
      lat: first.lat,
      lon: first.lon,
      minutes: reaches.map((reach) => reach[stopId].minutes),
      transfers: reaches.map((reach) => reach[stopId].transfers),
    };
  });
}


function normName(name: string): string {
  let n = name.toLowerCase().trim();
  for (const suffix of [" station", " underground station", " rail station"]) {
    if (n.endsWith(suffix)) n = n.slice(0, -suffix.length);
  }
  return n;
}

/** Approximate ground distance between two {lat, lon} points in metres. */
export function distanceM(c1: Point, c2: Point): number {
  const dlat = (c2.lat - c1.lat) * 111_320;
  const dlon = (c2.lon - c1.lon) * 111_320 * Math.cos((c1.lat * Math.PI) / 180);
  return Math.hypot(dlat, dlon);
}

/** Greedily pick the best candidates that are genuinely different places. */
function selectDistinct(sorted: Candidate[], topN: number): Candidate[] {
  const picked: Candidate[] = [];
  const names = new Set<string>();
  for (const c of sorted) {
    const name = normName(c.name);
    if (names.has(name)) continue;
    if (picked.some((p) => distanceM(c, p) < MIN_SEPARATION_M)) continue;
    picked.push(c);
    names.add(name);
    if (picked.length === topN) break;
  }
  return picked;
}

/** Top N distinct meeting spots, fairest (minimax) first. */
export function rank(candidates: Candidate[], topN = 8): Candidate[] {
  if (candidates.length === 0) return [];
  // Decorate-sort-undecorate: the candidate set can be tens of thousands of
  // stops, so compute each minimax key once instead of per comparison.
  const decorated = candidates.map((c) => ({
    c,
    max: Math.max(...c.minutes),
    sum: c.minutes.reduce((s, m) => s + m, 0),
  }));
  decorated.sort((a, b) => a.max - b.max || a.sum - b.sum);
  return selectDistinct(decorated.map((d) => d.c), topN);
}

/** Spherical centroid of N points — shows how the fair middle differs from
 * the geometric one. */
export function geographicMidpoint(points: Point[]): Point {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const lat = (p.lat * Math.PI) / 180;
    const lon = (p.lon * Math.PI) / 180;
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  }
  const n = points.length;
  x /= n;
  y /= n;
  z /= n;
  return {
    lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
    lon: (Math.atan2(y, x) * 180) / Math.PI,
  };
}
