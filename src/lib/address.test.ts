import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/address-suggest/route";
import { parseAddressQuery, permitAddressMatches, suffixEquivalents, toPermitStackAddress } from "./address";
import { reduceComboboxKey } from "./address-combobox";
import { resetAddressSuggestState, suggestionFromNominatim } from "./address-suggest";

test("parses 3533 Sam Allen Oaks Cir Plant City and suffix variants", () => {
  for (const q of ["3533 Sam Allen Oaks Cir Plant City", "3533 Sam Allen Oaks Circle, Plant City, FL 33563", "3533 Sam Allen Oaks CR Plant City"]) {
    const parsed = parseAddressQuery(q);
    assert.equal(parsed.number, "3533");
    assert.equal(parsed.streetName, "Sam Allen Oaks");
    assert.ok(parsed.suffix && suffixEquivalents(parsed.suffix).includes("CIR"));
    assert.ok(suffixEquivalents(parsed.suffix).includes("CIRCLE"));
    assert.ok(suffixEquivalents(parsed.suffix).includes("CR"));
    assert.equal(parsed.city, "Plant City");
    const built = toPermitStackAddress(parsed);
    assert.equal(built.address, "3533 Sam Allen Oaks");
    assert.equal(built.city, "Plant City");
    if (q.includes("33563")) assert.equal(built.zip, "33563");
    else assert.equal(built.zip, undefined);
  }
  const dove = parseAddressQuery("19156 Dove Creek Dr");
  assert.equal(toPermitStackAddress(dove).address, "19156 Dove Creek");
  assert.equal(dove.city, null);
  assert.equal(dove.zip, null);
  const zipOnly = parseAddressQuery("3533 Sam Allen Oaks Circle, FL 33565");
  assert.equal(zipOnly.city, null);
  assert.equal(zipOnly.zip, "33565");
  assert.deepEqual(toPermitStackAddress(zipOnly), { address: "3533 Sam Allen Oaks", zip: "33565" });
});

test("suffix fallback keeps the four Sam Allen Oaks rows and drops Boulevard", () => {
  const parsed = parseAddressQuery("3533 Sam Allen Oaks Cir Plant City");
  const keep = [
    { address: "3533 SAM ALLEN OAKS CIR", city: "PLANT CITY" },
    { address: "3533 SAM ALLEN OAKS CIRCLE", city: "PLANT CITY" },
    { address: "3533 SAM ALLEN OAKS CIR", city: "PLANT CITY" },
    { address: "3533 SAM ALLEN OAKS CR", city: "PLANT CITY" },
  ];
  assert.equal(keep.every((row) => permitAddressMatches(parsed, row)), true);
  assert.equal(permitAddressMatches(parsed, { address: "3533 SAM ALLEN OAKS BLVD", city: "PLANT CITY" }), false);
  assert.equal(permitAddressMatches(parsed, { address: "3534 SAM ALLEN OAKS CIR", city: "PLANT CITY" }), false);
});

test("keyboard selection moves, selects, and leaves typed search alone", () => {
  let state = { open: true, active: -1, count: 3 };
  const down = reduceComboboxKey(state, "ArrowDown");
  assert.equal(down.type, "move");
  if (down.type !== "move") return;
  state = down.state;
  assert.equal(state.active, 0);
  const down2 = reduceComboboxKey(state, "ArrowDown");
  if (down2.type !== "move") throw new Error("expected move");
  state = down2.state;
  assert.equal(state.active, 1);
  const selected = reduceComboboxKey(state, "Enter");
  assert.deepEqual(selected, { type: "select", index: 1, preventDefault: true });
  const typed = reduceComboboxKey({ open: true, active: -1, count: 3 }, "Enter");
  assert.equal(typed.type, "submit");
  const closed = reduceComboboxKey(state, "Escape");
  assert.equal(closed.type, "close");
  const up = reduceComboboxKey({ open: false, active: -1, count: 3 }, "ArrowUp");
  assert.equal(up.type, "move");
  if (up.type === "move") assert.equal(up.state.active, 2);
});

test("GET /api/address-suggest returns standardized Florida addresses as JSON", { concurrency: false }, async () => {
  resetAddressSuggestState();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    assert.equal(url.hostname, "nominatim.openstreetmap.org");
    assert.equal(new Headers(init?.headers).get("X-API-Key"), null);
    assert.match(new Headers(init?.headers).get("User-Agent") ?? "", /PermitRewind/);
    return new Response(JSON.stringify([
      { address: { house_number: "3533", road: "Sam Allen Oaks Circle", city: "Plant City", state: "Florida", postcode: "33563", country_code: "us" } },
      { address: { house_number: "10", road: "Peachtree St", city: "Atlanta", state: "Georgia", postcode: "30303", country_code: "us" } },
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const res = await GET(new NextRequest("http://localhost/api/address-suggest?q=3533%20Sam%20Allen"));
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.attribution, "© OpenStreetMap contributors");
    assert.equal(body.suggestions.length, 1);
    assert.deepEqual(body.suggestions[0], {
      label: "3533 Sam Allen Oaks Circle, Plant City, FL 33563",
      street: "3533 Sam Allen Oaks Circle",
      city: "Plant City",
      state: "FL",
      zip: "33563",
    });
    assert.equal(JSON.stringify(body).includes("PERMITSTACK"), false);
    const again = await GET(new NextRequest("http://localhost/api/address-suggest?q=3533%20Sam%20Allen"));
    assert.equal((await again.json()).suggestions.length, 1);
    assert.equal(calls, 1);
    const busy = await GET(new NextRequest("http://localhost/api/address-suggest?q=999%20Other%20Street"));
    assert.equal((await busy.json()).status, "throttled");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    resetAddressSuggestState();
  }
});

test("short suggest queries are JSON with no upstream call", { concurrency: false }, async () => {
  resetAddressSuggestState();
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    calls += 1;
    throw new Error("should not fetch");
  }) as typeof fetch;
  try {
    const res = await GET(new NextRequest("http://localhost/api/address-suggest?q=35"));
    const body = await res.json();
    assert.deepEqual(body.suggestions, []);
    assert.equal(body.status, "empty");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    resetAddressSuggestState();
  }
});

test("non-Florida Nominatim rows are dropped and a typed city fills a missing city", () => {
  assert.equal(suggestionFromNominatim({ address: { road: "Peachtree St", city: "Atlanta", state: "Georgia" } }), null);
  const filled = suggestionFromNominatim(
    { address: { house_number: "3533", road: "Sam Allen Oaks Circle", state: "Florida", postcode: "33565" } },
    "3533 Sam Allen Oaks Plant City",
  );
  assert.equal(filled?.city, "Plant City");
  assert.equal(filled?.zip, "33565");
  assert.equal(filled?.state, "FL");
  assert.match(filled?.label ?? "", /Plant City, FL 33565/);
});

test("suggest route source does not read the PermitStack key", () => {
  const route = readFileSync("src/app/api/address-suggest/route.ts", "utf8");
  const suggest = readFileSync("src/lib/address-suggest.ts", "utf8");
  assert.match(route, /NextResponse\.json/);
  assert.doesNotMatch(route + suggest, /PERMITSTACK_API_KEY/);
  assert.match(readFileSync("README.md", "utf8"), /\/api\/address-suggest/);
});
