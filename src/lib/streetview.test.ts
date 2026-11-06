import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/streetview/route";
import { readAddressSelection } from "./address-selection";
import { suggestionFromNominatim } from "./address-suggest";
import {
  loadStreetView,
  previewStreetView,
  resetStreetViewCache,
  streetViewImageSrc,
  type StreetViewDeps,
} from "./streetview";

const KEY = "test-street-key";
const ADDRESS = "10 Main Street, Lakeland, FL 33801";
const JPEG = Uint8Array.from([255, 216, 255, 217]);

function asUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function googleFetch(decide: (url: URL) => Response): { fetchImpl: typeof fetch; calls: { path: string; location: string | null }[] } {
  const calls: { path: string; location: string | null }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = asUrl(input);
    assert.equal(url.hostname, "maps.googleapis.com");
    assert.equal(url.searchParams.get("key"), KEY);
    calls.push({ path: url.pathname, location: url.searchParams.get("location") });
    return decide(url);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function imageResponse(): Response {
  return new Response(JPEG, { status: 200, headers: { "Content-Type": "image/jpeg" } });
}

function deps(fetchImpl: typeof fetch, cache = new Map()): StreetViewDeps {
  return { fetchImpl, apiKey: KEY, cache };
}

test("metadata OK then the static image is served", async () => {
  const cache = new Map();
  const { fetchImpl, calls } = googleFetch((url) => (url.pathname.endsWith("/metadata") ? jsonResponse({ status: "OK" }) : imageResponse()));
  const result = await loadStreetView({ address: ADDRESS }, deps(fetchImpl, cache));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.cache, "miss");
  assert.equal(result.contentType, "image/jpeg");
  assert.deepEqual([...result.bytes], [...JPEG]);
  assert.equal(JSON.stringify({ contentType: result.contentType, cache: result.cache }).includes(KEY), false);
  assert.deepEqual(calls.map((call) => call.path), ["/maps/api/streetview/metadata", "/maps/api/streetview"]);
  assert.equal(calls[1].location, ADDRESS);
  assert.equal(calls[1].path.includes("metadata"), false);

  const again = await loadStreetView({ address: `  ${ADDRESS.toLowerCase()}  ` }, deps(fetchImpl, cache));
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.cache, "hit");
  assert.equal(calls.length, 2);
});

test("metadata ZERO_RESULTS or another non-OK status does not request an image", async () => {
  for (const status of ["ZERO_RESULTS", "REQUEST_DENIED", "NOT_FOUND"]) {
    const { fetchImpl, calls } = googleFetch(() => jsonResponse({ status }));
    const result = await loadStreetView({ address: ADDRESS }, deps(fetchImpl));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, status === "REQUEST_DENIED" ? "upstream" : "no_imagery");
    assert.deepEqual(calls.map((call) => call.path), ["/maps/api/streetview/metadata"]);
  }
});

test("a missing API key returns the fallback and does not call Google", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new Error("Google should not be called");
  }) as typeof fetch;
  const result = await loadStreetView({ address: ADDRESS, lat: 28.03, lng: -81.95 }, { fetchImpl, apiKey: null });
  assert.deepEqual(result, { ok: false, reason: "missing_key" });
  assert.equal(calls, 0);
  const preview = await previewStreetView({ address: ADDRESS }, { fetchImpl, apiKey: "" });
  assert.deepEqual(preview, { available: false, src: null });
  assert.equal(calls, 0);
});

test("address with no imagery falls back to coordinates and still checks metadata first", async () => {
  const { fetchImpl, calls } = googleFetch((url) => {
    if (url.pathname.endsWith("/metadata")) {
      const status = url.searchParams.get("location") === "28.0395,-81.9498" ? "OK" : "ZERO_RESULTS";
      return jsonResponse({ status });
    }
    return imageResponse();
  });
  const result = await loadStreetView(
    { address: ADDRESS, lat: 28.0395, lng: -81.9498 },
    deps(fetchImpl),
  );
  assert.equal(result.ok, true);
  const images = calls.filter((call) => call.path === "/maps/api/streetview");
  assert.equal(images.length, 1);
  assert.equal(images[0].location, "28.0395,-81.9498");
  assert.equal(calls[0].path, "/maps/api/streetview/metadata");
  assert.equal(calls[0].location, ADDRESS);
});

test("the browser image URL is same-origin and has no API key", () => {
  const src = streetViewImageSrc({ address: ADDRESS, lat: 28.0395, lng: -81.9498 });
  assert.equal(src.startsWith("/api/streetview?"), true);
  assert.equal(src.includes("googleapis"), false);
  assert.equal(src.includes("key="), false);
  assert.equal(src.includes(KEY), false);
  assert.match(src, /address=/);
  assert.match(src, /lat=28\.0395/);
  assert.match(src, /lng=-81\.9498/);
});

test("Nominatim coordinates ride along on the signed selection for the coordinate fallback", () => {
  const suggestion = suggestionFromNominatim(
    {
      lat: "28.0395",
      lon: "-81.9498",
      address: { house_number: "10", road: "Main Street", city: "Lakeland", state: "Florida", postcode: "33801" },
    },
  );
  assert.equal(suggestion?.lat, 28.0395);
  assert.equal(suggestion?.lng, -81.9498);
  const selection = readAddressSelection(suggestion?.token);
  assert.equal(selection?.lat, 28.0395);
  assert.equal(selection?.lng, -81.9498);
  assert.equal(selection?.street, "10 Main Street");
});

test("GET /api/streetview returns an image only after metadata OK", { concurrency: false }, async () => {
  resetStreetViewCache();
  const previous = process.env.GOOGLE_STREET_VIEW_API_KEY;
  process.env.GOOGLE_STREET_VIEW_API_KEY = KEY;
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = asUrl(input);
    paths.push(url.pathname);
    assert.equal(url.searchParams.get("key"), KEY);
    if (url.pathname.endsWith("/metadata")) return jsonResponse({ status: "OK" });
    return imageResponse();
  }) as typeof fetch;
  try {
    const res = await GET(new NextRequest(`http://localhost/api/streetview?address=${encodeURIComponent(ADDRESS)}`));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^image\/jpeg/);
    assert.equal(res.headers.get("x-street-view-cache"), "miss");
    const body = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...body], [...JPEG]);
    assert.equal(body.includes(Buffer.from(KEY)), false);
    assert.equal([...res.headers].join("\n").includes(KEY), false);
    assert.deepEqual(paths, ["/maps/api/streetview/metadata", "/maps/api/streetview"]);

    const cached = await GET(new NextRequest(`http://localhost/api/streetview?address=${encodeURIComponent(ADDRESS)}`));
    assert.equal(cached.status, 200);
    assert.equal(cached.headers.get("x-street-view-cache"), "hit");
    assert.equal(paths.length, 2);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.GOOGLE_STREET_VIEW_API_KEY;
    else process.env.GOOGLE_STREET_VIEW_API_KEY = previous;
    resetStreetViewCache();
  }
});

test("GET /api/streetview is a non-image fallback when metadata is not OK", { concurrency: false }, async () => {
  resetStreetViewCache();
  const previous = process.env.GOOGLE_STREET_VIEW_API_KEY;
  process.env.GOOGLE_STREET_VIEW_API_KEY = KEY;
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = asUrl(input);
    paths.push(url.pathname);
    return jsonResponse({ status: "ZERO_RESULTS" });
  }) as typeof fetch;
  try {
    const res = await GET(new NextRequest(`http://localhost/api/streetview?address=${encodeURIComponent(ADDRESS)}`));
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.equal(body.message, "No street view available");
    assert.equal(body.status, "unavailable");
    assert.equal(JSON.stringify(body).includes(KEY), false);
    assert.deepEqual(paths, ["/maps/api/streetview/metadata"]);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.GOOGLE_STREET_VIEW_API_KEY;
    else process.env.GOOGLE_STREET_VIEW_API_KEY = previous;
    resetStreetViewCache();
  }
});

test("GET /api/streetview does not call Google when the key is missing", { concurrency: false }, async () => {
  resetStreetViewCache();
  const previous = process.env.GOOGLE_STREET_VIEW_API_KEY;
  delete process.env.GOOGLE_STREET_VIEW_API_KEY;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("Google should not be called");
  }) as typeof fetch;
  try {
    const res = await GET(new NextRequest(`http://localhost/api/streetview?address=${encodeURIComponent(ADDRESS)}&lat=28.03&lng=-81.95`));
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.equal(body.message, "No street view available");
    assert.equal(body.reason, "missing_key");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.GOOGLE_STREET_VIEW_API_KEY;
    else process.env.GOOGLE_STREET_VIEW_API_KEY = previous;
    resetStreetViewCache();
  }
});
