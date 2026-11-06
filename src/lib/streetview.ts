import "server-only";

/**
 * Google Street View for the one property a visitor just searched.
 *
 * The key is `GOOGLE_STREET_VIEW_API_KEY` and is read only on the server.
 * Callers receive image bytes or a same-origin path (`/api/streetview`).
 * Nothing in this module puts the key in a URL the browser can see.
 *
 * Metadata (`streetview/metadata`) is requested first. Those calls are free
 * and unlimited. The Static image endpoint is requested only when metadata
 * status is `OK`, because each Static image counts toward the 10,000 free
 * images per month.
 *
 * Cache: process memory, 24 hours, keyed by the normalized address and, when
 * coordinates are used, by latitude/longitude rounded to 5 decimals. A hit
 * stores either "no imagery" or the JPEG bytes. Repeating a search for the
 * same house reuses that entry and does not spend another Static image
 * request. The image route also sends `Cache-Control` so the browser can
 * skip this server entirely on refresh. A missing key is not cached.
 */

export const STREET_VIEW_WIDTH = 640;
export const STREET_VIEW_HEIGHT = 360;
export const STREET_VIEW_UNAVAILABLE = "No street view available";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 200;
const METADATA_ENDPOINT = "https://maps.googleapis.com/maps/api/streetview/metadata";
const IMAGE_ENDPOINT = "https://maps.googleapis.com/maps/api/streetview";

export type StreetViewFailure = "missing_key" | "no_imagery" | "upstream";

export type StreetViewImage = {
  ok: true;
  contentType: string;
  bytes: Uint8Array;
  cache: "hit" | "miss";
};

export type StreetViewMiss = { ok: false; reason: StreetViewFailure };

export interface StreetViewQuery {
  address: string;
  lat?: number | null;
  lng?: number | null;
}

export interface StreetViewPreview {
  available: boolean;
  /** Same-origin image URL. Null when the photo should not be requested. */
  src: string | null;
}

interface CacheEntry {
  at: number;
  imagery: boolean;
  contentType?: string;
  bytes?: Uint8Array;
}

export interface StreetViewDeps {
  fetchImpl?: typeof fetch;
  /** Pass `null` to force the missing-key path even if the env var is set. */
  apiKey?: string | null;
  now?: number;
  cache?: Map<string, CacheEntry>;
}

type Resolved =
  | {
      ok: true;
      location: string;
      storeKeys: string[];
      bytes: Uint8Array | null;
      contentType: string | null;
    }
  | { ok: false; reason: StreetViewFailure };

const sharedCache = new Map<string, CacheEntry>();

export function resetStreetViewCache(): void {
  sharedCache.clear();
}

/** Street, city, and state/ZIP for the metadata `location` parameter. */
export function propertyStreetViewAddress(parts: {
  street: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const stateZip = [parts.state?.trim() || "FL", parts.zip?.trim()].filter(Boolean).join(" ");
  return [parts.street.trim(), parts.city?.trim(), stateZip].filter(Boolean).join(", ");
}

/** Browser URL for the proxy. Never includes a Google host or API key. */
export function streetViewImageSrc(query: StreetViewQuery): string {
  const params = new URLSearchParams();
  const address = query.address.trim();
  if (address) params.set("address", address.slice(0, 240));
  const coords = validCoords(query.lat, query.lng);
  if (coords) {
    params.set("lat", String(coords.lat));
    params.set("lng", String(coords.lng));
  }
  return `/api/streetview?${params.toString()}`;
}

function validCoords(lat?: number | null, lng?: number | null): { lat: number; lng: number } | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function normalizeAddress(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 240);
}

function apiKeyFrom(opts?: StreetViewDeps): string | null {
  if (opts && Object.prototype.hasOwnProperty.call(opts, "apiKey")) {
    return opts.apiKey?.trim() || null;
  }
  return process.env.GOOGLE_STREET_VIEW_API_KEY?.trim() || null;
}

function readFresh(cache: Map<string, CacheEntry>, key: string, now: number): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function writeEntry(cache: Map<string, CacheEntry>, key: string, entry: CacheEntry): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function googleUrl(kind: "metadata" | "image", location: string, apiKey: string): URL {
  const url = new URL(kind === "metadata" ? METADATA_ENDPOINT : IMAGE_ENDPOINT);
  if (kind === "image") {
    url.searchParams.set("size", `${STREET_VIEW_WIDTH}x${STREET_VIEW_HEIGHT}`);
    url.searchParams.set("return_error_code", "true");
  }
  // Outdoor panoramas match a property photo. Metadata uses the same source
  // so a ZERO_RESULTS there is not followed by a Static image request.
  url.searchParams.set("source", "outdoor");
  url.searchParams.set("location", location);
  url.searchParams.set("key", apiKey);
  return url;
}

type MetaStatus = "ok" | "none" | "error";

async function metadataStatus(fetchImpl: typeof fetch, location: string, apiKey: string): Promise<MetaStatus> {
  let res: Response;
  try {
    res = await fetchImpl(googleUrl("metadata", location, apiKey));
  } catch {
    return "error";
  }
  if (!res.ok) return "error";
  try {
    const body = (await res.json()) as { status?: unknown };
    if (body.status === "OK") return "ok";
    if (body.status === "ZERO_RESULTS" || body.status === "NOT_FOUND") return "none";
    return "error";
  } catch {
    return "error";
  }
}

async function fetchImage(
  fetchImpl: typeof fetch,
  location: string,
  apiKey: string,
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  let res: Response;
  try {
    res = await fetchImpl(googleUrl("image", location, apiKey));
  } catch {
    return null;
  }
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!res.ok || !contentType.startsWith("image/")) return null;
  try {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength) return null;
    return { contentType, bytes };
  } catch {
    return null;
  }
}

async function lookupLocation(
  location: string,
  cacheKey: string,
  cache: Map<string, CacheEntry>,
  now: number,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<
  | { ok: true; bytes: Uint8Array | null; contentType: string | null }
  | { ok: false; reason: "no_imagery" | "upstream" }
> {
  const hit = readFresh(cache, cacheKey, now);
  if (hit?.bytes && hit.contentType) return { ok: true, bytes: hit.bytes, contentType: hit.contentType };
  if (hit?.imagery) return { ok: true, bytes: null, contentType: null };
  if (hit && !hit.imagery) return { ok: false, reason: "no_imagery" };

  const status = await metadataStatus(fetchImpl, location, apiKey);
  if (status === "error") return { ok: false, reason: "upstream" };
  if (status === "none") {
    writeEntry(cache, cacheKey, { at: now, imagery: false });
    return { ok: false, reason: "no_imagery" };
  }
  writeEntry(cache, cacheKey, { at: now, imagery: true });
  return { ok: true, bytes: null, contentType: null };
}

async function resolveImagery(query: StreetViewQuery, opts?: StreetViewDeps): Promise<Resolved> {
  const apiKey = apiKeyFrom(opts);
  if (!apiKey) return { ok: false, reason: "missing_key" };

  const address = normalizeAddress(query.address);
  const coords = validCoords(query.lat, query.lng);
  if (!address && !coords) return { ok: false, reason: "no_imagery" };

  const cache = opts?.cache ?? sharedCache;
  const now = opts?.now ?? Date.now();
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const addrKey = address ? `addr:${address.toLowerCase()}` : null;
  const coordLocation = coords ? `${coords.lat},${coords.lng}` : null;
  const llKey = coords ? `ll:${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}` : null;

  const finish = (
    hit: { bytes: Uint8Array | null; contentType: string | null },
    location: string,
    keys: string[],
  ): Resolved => ({
    ok: true,
    location,
    storeKeys: keys,
    bytes: hit.bytes,
    contentType: hit.contentType,
  });

  if (addrKey && address) {
    const addressHit = await lookupLocation(address, addrKey, cache, now, fetchImpl, apiKey);
    if (addressHit.ok) return finish(addressHit, address, [addrKey]);
    if (addressHit.reason === "upstream" && !(coordLocation && llKey)) return { ok: false, reason: "upstream" };
  }

  if (coordLocation && llKey) {
    const coordHit = await lookupLocation(coordLocation, llKey, cache, now, fetchImpl, apiKey);
    if (!coordHit.ok) return { ok: false, reason: coordHit.reason };
    return finish(coordHit, coordLocation, addrKey ? [llKey, addrKey] : [llKey]);
  }

  return { ok: false, reason: "no_imagery" };
}

/** Metadata only. The Static image is left for `loadStreetView` / the proxy route. */
export async function previewStreetView(query: StreetViewQuery, opts?: StreetViewDeps): Promise<StreetViewPreview> {
  try {
    const resolved = await resolveImagery(query, opts);
    if (!resolved.ok) return { available: false, src: null };
    return { available: true, src: streetViewImageSrc(query) };
  } catch {
    return { available: false, src: null };
  }
}

/** Metadata first, then the Static image when status is OK. Serves cached bytes on a hit. */
export async function loadStreetView(query: StreetViewQuery, opts?: StreetViewDeps): Promise<StreetViewImage | StreetViewMiss> {
  const resolved = await resolveImagery(query, opts);
  if (!resolved.ok) return resolved;
  if (resolved.bytes && resolved.contentType) {
    return { ok: true, contentType: resolved.contentType, bytes: resolved.bytes, cache: "hit" };
  }

  const apiKey = apiKeyFrom(opts);
  if (!apiKey) return { ok: false, reason: "missing_key" };
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const image = await fetchImage(fetchImpl, resolved.location, apiKey);
  if (!image) return { ok: false, reason: "upstream" };

  const cache = opts?.cache ?? sharedCache;
  const now = opts?.now ?? Date.now();
  for (const key of resolved.storeKeys) {
    writeEntry(cache, key, { at: now, imagery: true, contentType: image.contentType, bytes: image.bytes });
  }
  return { ok: true, contentType: image.contentType, bytes: image.bytes, cache: "miss" };
}
