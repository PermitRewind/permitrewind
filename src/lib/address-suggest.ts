import { signAddressSelection } from "./address-selection";
import { parseAddressQuery, queryWithoutIncompleteStreetType, splitStreetUnit, streetLineWithoutLocality } from "./address";
import { ADDRESS_SUGGEST_LIMIT, ADDRESS_SUGGEST_MIN_CHARS, STREET_TYPE_FALLBACK_CAP, STREET_TYPE_FALLBACKS, addressQueryVariants, citiesNear, compassFull, expandAddress, intendedCity, isSubstantialStreetToken, streetNameForms, streetTokenRank } from "./address-normalize";
import { isPolkCity } from "./jurisdictions";
import { mailingCitiesForZips, resetZipLocalityCache } from "./zip-locality";

/**
 * Florida address suggestions. PermitStack has no autocomplete endpoint, so this
 * asks OpenStreetMap Nominatim on the server. The PermitStack key is never used here.
 *
 * Nominatim's usage policy allows this only when requests are paced (at most one
 * per second), cached, and sent after the user pauses. The route does that.
 * https://operations.osmfoundation.org/policies/nominatim/
 *
 * A house just outside a place polygon comes back with a street and ZIP and no
 * locality. That blank is filled with the ZIP's preferred mailing city. A city
 * Nominatim or the visitor already named is left as-is.
 */

export const ADDRESS_SUGGEST_ATTRIBUTION = "© OpenStreetMap contributors";

export interface AddressSuggestion {
  /** Line placed in the search box, e.g. "3533 Sam Allen Oaks Circle, Plant City, FL 33563". */
  label: string;
  street: string;
  city: string | null;
  state: "FL";
  zip: string | null;
  unitType: string | null;
  unitNumber: string | null;
  county: string | null;
  /** Nominatim latitude, included only when that response had a point. */
  lat?: number;
  /** Nominatim longitude, included only when that response had a point. */
  lng?: number;
  /** Opaque proof that this row was chosen from a server suggestion. */
  token: string;
}

export type AddressSuggestStatus = "ok" | "empty" | "throttled" | "unavailable";

export interface AddressSuggestResponse {
  query: string;
  suggestions: AddressSuggestion[];
  attribution: typeof ADDRESS_SUGGEST_ATTRIBUTION;
  status: AddressSuggestStatus;
}

interface SuggestState {
  lastAt: number;
  cache: Map<string, AddressSuggestResponse>;
}

const shared: SuggestState = { lastAt: 0, cache: new Map() };
const CACHE_LIMIT = 200;

/** Whole state, not a county. left, top, right, bottom. */
export const FLORIDA_VIEWBOX = "-87.7,31.1,-79.8,24.4";

export function resetAddressSuggestState(): void {
  shared.lastAt = 0;
  shared.cache.clear();
  resetZipLocalityCache();
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  unit?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
}

interface NominatimHit {
  lat?: string | number;
  lon?: string | number;
  address?: NominatimAddress;
}

function coordinatesFromHit(hit: NominatimHit): { lat: number; lng: number } | undefined {
  const lat = typeof hit.lat === "number" ? hit.lat : Number(hit.lat);
  const lng = typeof hit.lon === "number" ? hit.lon : Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

function empty(query: string, status: AddressSuggestStatus): AddressSuggestResponse {
  return { query, suggestions: [], attribution: ADDRESS_SUGGEST_ATTRIBUTION, status };
}

function isFlorida(address: NominatimAddress | undefined): boolean {
  if (!address) return false;
  const state = (address.state ?? "").toLowerCase();
  return state === "florida" || state === "fl";
}

export function suggestionFromNominatim(hit: NominatimHit, typedQuery = ""): AddressSuggestion | null {
  const address = hit.address;
  if (!isFlorida(address) || !address?.road) return null;
  const combined = [address.house_number, address.road, address.unit].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const split = splitStreetUnit(combined);
  const street = split.street;
  if (!street) return null;
  const nominatimCity = address.city || address.town || address.village || address.hamlet || address.municipality || null;
  const typedCity = intendedCity(typedQuery);
  // A city the visitor typed wins when Nominatim names a different place (Highland City vs Lakeland, Winter Haven vs Bartow).
  const city = typedCity && nominatimCity && typedCity.toLowerCase() !== nominatimCity.toLowerCase()
    ? typedCity
    : nominatimCity || typedCity;
  const zip = address.postcode?.match(/\d{5}/)?.[0] ?? null;
  const county = address.county?.replace(/\s+county$/i, "") || null;
  const stateZip = ["FL", zip].filter(Boolean).join(" ");
  const label = [street, city, stateZip].filter(Boolean).join(", ");
  const parsed = parseAddressQuery(street);
  if (!parsed.number || !parsed.streetName) return null;
  const coords = coordinatesFromHit(hit);
  const token = signAddressSelection({
    label, street, city, state: "FL", zip, county,
    unitType: split.unitType, unitNumber: split.unitNumber,
    ...coords,
  });
  return { label, street, city, state: "FL", zip, county, unitType: split.unitType, unitNumber: split.unitNumber, ...coords, token };
}

/**
 * Nominatim misses a full "street + city" query when the house has no city tag.
 * `3533 Sam Allen Oaks Cir Plant City` returns nothing; the same street without
 * Plant City returns the house (county + ZIP only). The typed city is applied later.
 */
export function nominatimQueryPlan(raw: string): string[] {
  const query = raw.trim().slice(0, 120);
  const full = /\b(fl|florida)\b/i.test(query) ? query : `${query}, Florida`;
  const parsed = parseAddressQuery(query);
  const street = streetLineWithoutLocality(query);
  const plan = [full];
  if (parsed.city && street && street.toLowerCase() !== query.toLowerCase()) {
    const streetQuery = /\b(fl|florida)\b/i.test(street) ? street : `${street}, Florida`;
    if (streetQuery.toLowerCase() !== full.toLowerCase()) plan.push(streetQuery);
  }
  return plan;
}

/**
 * House number plus a street name, with no finished street type.
 * "10 W" is only a fragment, so it does not qualify.
 */
function streetTypeFallbackVariants(raw: string): string[] {
  const parsed = parseAddressQuery(raw);
  if (!parsed.number || !parsed.streetName || parsed.suffix) return [];
  if (!parsed.streetName.split(/\s+/).some((token) => isSubstantialStreetToken(token))) return [];
  const names = streetNameForms(expandAddress(parsed.streetName)).slice(0, 2);
  if (!names.length) return [];
  const pre = parsed.preDirectional ? compassFull(parsed.preDirectional)?.toLowerCase() ?? parsed.preDirectional.toLowerCase() : null;
  const post = parsed.postDirectional ? compassFull(parsed.postDirectional)?.toLowerCase() ?? parsed.postDirectional.toLowerCase() : null;
  const line = (name: string, suffix: string) => [parsed.number, pre, name, suffix, post].filter(Boolean).join(" ");
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (name: string, suffix: string) => {
    const text = line(name, suffix);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    lines.push(text);
  };
  const [primary, alternate] = names;
  for (const type of STREET_TYPE_FALLBACKS) push(primary, type.full);
  if (!alternate) {
    for (const type of STREET_TYPE_FALLBACKS) push(primary, type.abbrev);
  } else {
    // Full word on the typed spelling already covers every type. Abbreviations
    // and the other compound spelling share the remaining slots, Drive first.
    for (const type of STREET_TYPE_FALLBACKS.slice(0, 4)) push(primary, type.abbrev);
    for (const type of STREET_TYPE_FALLBACKS.slice(0, 4)) push(alternate, type.full);
  }
  return lines.slice(0, STREET_TYPE_FALLBACK_CAP);
}

/**
 * Expanded form first (Northeast / Street), then the raw input, then the
 * abbreviated form (NE / St), then near-matches (King for Kings, Lakeland for
 * Lakland). Each variant also drops a trailing city the way `nominatimQueryPlan`
 * does. A city-qualified hit stops the search. A different city from the
 * city-stripped fallback does not, while a later variant still names the city
 * the visitor typed.
 *
 * When the line is a house number and street name with no finished street type,
 * common types (Drive, Street, Circle, and the rest of that set) are appended
 * after those variants and capped. An unfinished trailing type ("D", "Stre")
 * is dropped first so it is not the only lookup.
 */
export function suggestionQueryPlan(raw: string): string[] {
  const query = queryWithoutIncompleteStreetType(raw);
  const seen = new Set<string>();
  const plan: string[] = [];
  const add = (variant: string) => {
    let added = 0;
    for (const q of nominatimQueryPlan(variant)) {
      const key = q.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      plan.push(q);
      added += 1;
    }
    return added;
  };
  for (const variant of addressQueryVariants(query)) add(variant);
  let extra = 0;
  for (const variant of streetTypeFallbackVariants(query)) {
    if (extra >= STREET_TYPE_FALLBACK_CAP) break;
    extra += add(variant);
  }
  return plan;
}

export function isPolkSuggestion(suggestion: { city?: string | null; county?: string | null }): boolean {
  if (suggestion.county && isPolkCity(suggestion.county)) return true;
  if (suggestion.city && isPolkCity(suggestion.city)) return true;
  return false;
}

/**
 * Typed city first, then Polk County and its cities, then the rest of Florida.
 * Order inside a group stays as the geocoder returned it.
 */
export function rankAddressSuggestions<T extends { city: string | null; county: string | null; street?: string }>(
  suggestions: T[],
  typedQuery: string,
): T[] {
  const typedCity = intendedCity(typedQuery);
  const score = (suggestion: T) => {
    if (typedCity && suggestion.city && citiesNear(typedCity, suggestion.city)) return 0;
    if (isPolkSuggestion(suggestion)) return 1;
    return 2;
  };
  const streetScore = (suggestion: T) => suggestion.street ? streetTokenRank(typedQuery, suggestion.street) : 0;
  return suggestions
    .map((suggestion, index) => ({ suggestion, index, score: score(suggestion), street: streetScore(suggestion) }))
    .sort((a, b) => a.score - b.score || a.street - b.street || a.index - b.index)
    .map((row) => row.suggestion);
}

/** Selectable row for a fully typed street and city when Nominatim has no house. */
function suggestionFromTyped(raw: string): AddressSuggestion | null {
  const parsed = parseAddressQuery(raw);
  if (!parsed.number || !parsed.streetName || !parsed.city) return null;
  const split = splitStreetUnit(streetLineWithoutLocality(raw));
  if (!split.street) return null;
  const zip = parsed.zip;
  const label = [split.street, parsed.city, ["FL", zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const token = signAddressSelection({
    label, street: split.street, city: parsed.city, state: "FL", zip, county: null,
    unitType: split.unitType, unitNumber: split.unitNumber,
  });
  return {
    label, street: split.street, city: parsed.city, state: "FL", zip, county: null,
    unitType: split.unitType, unitNumber: split.unitNumber, token,
  };
}

function nominatimLocality(hit: NominatimHit): string | null {
  const address = hit.address;
  if (!address) return null;
  return address.city || address.town || address.village || address.hamlet || address.municipality || null;
}

function queryIncludesCity(q: string, city: string): boolean {
  const needle = city.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (!needle) return false;
  return q.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").includes(needle);
}

/** Blank locality counts as a match so a house with no city tag can take the typed city. */
function hitAgrees(hit: NominatimHit, typedCity: string | null): boolean {
  if (!typedCity) return true;
  const locality = nominatimLocality(hit);
  if (!locality) return true;
  return citiesNear(typedCity, locality);
}

/** Put the ZIP mailing city on a suggestion that still has no locality, and re-sign it. */
function withMailingCity(suggestion: AddressSuggestion, city: string): AddressSuggestion {
  const stateZip = [suggestion.state, suggestion.zip].filter(Boolean).join(" ");
  const label = [suggestion.street, city, stateZip].filter(Boolean).join(", ");
  const token = signAddressSelection({
    label,
    street: suggestion.street,
    city,
    state: "FL",
    zip: suggestion.zip,
    county: suggestion.county,
    unitType: suggestion.unitType,
    unitNumber: suggestion.unitNumber,
    ...(suggestion.lat != null && suggestion.lng != null ? { lat: suggestion.lat, lng: suggestion.lng } : {}),
  });
  return { ...suggestion, label, city, token };
}

/**
 * Fill cities only where the geocoder left them blank. A named place such as
 * Highland City is not replaced by the mailing city. A failed lookup is not
 * cached, so the next pause can try again.
 */
async function fillMissingLocalities(
  suggestions: AddressSuggestion[],
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ suggestions: AddressSuggestion[]; complete: boolean }> {
  const missing = [...new Set(suggestions.filter((row) => !row.city && row.zip).map((row) => row.zip as string))];
  if (!missing.length) return { suggestions, complete: true };
  let cities: Map<string, string | null>;
  try {
    cities = await mailingCitiesForZips(missing, fetchImpl, signal);
  } catch {
    return { suggestions, complete: false };
  }
  const next = suggestions.map((row) => {
    if (row.city || !row.zip) return row;
    const city = cities.get(row.zip);
    return city ? withMailingCity(row, city) : row;
  });
  return { suggestions: next, complete: missing.every((zip) => cities.has(zip)) };
}

function remember(cache: Map<string, AddressSuggestResponse>, key: string, value: AddressSuggestResponse) {
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, value);
}

export async function suggestFloridaAddresses(
  raw: string,
  opts?: {
    fetchImpl?: typeof fetch;
    state?: SuggestState;
    signal?: AbortSignal;
    minIntervalMs?: number;
  },
): Promise<AddressSuggestResponse> {
  const query = raw.trim().slice(0, 120);
  const state = opts?.state ?? shared;
  const key = query.toLowerCase().replace(/\s+/g, " ");
  if (query.length < ADDRESS_SUGGEST_MIN_CHARS) return empty(query, "empty");
  const cached = state.cache.get(key);
  if (cached) return { ...cached, query };

  const minInterval = opts?.minIntervalMs ?? 1100;
  const now = Date.now();
  if (now - state.lastAt < minInterval) return empty(query, "throttled");
  state.lastAt = now;

  const fetchImpl = opts?.fetchImpl ?? fetch;

  async function fetchHits(q: string): Promise<NominatimHit[] | null> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "us");
    url.searchParams.set("layer", "address");
    url.searchParams.set("limit", String(ADDRESS_SUGGEST_LIMIT));
    url.searchParams.set("dedupe", "1");
    // Florida bounding box. bounded keeps other states out; Polk is ranked later, not filtered.
    url.searchParams.set("viewbox", FLORIDA_VIEWBOX);
    url.searchParams.set("bounded", "1");
    url.searchParams.set("q", q);
    const res = await fetchImpl(url, {
      signal: opts?.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "PermitRewind/1.0 (+https://permitrewind.com)",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as NominatimHit[];
  }

  const typedCity = intendedCity(query);
  const seen = new Set<string>();
  const tagged: { suggestion: AddressSuggestion; broadWeak: boolean }[] = [];
  let sawStrong = false;
  let sawCityQualifiedWeak = false;
  let unavailable = false;
  const plan = suggestionQueryPlan(query);
  try {
    for (let i = 0; i < plan.length; i++) {
      if (i > 0) {
        if (minInterval > 0) await new Promise((resolve) => setTimeout(resolve, minInterval));
        state.lastAt = Date.now();
      }
      const body = await fetchHits(plan[i]);
      if (!body) {
        unavailable = true;
        continue;
      }
      const broadened = !!typedCity && !queryIncludesCity(plan[i], typedCity);
      let batchStrong = false;
      let batchWeak = false;
      for (const hit of body) {
        const suggestion = suggestionFromNominatim(hit, query);
        if (!suggestion) continue;
        const id = suggestion.label.toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        const agrees = hitAgrees(hit, typedCity);
        if (agrees) batchStrong = true;
        else batchWeak = true;
        // A city-stripped query can return the same house number on a different
        // road (1221 Kings Avenue in Jacksonville). Keep looking for the typed city.
        tagged.push({ suggestion, broadWeak: !agrees && broadened });
      }
      if (batchStrong) sawStrong = true;
      if (!broadened && batchWeak) sawCityQualifiedWeak = true;
      if (sawStrong || sawCityQualifiedWeak) break;
      const laterCity = !!typedCity && plan.slice(i + 1).some((item) => queryIncludesCity(item, typedCity));
      if (tagged.length && !laterCity) break;
    }
  } catch {
    unavailable = true;
  }

  const pool = (sawStrong ? tagged.filter((row) => !row.broadWeak) : tagged).map((row) => row.suggestion);
  let ranked = rankAddressSuggestions(pool, query);
  if (!ranked.length) {
    const typed = suggestionFromTyped(query);
    if (typed) ranked = [typed];
  }
  if (!ranked.length) return empty(query, unavailable ? "unavailable" : "empty");
  ranked = ranked.slice(0, ADDRESS_SUGGEST_LIMIT);
  const filled = await fillMissingLocalities(ranked, fetchImpl, opts?.signal);
  ranked = filled.suggestions;

  const result: AddressSuggestResponse = {
    query,
    suggestions: ranked,
    attribution: ADDRESS_SUGGEST_ATTRIBUTION,
    status: "ok",
  };
  if (filled.complete) remember(state.cache, key, result);
  return result;
}
