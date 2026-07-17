/* Merged address search — port of server/geocoding.py.
 *
 * The MOTIS geocoder knows stop and place names but doesn't index postcodes,
 * so queries like "E8 1EA" come back empty. Photon (photon.komoot.io, OSM,
 * free) is built for search-as-you-type and fills that gap. Photon failures
 * degrade gracefully to whatever Transitous returned.
 */

import { geocode as transitousGeocode, GeocodeResult, TransitousError } from "./transitous";

const PHOTON_URL = "https://photon.komoot.io/api";
const USER_AGENT = "inthemiddle/1.0 (personal project; mack.nixon@googlemail.com)";
const REQUEST_TIMEOUT_MS = 10_000;

/* If Transitous alone finds at least this many *relevant* results, don't
 * bother Photon. Count alone isn't enough: for "E2 6LD" MOTIS fuzzy-matches
 * three unrelated US places, which must not block the Photon top-up. */
const MIN_RESULTS_BEFORE_TOPUP = 3;
const MAX_RESULTS = 6;

function normText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Does this result's name plausibly correspond to the normalised query? */
function matchesQuery(result: GeocodeResult, query: string): boolean {
  const name = normText(result.name);
  return Boolean(name && query) && (name.includes(query) || query.includes(name));
}

/** Query Photon and normalise to the same shape as the Transitous geocoder. */
async function photonGeocode(
  text: string,
  bias: [number, number] | null
): Promise<GeocodeResult[]> {
  const url = new URL(PHOTON_URL);
  url.searchParams.set("q", text);
  url.searchParams.set("limit", String(MAX_RESULTS));
  if (bias) {
    // Rank matches near the bias point first; scale 0.5 is strong enough
    // to put local postcodes above same-named places abroad.
    url.searchParams.set("lat", String(bias[0]));
    url.searchParams.set("lon", String(bias[1]));
    url.searchParams.set("zoom", "12");
    url.searchParams.set("location_bias_scale", "0.5");
  }

  let features: any[];
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    features = ((await resp.json()) as any).features ?? [];
  } catch (exc) {
    console.warn(`Photon geocode failed for ${JSON.stringify(text)}: ${exc}`);
    return [];
  }

  const results: GeocodeResult[] = [];
  for (const f of features) {
    const props = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [null, null];
    if (lat == null || lon == null) continue;
    const street = [props.street, props.housenumber].filter(Boolean).join(" ");
    const name = props.name || street || props.postcode;
    if (!name) continue;
    const labelParts = [
      name,
      ...[props.district, props.city, props.postcode].filter((p) => p && p !== name),
    ];
    results.push({
      name,
      label: labelParts.join(", "),
      lat,
      lon,
      type: (props.type || "place").toUpperCase(),
    });
  }
  return results;
}

function dedupeKey(result: GeocodeResult): string {
  return `${result.name.toLowerCase()}|${result.lat.toFixed(3)}|${result.lon.toFixed(3)}`;
}

/** Merged suggestions: Transitous results first, Photon tops up.
 *
 * Either source may fail without taking the dropdown down with it.
 */
export async function search(
  text: string,
  bias: [number, number] | null = null
): Promise<GeocodeResult[]> {
  let results: GeocodeResult[];
  try {
    results = await transitousGeocode(text, bias);
  } catch (exc) {
    if (!(exc instanceof TransitousError)) throw exc;
    console.warn(`Transitous geocode failed for ${JSON.stringify(text)}: ${exc.message}`);
    results = [];
  }

  // Normalise the query once and remember each result's match flag — it is
  // needed for both the top-up decision and the final ordering.
  const query = normText(text);
  const scored = results.map((r) => ({ r, match: matchesQuery(r, query) }));

  const relevant = scored.filter((s) => s.match).length;
  if (relevant < MIN_RESULTS_BEFORE_TOPUP) {
    const seen = new Set(results.map(dedupeKey));
    for (const r of await photonGeocode(text, bias)) {
      const key = dedupeKey(r);
      if (!seen.has(key)) {
        scored.push({ r, match: matchesQuery(r, query) });
        seen.add(key);
      }
    }
  }

  // Results that look like the query beat fuzzy leftovers, whatever their
  // source; Array.sort is stable so source order survives within each group.
  scored.sort((a, b) => Number(b.match) - Number(a.match));
  return scored.slice(0, MAX_RESULTS).map((s) => s.r);
}
