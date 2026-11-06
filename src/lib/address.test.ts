import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/address-suggest/route";
import { GET as searchGET } from "../app/api/search/route";
import { cityPreference, parseAddressQuery, permitAddressMatches, suffixEquivalents, toPermitStackAddress } from "./address";
import { isAddressSearchEnabled, reduceComboboxKey } from "./address-combobox";
import { abbreviateAddress, ADDRESS_SUGGEST_DEBOUNCE_MS, ADDRESS_SUGGEST_LIMIT, ADDRESS_SUGGEST_MIN_CHARS, addressQueryVariants, expandAddress, highlightAddressLabel } from "./address-normalize";
import { evaluateAddressSubmission, signAddressSelection } from "./address-selection";
import { FLORIDA_VIEWBOX, nominatimQueryPlan, rankAddressSuggestions, resetAddressSuggestState, suggestFloridaAddresses, suggestionFromNominatim, suggestionQueryPlan } from "./address-suggest";

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
  assert.equal(toPermitStackAddress(dove).address, "19156 Dove Creek Dr");
  assert.equal(dove.city, null);
  assert.equal(dove.zip, null);
  const zipOnly = parseAddressQuery("3533 Sam Allen Oaks Circle, FL 33565");
  assert.equal(zipOnly.city, null);
  assert.equal(zipOnly.zip, "33565");
  assert.deepEqual(toPermitStackAddress(zipOnly), { address: "3533 Sam Allen Oaks", zip: "33565" });
});

test("Dove Creek keeps directional and Drive rows and drops a different suffix", () => {
  const parsed = parseAddressQuery("19156 Dove Creek Dr");
  const keep = [
    { address: "19156 DOVE CREEK DR", city: "TAMPA" },
    { address: "19156 DOVE CREEK DRIVE", city: "TAMPA" },
    { address: "19156 N DOVE CREEK DR", city: "TAMPA" },
    { address: "19156 DOVE CREEK DR N", city: "TAMPA" },
  ];
  assert.equal(keep.every((row) => permitAddressMatches(parsed, row)), true);
  assert.equal(permitAddressMatches(parsed, { address: "19156 DOVE CREEK BLVD", city: "TAMPA" }), false);
  assert.equal(permitAddressMatches(parsed, { address: "19156 DOVE CREEK CT", city: "TAMPA" }), false);
});

test("605 South Central Avenue Bartow ranks Bartow ahead of Winter Haven and can exclude it", () => {
  const parsed = parseAddressQuery("605 South Central Avenue Bartow");
  assert.equal(parsed.city, "Bartow");
  assert.equal(toPermitStackAddress(parseAddressQuery("605 South Central Avenue")).address, "605 S Central Ave");
  const bartow = { address: "605 S CENTRAL AVE", city: "BARTOW", jurisdiction: "City of Bartow" };
  const winter = { address: "605 SOUTH CENTRAL AVENUE", city: "WINTER HAVEN", jurisdiction: "City of Winter Haven" };
  assert.equal(permitAddressMatches(parsed, bartow), true);
  assert.equal(permitAddressMatches(parsed, winter), false);
  assert.equal(cityPreference("Bartow", bartow), 0);
  assert.equal(cityPreference("Bartow", winter), 2);
  assert.equal(cityPreference("Bartow", { city: null, jurisdiction: "Polk County" }), 1);
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
    assert.equal(url.searchParams.get("countrycodes"), "us");
    assert.equal(url.searchParams.get("bounded"), "1");
    assert.equal(url.searchParams.get("viewbox"), FLORIDA_VIEWBOX);
    assert.equal(url.searchParams.get("limit"), String(ADDRESS_SUGGEST_LIMIT));
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
    const { token, ...suggestion } = body.suggestions[0];
    assert.equal(suggestion.label, "3533 Sam Allen Oaks Circle, Plant City, FL 33563");
    assert.equal(suggestion.street, "3533 Sam Allen Oaks Circle");
    assert.equal(suggestion.city, "Plant City");
    assert.equal(suggestion.state, "FL");
    assert.equal(suggestion.zip, "33563");
    assert.equal(typeof token, "string");
    assert.equal(token.includes("."), true);
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
  const mismatch = suggestionFromNominatim(
    { address: { house_number: "3749", road: "Feather Drive", city: "Highland City", county: "Polk County", state: "Florida", postcode: "33812" } },
    "3749 Feather Dr Lakeland",
  );
  assert.equal(mismatch?.city, "Lakeland");
  assert.equal(mismatch?.county, "Polk");

  // Live Nominatim shape for 3533 Sam Allen Oaks: road and ZIP, no city tag.
  const plantCity = suggestionFromNominatim(
    { address: { house_number: "3533", road: "Sam Allen Oaks Circle", county: "Hillsborough County", state: "Florida", postcode: "33565" } },
    "3533 Sam Allen Oaks Cir Plant City",
  );
  assert.equal(plantCity?.street, "3533 Sam Allen Oaks Circle");
  assert.equal(plantCity?.city, "Plant City");
  assert.equal(plantCity?.zip, "33565");
  assert.equal(plantCity?.county, "Hillsborough");
  assert.match(plantCity?.label ?? "", /Plant City, FL 33565/);
});

test("full street and city still suggests when Nominatim drops the city-qualified query", { concurrency: false }, async () => {
  const house = {
    address: {
      house_number: "3533",
      road: "Sam Allen Oaks Circle",
      county: "Hillsborough County",
      state: "Florida",
      postcode: "33565",
    },
  };
  assert.deepEqual(nominatimQueryPlan("3533 Sam Allen Oaks Cir Plant City"), [
    "3533 Sam Allen Oaks Cir Plant City, Florida",
    "3533 Sam Allen Oaks Cir, Florida",
  ]);
  assert.deepEqual(nominatimQueryPlan("3533 Sam Allen Oaks Circle Plant City"), [
    "3533 Sam Allen Oaks Circle Plant City, Florida",
    "3533 Sam Allen Oaks Circle, Florida",
  ]);

  const original = globalThis.fetch;
  const queries: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const q = url.searchParams.get("q") ?? "";
    queries.push(q);
    const body = /sam allen/i.test(q) && !/plant city/i.test(q) ? [house] : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    for (const typed of ["3533 Sam Allen Oaks Cir Plant City", "3533 Sam Allen Oaks Circle Plant City"]) {
      queries.length = 0;
      const result = await suggestFloridaAddresses(typed, { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
      assert.equal(result.status, "ok");
      assert.equal(result.suggestions.length, 1);
      assert.equal(result.suggestions[0].street, "3533 Sam Allen Oaks Circle");
      assert.equal(result.suggestions[0].city, "Plant City");
      assert.equal(result.suggestions[0].zip, "33565");
      assert.equal(result.suggestions[0].county, "Hillsborough");
      assert.equal(queries.length, 2);
      assert.match(queries[0], /Plant City/i);
      assert.doesNotMatch(queries[1], /Plant City/i);
    }
    const missed = await suggestFloridaAddresses("9999 Nowhere Rd Bartow", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(missed.status, "ok");
    assert.equal(missed.suggestions[0].street, "9999 Nowhere Rd");
    assert.equal(missed.suggestions[0].city, "Bartow");
    assert.equal(typeof missed.suggestions[0].token, "string");
  } finally {
    globalThis.fetch = original;
  }
});

const sample = {
  label: "3533 Sam Allen Oaks Circle, Plant City, FL 33563",
  street: "3533 Sam Allen Oaks Circle",
  city: "Plant City" as const,
  state: "FL" as const,
  zip: "33563",
};

test("Search stays disabled until a real suggestion is selected", () => {
  const token = signAddressSelection(sample);
  assert.equal(isAddressSearchEnabled({ mode: "address", text: sample.label, selected: null }), false);
  assert.equal(isAddressSearchEnabled({ mode: "address", text: sample.label, selected: { label: sample.label, token: "" } }), false);
  assert.equal(isAddressSearchEnabled({ mode: "address", text: sample.label, selected: { label: sample.label, token } }), true);
  assert.equal(isAddressSearchEnabled({ mode: "address", text: `${sample.label} `, selected: { label: sample.label, token } }), true);
  assert.equal(isAddressSearchEnabled({ mode: "address", text: `${sample.label} x`, selected: { label: sample.label, token } }), false);
  assert.equal(isAddressSearchEnabled({ mode: "parcel", text: "24-28-15", selected: null }), true);
  assert.equal(isAddressSearchEnabled({ mode: "permit", text: "BTR-23-0567345", selected: null }), true);
});

test("pasted address is rejected before PermitStack and a signed selection is accepted", { concurrency: false }, async () => {
  process.env.ADDRESS_SELECTION_SECRET = "test-selection-secret";
  const token = signAddressSelection(sample);
  assert.equal(evaluateAddressSubmission(sample.label, null).ok, false);
  assert.equal(evaluateAddressSubmission(sample.label, `${token}tampered`).ok, false);
  assert.equal(evaluateAddressSubmission("19156 Dove Creek Dr", token).ok, false);
  assert.equal(evaluateAddressSubmission("Main Street", token).ok, false);
  const expired = signAddressSelection({ ...sample, exp: Date.now() - 1000 });
  assert.equal(evaluateAddressSubmission(sample.street, expired).ok, false);
  assert.equal(evaluateAddressSubmission(sample.street, token).ok, true);
  assert.equal(evaluateAddressSubmission(sample.label, token).ok, false);

  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("PermitStack should not be called");
  }) as typeof fetch;
  try {
    const rejected = await searchGET(new NextRequest(`http://localhost/api/search?mode=address&q=${encodeURIComponent(sample.street)}`));
    assert.equal(rejected.status, 422);
    const body = await rejected.json();
    assert.match(body.error, /spelling|cross street/i);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }

  process.env.PERMITSTACK_API_KEY = "test-key";
  process.env.ADDRESS_SELECTION_SECRET = "test-selection-secret";
  const hosts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    hosts.push(url.hostname);
    return new Response(JSON.stringify({ results: [], total: 0, page: 1, per_page: 100 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const accepted = await searchGET(new NextRequest(`http://localhost/api/search?mode=address&q=${encodeURIComponent(sample.street)}&sel=${encodeURIComponent(token)}&city=Lakeland`));
    assert.equal(accepted.status, 200);
    assert.equal(hosts[0], "api.permit-stack.com");
    const permit = await searchGET(new NextRequest("http://localhost/api/search?mode=permit&q=BTR-23-0567345"));
    assert.equal(permit.status, 200);
    assert.ok(hosts.includes("api.permit-stack.com"));
  } finally {
    globalThis.fetch = original;
  }
});

test("expandAddress and abbreviateAddress cover directionals and street types both ways", () => {
  assert.equal(expandAddress("123 NE Main St"), "123 northeast main street");
  assert.equal(expandAddress("123 N.E. Main St."), "123 northeast main street");
  assert.equal(expandAddress("123 NW 1st Ave"), "123 northwest 1st avenue");
  assert.equal(expandAddress("123 SE 2nd Blvd"), "123 southeast 2nd boulevard");
  assert.equal(expandAddress("123 SW 3rd Dr"), "123 southwest 3rd drive");
  assert.equal(expandAddress("10 N Main St"), "10 north main street");
  assert.equal(expandAddress("10 S Main Rd"), "10 south main road");
  assert.equal(expandAddress("10 E Main Ln"), "10 east main lane");
  assert.equal(expandAddress("10 W Main Ct"), "10 west main court");
  assert.equal(expandAddress("8 Oak Pl"), "8 oak place");
  assert.equal(expandAddress("8 Oak Cir"), "8 oak circle");
  assert.equal(expandAddress("8 Oak Hwy"), "8 oak highway");
  assert.equal(expandAddress("8 Oak Pkwy"), "8 oak parkway");
  assert.equal(expandAddress("8 Oak Ter"), "8 oak terrace");
  assert.equal(expandAddress("10 Av"), "10 avenue");
  assert.equal(expandAddress("10 Ave"), "10 avenue");
  assert.equal(expandAddress("10 Avenue"), "10 avenue");
  assert.equal(abbreviateAddress("123 Northeast Main Street"), "123 ne main st");
  assert.equal(abbreviateAddress("10 Avenue"), "10 ave");
  assert.equal(abbreviateAddress("605 South Central Avenue"), "605 s central ave");
  assert.equal(expandAddress("123 St Joseph St"), "123 st joseph street");
  assert.equal(expandAddress("100 Central Ave, St. Petersburg"), "100 central avenue, st. petersburg");
  assert.equal(expandAddress("100 Central Ave, St Petersburg"), "100 central avenue, st petersburg");
  assert.equal(expandAddress("100 Central Ave, Port St. Lucie"), "100 central avenue, port st. lucie");
  const variants = addressQueryVariants("123 NE Main St, Lakeland");
  assert.match(variants[0], /northeast/);
  assert.match(variants[0], /street/);
  assert.ok(variants.some((variant) => /\bne\b/i.test(variant) && /\bst\b/i.test(variant)));
  assert.equal(ADDRESS_SUGGEST_MIN_CHARS, 3);
  assert.ok(ADDRESS_SUGGEST_DEBOUNCE_MS >= 300 && ADDRESS_SUGGEST_DEBOUNCE_MS <= 400);
  assert.ok(ADDRESS_SUGGEST_LIMIT >= 8 && ADDRESS_SUGGEST_LIMIT <= 10);
});

test("suggestion labels highlight expanded and abbreviated tokens", () => {
  const parts = highlightAddressLabel("123 Northeast Main Street, Lakeland, FL 33801", "123 NE Main St");
  const matched = parts.filter((part) => part.match).map((part) => part.text);
  assert.ok(matched.includes("123"));
  assert.ok(matched.includes("Northeast"));
  assert.ok(matched.includes("Main"));
  assert.ok(matched.includes("Street"));
  assert.equal(matched.includes("FL"), false);
  const avenue = highlightAddressLabel("10 Central Avenue, Bartow, FL 33830", "10 Central Av");
  assert.ok(avenue.some((part) => part.match && part.text === "Avenue"));
});

test("Polk suggestions sort ahead of other Florida cities and a typed city stays first", () => {
  const rows = [
    { city: "Miami", county: "Miami-Dade" },
    { city: "Lakeland", county: "Polk" },
    { city: "Tampa", county: "Hillsborough" },
    { city: "Bartow", county: "Polk" },
  ];
  const ranked = rankAddressSuggestions(rows, "100 Main St");
  assert.deepEqual(ranked.map((row) => row.city), ["Lakeland", "Bartow", "Miami", "Tampa"]);
  const cityFirst = rankAddressSuggestions(rows, "100 Main St, Tampa");
  assert.equal(cityFirst[0].city, "Tampa");
  assert.ok(cityFirst.some((row) => row.city === "Miami"));
  assert.ok(cityFirst.findIndex((row) => row.city === "Lakeland") < cityFirst.findIndex((row) => row.city === "Miami"));
  assert.equal(rankAddressSuggestions([{ city: "Highland City", county: "Polk" }, { city: "Orlando", county: "Orange" }], "9 Feather Dr")[0].city, "Highland City");
});

test("abbreviated input searches the expanded street and the reverse", { concurrency: false }, async () => {
  const original = globalThis.fetch;
  const queries: string[] = [];
  const lakeland = {
    address: {
      house_number: "123",
      road: "Northeast Main Street",
      city: "Lakeland",
      county: "Polk County",
      state: "Florida",
      postcode: "33801",
    },
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const q = url.searchParams.get("q") ?? "";
    queries.push(q);
    assert.equal(url.searchParams.get("viewbox"), FLORIDA_VIEWBOX);
    assert.equal(url.searchParams.get("bounded"), "1");
    const expanded = /\bnortheast\b/i.test(q) && /\bstreet\b/i.test(q);
    const body = expanded ? [lakeland] : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const plan = suggestionQueryPlan("123 NE Main St, Lakeland");
    assert.match(plan[0], /northeast/i);
    assert.match(plan[0], /street/i);
    assert.ok(plan.some((q) => /\bne\b/i.test(q) && /\bst\b/i.test(q)));
    const result = await suggestFloridaAddresses("123 NE Main St, Lakeland", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(result.status, "ok");
    assert.equal(result.suggestions[0].city, "Lakeland");
    assert.equal(result.suggestions[0].county, "Polk");
    assert.match(result.suggestions[0].street, /Northeast Main Street/);
    assert.equal(evaluateAddressSubmission(result.suggestions[0].street, result.suggestions[0].token).ok, true);
    assert.ok(queries.some((q) => /\bnortheast\b/i.test(q) && /\bstreet\b/i.test(q)));
  } finally {
    globalThis.fetch = original;
  }

  queries.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const q = url.searchParams.get("q") ?? "";
    queries.push(q);
    const abbreviated = /\bne\b/i.test(q) && /\bst\b/i.test(q) && !/northeast/i.test(q);
    const body = abbreviated ? [lakeland] : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await suggestFloridaAddresses("123 Northeast Main Street, Lakeland", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(result.suggestions[0].street, "123 Northeast Main Street");
    assert.equal(result.suggestions[0].city, "Lakeland");
    assert.ok(queries.some((q) => /\bnortheast\b/i.test(q)));
    assert.ok(queries.some((q) => /\bne\b/i.test(q) && !/northeast/i.test(q)));
  } finally {
    globalThis.fetch = original;
  }
});

test("Polk matches rank first and other Florida addresses stay in the list", { concurrency: false }, async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const hits = [
      { address: { house_number: "100", road: "Main Street", city: "Miami", county: "Miami-Dade County", state: "Florida", postcode: "33101" } },
      { address: { house_number: "100", road: "Main Street", city: "Tampa", county: "Hillsborough County", state: "Florida", postcode: "33602" } },
      { address: { house_number: "100", road: "Main Street", city: "Lakeland", county: "Polk County", state: "Florida", postcode: "33801" } },
      { address: { house_number: "200", road: "Peachtree Street", city: "Atlanta", county: "Fulton County", state: "Georgia", postcode: "30303" } },
      ...Array.from({ length: 9 }, (_, index) => ({
        address: {
          house_number: String(300 + index),
          road: "Main Street",
          city: "Orlando",
          county: "Orange County",
          state: "Florida",
          postcode: "32801",
        },
      })),
      { address: { house_number: "400", road: "Main Street", city: "Bartow", county: "Polk County", state: "Florida", postcode: "33830" } },
    ];
    return new Response(JSON.stringify(hits), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await suggestFloridaAddresses("100 Main St", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(result.suggestions.length, ADDRESS_SUGGEST_LIMIT);
    assert.equal(result.suggestions[0].city, "Lakeland");
    assert.equal(result.suggestions[1].city, "Bartow");
    assert.equal(result.suggestions[0].county, "Polk");
    assert.ok(result.suggestions.some((row) => row.city === "Miami"));
    assert.ok(result.suggestions.some((row) => row.city === "Tampa"));
    assert.equal(result.suggestions.some((row) => row.city === "Atlanta"), false);
    assert.equal(result.suggestions.at(-1)?.city === "Bartow", false);
  } finally {
    globalThis.fetch = original;
  }
});

test("three character suggest queries reach Nominatim", { concurrency: false }, async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await suggestFloridaAddresses("1st", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(calls > 0, true);
    assert.equal(result.status, "empty");
    assert.deepEqual(result.suggestions, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("address box copy explains abbreviations and the Polk boost", () => {
  const form = readFileSync("src/components/SearchForm.tsx", "utf8");
  const input = readFileSync("src/components/AddressSuggestInput.tsx", "utf8");
  assert.match(form, /123 NE Main St, Lakeland/);
  assert.match(form, /Northeast/);
  assert.match(input, /Abbreviations like NE, St, Ave work fine\. Polk County results are prioritized\./);
  assert.match(input, /ADDRESS_SUGGEST_MIN_CHARS/);
  assert.match(input, /ADDRESS_SUGGEST_DEBOUNCE_MS/);
});

test("suggest route source does not read the PermitStack key", () => {
  const route = readFileSync("src/app/api/address-suggest/route.ts", "utf8");
  const suggest = readFileSync("src/lib/address-suggest.ts", "utf8");
  assert.match(route, /NextResponse\.json/);
  assert.doesNotMatch(route + suggest, /PERMITSTACK_API_KEY/);
  assert.match(readFileSync("README.md", "utf8"), /\/api\/address-suggest/);
});
