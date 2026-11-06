/**
 * Preferred mailing city for a US ZIP.
 *
 * Nominatim sometimes returns a house with a street and postcode but no
 * city, town, village, hamlet, or municipality, because the point sits
 * outside a census-place polygon. The ZIP's preferred mailing city is a
 * statewide stand-in. Zippopotam lists that city first
 * (33812 → Lakeland, 33563 → Plant City). Nothing here is a single address.
 * https://api.zippopotam.us/us/{zip}
 */

const ZIP_URL = "https://api.zippopotam.us/us/";

interface ZipPlace {
  "place name"?: string;
  "state abbreviation"?: string;
  state?: string;
}

const cache = new Map<string, string | null>();

export function resetZipLocalityCache(): void {
  cache.clear();
}

/** First Florida place name. Later places are alternate names for the same ZIP. */
export function mailingCityFromZippopotam(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const places = (body as { places?: unknown }).places;
  if (!Array.isArray(places)) return null;
  for (const place of places) {
    if (!place || typeof place !== "object") continue;
    const row = place as ZipPlace;
    const state = `${row["state abbreviation"] ?? row.state ?? ""}`.trim().toLowerCase();
    if (state !== "fl" && state !== "florida") continue;
    const name = row["place name"]?.trim();
    if (name) return name;
  }
  return null;
}

export function zipLocalityUrl(zip: string): string {
  return `${ZIP_URL}${encodeURIComponent(zip)}`;
}

/**
 * Mailing city for each ZIP. A successful answer is cached. A network or
 * server error is left out of the map so the caller can retry.
 */
export async function mailingCitiesForZips(
  zips: string[],
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  await Promise.all(zips.map(async (zip) => {
    if (!/^\d{5}$/.test(zip)) return;
    if (cache.has(zip)) {
      out.set(zip, cache.get(zip) ?? null);
      return;
    }
    const res = await fetchImpl(zipLocalityUrl(zip), {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "PermitRewind/1.0 (+https://permitrewind.com)",
      },
    });
    if (res.status === 404) {
      cache.set(zip, null);
      out.set(zip, null);
      return;
    }
    if (!res.ok) return;
    const city = mailingCityFromZippopotam(await res.json());
    cache.set(zip, city);
    out.set(zip, city);
  }));
  return out;
}
