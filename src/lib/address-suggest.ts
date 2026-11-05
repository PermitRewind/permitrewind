import { signAddressSelection } from "./address-selection";
import { parseAddressQuery } from "./address";
import { trailingKnownCity } from "./jurisdictions";

/**
 * Florida address suggestions. PermitStack has no autocomplete endpoint, so this
 * asks OpenStreetMap Nominatim on the server. The PermitStack key is never used here.
 *
 * Nominatim's usage policy allows this only when requests are paced (at most one
 * per second), cached, and sent after the user pauses. The route does that.
 * https://operations.osmfoundation.org/policies/nominatim/
 */

export const ADDRESS_SUGGEST_ATTRIBUTION = "© OpenStreetMap contributors";

export interface AddressSuggestion {
  /** Line placed in the search box, e.g. "3533 Sam Allen Oaks Circle, Plant City, FL 33563". */
  label: string;
  street: string;
  city: string | null;
  state: "FL";
  zip: string | null;
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
const MIN_QUERY = 4;
const CACHE_LIMIT = 200;

export function resetAddressSuggestState(): void {
  shared.lastAt = 0;
  shared.cache.clear();
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
}

interface NominatimHit {
  address?: NominatimAddress;
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
  const street = [address.house_number, address.road].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!street) return null;
  // Some Florida house points list only the county. Keep a city the user already typed.
  const city = address.city || address.town || address.village || address.hamlet || address.municipality || trailingKnownCity(typedQuery);
  const zip = address.postcode?.match(/\d{5}/)?.[0] ?? null;
  const stateZip = ["FL", zip].filter(Boolean).join(" ");
  const label = [street, city, stateZip].filter(Boolean).join(", ");
  const parsed = parseAddressQuery(street);
  if (!parsed.number || !parsed.streetName) return null;
  const token = signAddressSelection({ label, street, city, state: "FL", zip });
  return { label, street, city, state: "FL", zip, token };
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
  if (query.length < MIN_QUERY) return empty(query, "empty");
  const cached = state.cache.get(key);
  if (cached) return { ...cached, query };

  const minInterval = opts?.minIntervalMs ?? 1100;
  const now = Date.now();
  if (now - state.lastAt < minInterval) return empty(query, "throttled");
  state.lastAt = now;

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("layer", "address");
  url.searchParams.set("limit", "5");
  url.searchParams.set("dedupe", "1");
  // Florida bounding box: left, top, right, bottom.
  url.searchParams.set("viewbox", "-87.7,31.1,-79.8,24.4");
  url.searchParams.set("bounded", "1");
  const q = /\b(fl|florida)\b/i.test(query) ? query : `${query}, Florida`;
  url.searchParams.set("q", q);

  try {
    const res = await fetchImpl(url, {
      signal: opts?.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "PermitRewind/1.0 (+https://permitrewind.com)",
      },
    });
    if (!res.ok) return empty(query, "unavailable");
    const body = (await res.json()) as NominatimHit[];
    const seen = new Set<string>();
    const suggestions: AddressSuggestion[] = [];
    for (const hit of body) {
      const suggestion = suggestionFromNominatim(hit, query);
      if (!suggestion) continue;
      const id = suggestion.label.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      suggestions.push(suggestion);
      if (suggestions.length === 5) break;
    }
    const result: AddressSuggestResponse = {
      query,
      suggestions,
      attribution: ADDRESS_SUGGEST_ATTRIBUTION,
      status: suggestions.length ? "ok" : "empty",
    };
    remember(state.cache, key, result);
    return result;
  } catch {
    return empty(query, "unavailable");
  }
}
