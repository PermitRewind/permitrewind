import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/address-suggest/route";
import { GET as searchGET } from "../app/api/search/route";
import { addressStreetForms, cityPreference, hardCity, parseAddressQuery, permitAddressMatches, permitAddressQueries, selectPermitsByCity, shownPermitCity, suffixEquivalents, toPermitStackAddress } from "./address";
import { addedStreetTypeKind, isAddressSearchEnabled, mergeAddressSuggestResponse, reduceComboboxKey } from "./address-combobox";
import { abbreviateAddress, ADDRESS_SUGGEST_DEBOUNCE_MS, ADDRESS_SUGGEST_LIMIT, ADDRESS_SUGGEST_MIN_CHARS, STREET_TYPE_FALLBACK_CAP, addressQueryVariants, canonicalAddressCase, correctFuzzyCity, expandAddress, highlightAddressLabel, intendedCity, sameAddressCase, stemStreetTokens, stemTrailingS, streetNameForms, streetNamesMatch } from "./address-normalize";
import { CITY_SUGGESTIONS } from "./jurisdictions";
import { evaluateAddressSubmission, signAddressSelection } from "./address-selection";
import { FLORIDA_VIEWBOX, nominatimQueryPlan, rankAddressSuggestions, resetAddressSuggestState, suggestFloridaAddresses, suggestionFromNominatim, suggestionQueryPlan } from "./address-suggest";
import { permitLocationLines, resultsDisplayCity, resultsPlaceLabel } from "./format";
import { parseAddress } from "./providers/polk-accela";
import { mailingCityFromZippopotam } from "./zip-locality";

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

test("a compass quadrant before or after the street searches and matches with or without it", () => {
  const selected = parseAddressQuery("141 Browning Circle Southeast, Winter Haven, FL 33884");
  assert.equal(selected.number, "141");
  assert.equal(selected.streetName, "Browning");
  assert.equal(selected.suffix, "CIRCLE");
  assert.equal(selected.preDirectional, null);
  assert.equal(selected.postDirectional, "SE");
  assert.equal(selected.city, "Winter Haven");
  assert.equal(selected.zip, "33884");
  const plain = parseAddressQuery("141 Browning Cir, Winter Haven, FL 33884");
  assert.equal(toPermitStackAddress(selected).address, toPermitStackAddress(plain).address);
  assert.equal(toPermitStackAddress(selected).address, "141 Browning");
  assert.equal(toPermitStackAddress(selected).city, "Winter Haven");

  const quadrants = [
    "141 Browning Circle Southeast",
    "141 Browning Circle SE",
    "141 Browning Cir Southeast",
    "141 Browning Cir SE",
    "141 SE Browning Cir",
    "141 Southeast Browning Circle",
    "141 South East Browning Cir",
    "141 Browning SE Circle",
  ];
  const keep = [
    { address: "141 BROWNING CIR", city: "Winter Haven" },
    { address: "141 SE BROWNING CIR", city: "WINTER HAVEN" },
    { address: "141 BROWNING CIR SE", city: "Winter Haven" },
    { address: "141 SOUTHEAST BROWNING CIRCLE", city: "Winter Haven" },
  ];
  for (const q of quadrants) {
    const parsed = parseAddressQuery(q);
    assert.equal(parsed.number, "141");
    assert.equal(parsed.streetName, "Browning");
    assert.ok(parsed.suffix && suffixEquivalents(parsed.suffix).includes("CIR"));
    assert.equal(parsed.preDirectional === "SE" || parsed.postDirectional === "SE", true);
    const plan = permitAddressQueries(parsed);
    assert.equal(plan[0], toPermitStackAddress(parsed).address);
    assert.ok(plan.includes("141 Browning"));
    assert.ok(plan.includes("141 Browning Cir"));
    assert.ok(plan.includes("141 SE Browning Cir"));
    assert.ok(plan.includes("141 Southeast Browning Cir"));
    assert.equal(plan.some((line) => /circle southeast/i.test(line)), false);
    assert.equal(keep.every((row) => permitAddressMatches(parsed, row)), true);
    assert.equal(permitAddressMatches(parsed, { address: "141 NE BROWNING CIR", city: "Winter Haven" }), false);
    assert.equal(permitAddressMatches(parsed, { address: "141 BROWNING DR", city: "Winter Haven" }), false);
    assert.equal(permitAddressMatches(parsed, { address: "142 BROWNING CIR", city: "Winter Haven" }), false);
  }

  const northwest = parseAddressQuery("500 Oak Avenue Northwest");
  assert.equal(northwest.streetName, "Oak");
  assert.equal(northwest.suffix, "AVENUE");
  assert.equal(northwest.postDirectional, "NW");
  assert.equal(northwest.preDirectional, null);
  const oak = permitAddressQueries(northwest);
  assert.equal(oak[0], "500 Oak Ave");
  assert.ok(oak.includes("500 NW Oak Ave"));
  assert.ok(oak.includes("500 Northwest Oak Ave"));
  assert.equal(permitAddressMatches(northwest, { address: "500 OAK AVE" }), true);
  assert.equal(permitAddressMatches(northwest, { address: "500 NW OAK AVENUE" }), true);
  assert.equal(permitAddressMatches(northwest, { address: "500 N OAK AVE" }), false);

  const east = parseAddressQuery("10 East Main Street W");
  assert.equal(east.streetName, "Main");
  assert.equal(east.preDirectional, "E");
  assert.equal(east.postDirectional, "W");
  assert.equal(toPermitStackAddress(east).address, "10 E Main St");
  const main = permitAddressQueries(east);
  assert.ok(main.includes("10 Main St"));
  assert.ok(main.includes("10 E Main St"));
  assert.ok(main.includes("10 East Main St"));
  assert.ok(main.includes("10 W Main St"));
  assert.ok(main.includes("10 West Main St"));
  assert.equal(permitAddressMatches(east, { address: "10 MAIN ST" }), true);
  assert.equal(permitAddressMatches(east, { address: "10 E MAIN STREET" }), true);
  assert.equal(permitAddressMatches(east, { address: "10 MAIN ST W" }), true);
  assert.equal(permitAddressMatches(east, { address: "10 N MAIN ST" }), false);

  const northStreet = parseAddressQuery("100 North St");
  assert.equal(northStreet.streetName, "North");
  assert.equal(northStreet.suffix, "ST");
  assert.equal(northStreet.preDirectional, null);
  assert.equal(northStreet.postDirectional, null);
  assert.equal(toPermitStackAddress(northStreet).address, "100 N St");
  assert.equal(permitAddressQueries(northStreet).some((line) => /\bse\b/i.test(line)), false);

  const central = parseAddressQuery("605 South Central Avenue");
  assert.equal(central.streetName, "Central");
  assert.equal(central.preDirectional, "S");
  assert.equal(central.postDirectional, null);
  assert.equal(toPermitStackAddress(central).address, "605 S Central Ave");
  assert.deepEqual(permitAddressQueries(central), ["605 S Central Ave", "605 Central Ave", "605 South Central Ave"]);
  assert.equal(permitAddressMatches(parseAddressQuery("605 South Central Avenue Bartow"), { address: "605 N CENTRAL AVE", city: "BARTOW" }), false);

  const south = parseAddressQuery("605 South Central Avenue");
  assert.equal(south.city, null);
  assert.equal(south.preDirectional, "S");
  const bareOtherCity = { address: "605 CENTRAL", city: "Winter Haven", jurisdiction: "City of Winter Haven" };
  const eastOtherCity = { address: "605 E CENTRAL AVE", city: "WINTER HAVEN", jurisdiction: "City of Winter Haven" };
  const postEast = { address: "605 CENTRAL AVE E", city: "Winter Haven" };
  assert.equal(permitAddressMatches(south, bareOtherCity, "Bartow"), false);
  assert.equal(permitAddressMatches(south, eastOtherCity, "Bartow"), false);
  assert.equal(permitAddressMatches(south, postEast, "Bartow"), false);
  assert.equal(permitAddressMatches(south, { address: "605 EAST CENTRAL", city: "Winter Haven" }, "Bartow"), false);
  assert.equal(permitAddressMatches(south, { address: "605 E CENTRAL", city: "Bartow" }, "Bartow"), false);
  assert.equal(permitAddressMatches(south, { address: "605 N CENTRAL AVE", city: "Bartow" }, "Bartow"), false);
  assert.equal(permitAddressMatches(south, { address: "605 CENTRAL", city: "Bartow" }, "Bartow"), true);
  assert.equal(permitAddressMatches(south, { address: "605 S CENTRAL AVE", city: "BARTOW" }, "Bartow"), true);
  assert.equal(permitAddressMatches(south, { address: "605 CENTRAL", city: null, jurisdiction: "Polk County" }, "Bartow"), true);
  assert.equal(permitAddressMatches(south, { address: "605 SOUTH CENTRAL AVENUE", city: "WINTER HAVEN" }, "Bartow"), true);
  const onlyOtherCity = selectPermitsByCity(
    [{ city: "Winter Haven", jurisdiction: "City of Winter Haven", county: "Polk", zip: "33880" }],
    { city: "Bartow", county: "Polk", zip: "33830" },
  );
  assert.deepEqual(onlyOtherCity, []);
  const countyRow = { city: null, jurisdiction: "Polk County", county: "Polk", zip: null };
  const keptCounty = selectPermitsByCity(
    [countyRow, { city: "Winter Haven", jurisdiction: "City of Winter Haven", county: "Polk", zip: "33880" }],
    { city: "Bartow", county: "Polk", zip: "33830" },
  );
  assert.deepEqual(keptCounty, [countyRow]);
  assert.equal(shownPermitCity("Bartow", { city: null, jurisdiction: "Polk County" }), "Bartow");
  assert.equal(shownPermitCity("Bartow", { city: "CENT", jurisdiction: "Polk County" }), "Bartow");
  const shown = permitLocationLines({
    address: "605 CENTRAL",
    city: shownPermitCity("Bartow", { city: null, jurisdiction: "Polk County" }),
    state: "FL",
  });
  assert.match(shown.join("\n"), /Bartow/);
  assert.equal(shown.some((line) => /winter haven/i.test(line)), false);

  const browningStreet = parseAddressQuery("141 Browning Circle Southeast");
  assert.equal(browningStreet.city, null);
  assert.equal(permitAddressMatches(browningStreet, { address: "141 BROWNING CIR", city: "Winter Haven" }, "Winter Haven"), true);
  assert.equal(permitAddressMatches(browningStreet, { address: "141 SE BROWNING CIR", city: "WINTER HAVEN" }, "Winter Haven"), true);
  assert.equal(permitAddressMatches(browningStreet, { address: "141 BROWNING CIR SE", city: "Winter Haven" }, "Winter Haven"), true);
  assert.equal(permitAddressMatches(browningStreet, { address: "141 NE BROWNING CIR", city: "Winter Haven" }, "Winter Haven"), false);
  assert.equal(permitAddressMatches(browningStreet, { address: "141 BROWNING CIR", city: "Bartow" }, "Winter Haven"), false);

  assert.deepEqual(parseAddress("141 Browning Circle Southeast"), { number: "141", street: "BROWNING" });
  assert.deepEqual(parseAddress("141 Browning Circle SE"), { number: "141", street: "BROWNING" });
  assert.deepEqual(parseAddress("141 SE Browning Cir"), { number: "141", street: "BROWNING" });
  assert.deepEqual(parseAddress("141 Southeast Browning Circle"), { number: "141", street: "BROWNING" });
  assert.deepEqual(parseAddress("141 Browning Cir"), { number: "141", street: "BROWNING" });
  assert.deepEqual(parseAddress("3749 Feather Dr, Lakeland FL 33812"), { number: "3749", street: "FEATHER" });
  assert.deepEqual(parseAddress("1832 Buckeye Road"), { number: "1832", street: "BUCKEYE" });
  assert.deepEqual(parseAddress("605 S Central Ave"), { number: "605", street: "CENTRAL" });
  assert.deepEqual(parseAddress("19156 N Dove Creek Dr"), { number: "19156", street: "DOVE CREEK" });
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

test("compound street names match with or without a space", () => {
  assert.equal(streetNamesMatch("White Dove", "WhiteDove"), true);
  assert.equal(streetNamesMatch("WhiteDove", "WHITE DOVE DR"), true);
  assert.equal(streetNamesMatch("Oak Ridge", "Oakridge"), true);
  assert.equal(streetNamesMatch("Creek Side", "Creekside"), true);
  assert.equal(streetNamesMatch("whitedove", "White Dove"), true);
  assert.equal(streetNamesMatch("White Dove", "White Dover"), false);
  assert.equal(streetNamesMatch("Sam Allen", "Samantha"), false);
  assert.deepEqual(streetNameForms("WhiteDove").map((form) => form.toLowerCase().replace(/\s+/g, "")), ["whitedove", "whitedove"]);
  assert.ok(streetNameForms("White Dove").some((form) => form.replace(/\s+/g, "").toLowerCase() === "whitedove"));
  assert.ok(streetNameForms("OakRidge").some((form) => /oak ridge/i.test(form)));
  assert.equal(streetNameForms("Sam Allen Oaks").length, 1);
  const compact = addressStreetForms("3938 WhiteDove Dr");
  const spaced = addressStreetForms("3938 White Dove Dr");
  assert.deepEqual(compact.map((line) => line.toLowerCase().replace(/[^a-z0-9]/g, "")).sort(), spaced.map((line) => line.toLowerCase().replace(/[^a-z0-9]/g, "")).sort());
  assert.ok(compact.some((line) => /white dove/i.test(line)));
  assert.ok(spaced.some((line) => /whitedove/i.test(line)));
  const oneWord = parseAddressQuery("3938 WhiteDove Dr");
  const twoWords = parseAddressQuery("3938 White Dove Drive");
  for (const row of [
    { address: "3938 WHITEDOVE DR", city: "LAKELAND" },
    { address: "3938 WHITE DOVE DRIVE", city: "LAKELAND" },
  ]) {
    assert.equal(permitAddressMatches(oneWord, row), true);
    assert.equal(permitAddressMatches(twoWords, row), true);
  }
  assert.equal(permitAddressMatches(oneWord, { address: "3938 WHITE DOVER DR", city: "LAKELAND" }), false);
  assert.equal(permitAddressMatches(twoWords, { address: "3938 WHITE DOVER DR", city: "LAKELAND" }), false);
  const variants = addressQueryVariants("3938 WhiteDove Dr");
  assert.ok(variants.some((variant) => /white dove/i.test(variant)));
  const spacedQuery = addressQueryVariants("10 Oak Ridge Rd");
  assert.ok(spacedQuery.some((variant) => /oakridge/i.test(variant)));
  assert.equal(addressQueryVariants("123 NE Main St, Lakeland").some((variant) => /lake land/i.test(variant)), false);
  const highlighted = highlightAddressLabel("3938 White Dove Drive, Highland City, FL 33812", "3938 WhiteDove");
  assert.ok(highlighted.some((part) => part.match && part.text === "White"));
  assert.ok(highlighted.some((part) => part.match && part.text === "Dove"));
});

test("an unofficial place name does not hard-filter a different permitting city", () => {
  assert.equal(hardCity("Lakeland"), "Lakeland");
  assert.equal(hardCity("Lakland"), "Lakeland");
  assert.equal(hardCity("Highland City"), null);
  assert.equal(hardCity("Cypress Gardens"), null);
  assert.equal(cityPreference("Bartow", { city: "WINTER HAVEN", jurisdiction: "City of Winter Haven" }), 2);
  assert.equal(cityPreference("Highland City", { city: "Lakeland", jurisdiction: "City of Lakeland" }) < 2, true);
  assert.equal(cityPreference("Cypress Gardens", { city: "Winter Haven", jurisdiction: "City of Winter Haven" }) < 2, true);
  assert.equal(cityPreference("Highland City", { city: null, jurisdiction: "Polk County" }) < 2, true);
  const parsed = parseAddressQuery("3938 WhiteDove Dr, Highland City, FL 33812");
  assert.equal(parsed.number, "3938");
  assert.equal(parsed.streetName, "WhiteDove");
  assert.equal(parsed.city, "Highland City");
  assert.equal(parsed.zip, "33812");
  assert.equal(toPermitStackAddress(parsed).city, undefined);
  assert.equal(toPermitStackAddress(parseAddressQuery("3938 White Dove Dr, Lakeland, FL 33812")).city, "Lakeland");
  const rows = [
    { city: "Lakeland", jurisdiction: "City of Lakeland", zip: "33812", county: "Polk" },
    { city: "Lakeland", jurisdiction: "Polk County", zip: "33812", county: "Polk" },
    { city: "Lakeland", jurisdiction: "Lakeland", zip: null, county: "Polk" },
    { city: "Tampa", jurisdiction: "Hillsborough County", zip: "33647", county: "Hillsborough" },
  ];
  const place = { county: "Polk", zip: "33812" };
  const asHighland = selectPermitsByCity(rows, { city: "Highland City", ...place });
  const asLakeland = selectPermitsByCity(rows, { city: "Lakeland", ...place });
  const asCdp = selectPermitsByCity(
    [
      { city: "Winter Haven", jurisdiction: "City of Winter Haven", zip: "33880", county: "Polk" },
      { city: "Tampa", jurisdiction: "City of Tampa", zip: "33602", county: "Hillsborough" },
    ],
    { city: "Cypress Gardens", county: "Polk", zip: "33884" },
  );
  assert.equal(asHighland.length, 3);
  assert.equal(asLakeland.length, 3);
  assert.deepEqual(asHighland.map((row) => row.city), asLakeland.map((row) => row.city));
  assert.equal(asCdp.length, 1);
  assert.equal(asCdp[0].city, "Winter Haven");
  const bartowOnly = selectPermitsByCity(
    [
      { city: "Bartow", jurisdiction: "City of Bartow", county: "Polk" },
      { city: "Winter Haven", jurisdiction: "City of Winter Haven", county: "Polk" },
    ],
    { city: "Bartow", county: "Polk" },
  );
  assert.deepEqual(bartowOnly.map((row) => row.city), ["Bartow"]);
});

test("a ZIP with no geocoder locality is labeled with that ZIP's mailing city", { concurrency: false }, async () => {
  assert.equal(mailingCityFromZippopotam({ places: [{ "place name": "Lakeland", "state abbreviation": "FL" }] }), "Lakeland");
  assert.equal(mailingCityFromZippopotam({ places: [{ "place name": "Plant City", "state abbreviation": "FL" }] }), "Plant City");
  assert.equal(
    mailingCityFromZippopotam({
      places: [
        { "place name": "Lakeland", "state abbreviation": "FL" },
        { "place name": "Highland City", "state abbreviation": "FL" },
      ],
    }),
    "Lakeland",
  );
  assert.equal(
    mailingCityFromZippopotam({
      places: [
        { "place name": "Atlanta", "state abbreviation": "GA" },
        { "place name": "Lakeland", "state abbreviation": "FL" },
      ],
    }),
    "Lakeland",
  );
  assert.equal(mailingCityFromZippopotam({ places: [{ "place name": "Atlanta", "state abbreviation": "GA" }] }), null);
  assert.equal(mailingCityFromZippopotam(null), null);

  const whitedove = {
    lat: "28.0395",
    lon: "-81.9498",
    address: {
      house_number: "3806",
      road: "Whitedove Drive",
      county: "Polk County",
      state: "Florida",
      postcode: "33812",
    },
  };
  const highland = {
    address: {
      house_number: "3938",
      road: "Whitedove Drive",
      village: "Highland City",
      county: "Polk County",
      state: "Florida",
      postcode: "33812",
    },
  };
  const oak = {
    address: {
      house_number: "10",
      road: "Oak Street",
      county: "Hillsborough County",
      state: "Florida",
      postcode: "33563",
    },
  };
  const original = globalThis.fetch;
  let zipCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.hostname === "api.zippopotam.us") {
      zipCalls += 1;
      const zip = url.pathname.split("/").pop();
      const city = zip === "33812" ? "Lakeland" : zip === "33563" ? "Plant City" : null;
      if (!city) return new Response("no", { status: 404 });
      return new Response(JSON.stringify({ places: [{ "place name": city, "state abbreviation": "FL" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const q = url.searchParams.get("q") ?? "";
    const body = /3806/.test(q) ? [whitedove] : /3938/.test(q) ? [highland] : /oak street/i.test(q) ? [oak] : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const state = { lastAt: 0, cache: new Map() };
    for (const typed of ["3806 Whitedove Drive", "3806 White Dove Drive", "3806 WhiteDove Dr"]) {
      const result = await suggestFloridaAddresses(typed, { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
      assert.equal(result.status, "ok");
      assert.equal(result.suggestions.length, 1);
      const suggestion = result.suggestions[0];
      assert.equal(suggestion.city, "Lakeland");
      assert.equal(suggestion.zip, "33812");
      assert.equal(suggestion.county, "Polk");
      assert.equal(suggestion.label, "3806 Whitedove Drive, Lakeland, FL 33812");
      assert.equal(suggestion.label.includes(", FL 33812") && suggestion.label.includes("Lakeland"), true);
      assert.equal(suggestion.lat, 28.0395);
      assert.equal(suggestion.lng, -81.9498);
      const accepted = evaluateAddressSubmission(suggestion.street, suggestion.token);
      assert.equal(accepted.ok, true);
      if (accepted.ok) {
        assert.equal(accepted.selection.lat, 28.0395);
        assert.equal(accepted.selection.lng, -81.9498);
      }
    }
    const again = await suggestFloridaAddresses("3806 Whitedove Drive", { minIntervalMs: 0, state });
    const zipAfterFirst = zipCalls;
    await suggestFloridaAddresses("3806 Whitedove Drive", { minIntervalMs: 0, state });
    assert.equal(again.suggestions[0].city, "Lakeland");
    assert.equal(zipCalls, zipAfterFirst);

    const rows = [
      { address: "3806 WHITEDOVE DR", city: "LAKELAND" },
      { address: "3806 WHITE DOVE DRIVE", city: "LAKELAND" },
    ];
    for (const typed of ["3806 Whitedove Drive", "3806 White Dove Drive", "3806 WhiteDove Dr"]) {
      const parsed = parseAddressQuery(typed);
      assert.equal(rows.every((row) => permitAddressMatches(parsed, row)), true);
      assert.equal(permitAddressMatches(parsed, { address: "3806 WHITE DOVER DR", city: "LAKELAND" }), false);
    }

    const beforeHighland = zipCalls;
    const keptPlace = await suggestFloridaAddresses("3938 Whitedove Drive", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(keptPlace.suggestions[0].city, "Highland City");
    assert.match(keptPlace.suggestions[0].label ?? "", /Highland City/);
    assert.equal(zipCalls, beforeHighland);
    const kept = selectPermitsByCity(
      [
        { city: "Lakeland", jurisdiction: "Polk County", zip: "33812", county: "Polk" },
        { city: "Lakeland", jurisdiction: "City of Lakeland", zip: "33812", county: "Polk" },
        { city: "Tampa", jurisdiction: "Hillsborough County", zip: "33647", county: "Hillsborough" },
      ],
      { city: keptPlace.suggestions[0].city, zip: "33812", county: "Polk" },
    );
    assert.equal(kept.length, 2);
    assert.ok(kept.every((row) => row.city === "Lakeland"));

    const otherZip = await suggestFloridaAddresses("10 Oak Street", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(otherZip.suggestions[0].city, "Plant City");
    assert.equal(otherZip.suggestions[0].label, "10 Oak Street, Plant City, FL 33563");
  } finally {
    globalThis.fetch = original;
    resetAddressSuggestState();
  }

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.hostname === "api.zippopotam.us") throw new Error("zip lookup down");
    return new Response(JSON.stringify([whitedove]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await suggestFloridaAddresses("3806 Whitedove Drive", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(result.status, "ok");
    assert.equal(result.suggestions[0].street, "3806 Whitedove Drive");
    assert.equal(result.suggestions[0].city, null);
  } finally {
    globalThis.fetch = original;
    resetAddressSuggestState();
  }

  assert.equal(resultsDisplayCity("", [{ city: "LAKELAND" }, { city: "Lakeland" }]), "Lakeland");
  assert.equal(resultsDisplayCity("Bartow", [{ city: "Lakeland" }]), "Bartow");
  assert.equal(resultsDisplayCity("", [{ city: "Lakeland" }, { city: "Tampa" }]), null);
  assert.match(resultsPlaceLabel({ q: "3806 Whitedove Drive", city: "" }, [{ city: "LAKELAND" }, { city: "Lakeland" }]), /3806 Whitedove Drive, Lakeland/);
  assert.equal(resultsPlaceLabel({ q: "100 Main St", city: "" }, [{ city: "Lakeland" }, { city: "Tampa" }]), "100 Main St");
  const lines = permitLocationLines({
    address: "3806 WHITEDOVE DR",
    city: "Lakeland",
    state: "FL",
    zip: "33812",
    county: "Polk",
  });
  assert.ok(lines.some((line) => /Lakeland/.test(line)));
  const page = readFileSync("src/app/search/page.tsx", "utf8");
  assert.match(page, /resultsPlaceLabel/);
  assert.match(page, /resultsDisplayCity/);
  assert.match(page, /permitLocationLines/);
  assert.match(page, /shownPermitCity/);
});

test("address box copy explains abbreviations, near matches, and the Polk boost", () => {
  const form = readFileSync("src/components/SearchForm.tsx", "utf8");
  const input = readFileSync("src/components/AddressSuggestInput.tsx", "utf8");
  assert.match(form, /e\.g\. 123 NE Main St, Lakeland or Try “King Ave” or “Kings Avenue”/);
  assert.match(input, /Abbreviations and small differences \(NE \/ Northeast, King \/ Kings\) are handled\. Polk County results are prioritized\./);
  assert.match(input, /ADDRESS_SUGGEST_MIN_CHARS/);
  assert.match(input, /ADDRESS_SUGGEST_DEBOUNCE_MS/);
});

test("trailing s on a street name stems and a different name does not", () => {
  assert.equal(stemTrailingS("kings"), "king");
  assert.equal(stemTrailingS("Kings"), "king");
  assert.equal(stemTrailingS("aves"), "ave");
  assert.equal(stemTrailingS("oaks"), "oak");
  assert.equal(stemTrailingS("king"), "king");
  assert.equal(stemTrailingS("ave"), "ave");
  assert.equal(stemTrailingS("sts"), "sts");
  assert.equal(stemTrailingS("cross"), "cross");
  assert.equal(stemTrailingS("main"), "main");
  assert.equal(stemStreetTokens("1221 Kings avenue Lakeland"), "1221 king avenue lakeland");
  assert.equal(stemStreetTokens("1221 Kings aves Lakeland"), "1221 king ave lakeland");
  assert.equal(stemStreetTokens("123 NE Main St, Lakeland"), null);
  const variants = addressQueryVariants("1221 Kings avenue Lakeland");
  const king = variants.findIndex((variant) => /\bking\b/i.test(variant) && !/\bkings\b/i.test(variant));
  assert.ok(king > 0);
  assert.match(variants[0], /kings/i);
  assert.match(variants[king], /king/i);
  assert.match(variants[king], /avenue|ave/i);
  const plural = addressQueryVariants("1221 King Avenue Lakeland");
  assert.ok(plural.some((variant) => /\bkings\b/i.test(variant)));
  const plan = suggestionQueryPlan("1221 Kings avenue Lakeland");
  assert.match(plan[0], /kings/i);
  assert.match(plan[0], /lakeland/i);
  const stemmed = plan.findIndex((q) => /\bking\b/i.test(q) && !/\bkings\b/i.test(q) && /lakeland/i.test(q));
  assert.ok(stemmed > 0);
  assert.ok(plan.findIndex((q) => /\bkings\b/i.test(q)) < stemmed);
});

test("city typos resolve to the intended city and a different name does not", () => {
  assert.equal(intendedCity("1221 King Ave Lakland"), "Lakeland");
  assert.equal(intendedCity("1221 King Ave, Lakland, FL"), "Lakeland");
  assert.equal(correctFuzzyCity("1221 King Ave Lakland"), "1221 King Ave Lakeland");
  assert.equal(intendedCity("605 Central Ave Bartw"), "Bartow");
  assert.equal(correctFuzzyCity("605 South Central Avenue Bartw"), "605 South Central Avenue Bartow");
  assert.equal(intendedCity("605 Central Ave Barton"), null);
  assert.equal(correctFuzzyCity("100 Main St"), null);
  assert.equal(correctFuzzyCity("123 NE Main St, Lakeland"), null);
  assert.equal(intendedCity("100 Main St Miami"), "Miami");
  assert.equal(intendedCity("100 Main St"), null);
  const typed = rankAddressSuggestions(
    [
      { city: "Lakeland", county: "Polk", street: "100 Main Street" },
      { city: "Tampa", county: "Hillsborough", street: "100 Main Street" },
      { city: "Miami", county: "Miami-Dade", street: "100 Main Street" },
    ],
    "100 Main St Tampaa",
  );
  assert.equal(typed[0].city, "Tampa");
  assert.ok(typed.some((row) => row.city === "Miami"));
  const streets = rankAddressSuggestions(
    [
      { city: "Lakeland", county: "Polk", street: "1221 King Avenue" },
      { city: "Lakeland", county: "Polk", street: "1221 Kings Avenue" },
    ],
    "1221 Kings Avenue Lakeland",
  );
  assert.equal(streets[0].street, "1221 Kings Avenue");
  const parts = highlightAddressLabel("1221 King Avenue, Lakeland, FL 33803", "1221 Kings avenue Lakeland");
  const matched = parts.filter((part) => part.match).map((part) => part.text);
  assert.ok(matched.includes("1221"));
  assert.ok(matched.includes("King"));
  assert.ok(matched.includes("Avenue"));
  assert.ok(matched.includes("Lakeland"));
  assert.equal(matched.includes("FL"), false);
  const typoCity = highlightAddressLabel("1221 King Avenue, Lakeland, FL 33803", "1221 King Ave Lakland");
  assert.ok(typoCity.some((part) => part.match && part.text === "Lakeland"));
  const overridden = suggestionFromNominatim(
    { address: { house_number: "3749", road: "Feather Drive", city: "Highland City", county: "Polk County", state: "Florida", postcode: "33812" } },
    "3749 Feather Dr Lakland",
  );
  assert.equal(overridden?.city, "Lakeland");
  const bartow = suggestionFromNominatim(
    { address: { house_number: "605", road: "South Central Avenue", city: "Winter Haven", county: "Polk County", state: "Florida", postcode: "33880" } },
    "605 South Central Avenue Bartw",
  );
  assert.equal(bartow?.city, "Bartow");
});

test("Kings avenue Lakeland suggests King Avenue and ignores a different Kings road", { concurrency: false }, async () => {
  const original = globalThis.fetch;
  const queries: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const q = url.searchParams.get("q") ?? "";
    queries.push(q);
    const kings = /\bkings\b/i.test(q);
    const king = /\bking\b/i.test(q) && !kings;
    const lakeland = /lakeland/i.test(q);
    if (king && lakeland) {
      return new Response(JSON.stringify([
        { address: { house_number: "1221", road: "King Avenue", city: "Lakeland", county: "Polk County", state: "Florida", postcode: "33803" } },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (kings && !lakeland) {
      return new Response(JSON.stringify([
        { address: { house_number: "1221", road: "Kings Avenue", city: "Jacksonville", county: "Duval County", state: "Florida", postcode: "32209" } },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await suggestFloridaAddresses("1221 Kings avenue Lakeland", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(result.status, "ok");
    assert.match(result.suggestions[0].street, /King Ave/i);
    assert.doesNotMatch(result.suggestions[0].street, /Kings/i);
    assert.equal(result.suggestions[0].city, "Lakeland");
    assert.equal(result.suggestions[0].county, "Polk");
    assert.equal(result.suggestions[0].zip, "33803");
    assert.equal(evaluateAddressSubmission(result.suggestions[0].street, result.suggestions[0].token).ok, true);
    assert.equal(result.suggestions.some((row) => /Kings/i.test(row.street)), false);
    const kingAt = queries.findIndex((q) => /\bking\b/i.test(q) && !/\bkings\b/i.test(q) && /lakeland/i.test(q));
    const kingsAt = queries.findIndex((q) => /\bkings\b/i.test(q));
    assert.ok(kingsAt >= 0 && kingAt > kingsAt);
    assert.match(queries[0], /kings/i);
    assert.match(queries[0], /lakeland/i);
  } finally {
    globalThis.fetch = original;
  }
});

test("mistyped Lakeland and Bartow still surface that city", { concurrency: false }, async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const q = url.searchParams.get("q") ?? "";
    const lakeland = /lakeland/i.test(q) && /\bking\b/i.test(q);
    const bartow = /bartow/i.test(q) && /central/i.test(q);
    const hits = lakeland
      ? [{ address: { house_number: "1221", road: "King Avenue", city: "Lakeland", county: "Polk County", state: "Florida", postcode: "33803" } }]
      : bartow
        ? [
            { address: { house_number: "605", road: "South Central Avenue", city: "Winter Haven", county: "Polk County", state: "Florida", postcode: "33880" } },
            { address: { house_number: "605", road: "South Central Avenue", city: "Bartow", county: "Polk County", state: "Florida", postcode: "33830" } },
            { address: { house_number: "605", road: "South Central Avenue", city: "Tampa", county: "Hillsborough County", state: "Florida", postcode: "33602" } },
          ]
        : [];
    return new Response(JSON.stringify(hits), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const lakeland = await suggestFloridaAddresses("1221 King Avenue Lakland", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(lakeland.status, "ok");
    assert.match(lakeland.suggestions[0].street, /King Ave/i);
    assert.equal(lakeland.suggestions[0].city, "Lakeland");
    assert.equal(lakeland.suggestions[0].county, "Polk");
    const bartow = await suggestFloridaAddresses("605 Central Ave Bartw", { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
    assert.equal(bartow.suggestions[0].city, "Bartow");
    assert.match(bartow.suggestions[0].street, /Central/i);
    assert.ok(bartow.suggestions.some((row) => row.zip === "33830"));
    assert.ok(bartow.suggestions.some((row) => row.county === "Hillsborough"));
  } finally {
    globalThis.fetch = original;
  }
});

test("a house number and street name suggest suffixed roads before a street type is typed", { concurrency: false }, async () => {
  const suffixWord = /\b(drive|street|circle|road|lane|court|avenue|place|dr|st|cir|rd|ln|ct|ave|pl)\b/i;
  const whitedove = suggestionQueryPlan("3838 Whitedove");
  const unsuffixedAt = whitedove.findIndex((q) => /^3838 whitedove, florida$/i.test(q));
  const driveAt = whitedove.findIndex((q) => /^3838 whitedove drive, florida$/i.test(q));
  assert.ok(unsuffixedAt >= 0);
  assert.ok(driveAt > unsuffixedAt);
  assert.ok(whitedove.some((q) => /^3838 white dove, florida$/i.test(q)));
  assert.ok(whitedove.findIndex((q) => /^3838 white dove, florida$/i.test(q)) < driveAt);
  for (const suffix of ["drive", "street", "circle", "road", "lane", "court", "avenue", "place"]) {
    assert.ok(whitedove.some((q) => new RegExp(`^3838 whitedove ${suffix}, florida$`, "i").test(q)), suffix);
  }
  for (const suffix of ["dr", "st", "cir", "rd"]) {
    assert.ok(whitedove.some((q) => new RegExp(`^3838 whitedove ${suffix}, florida$`, "i").test(q)), suffix);
  }
  assert.ok(whitedove.some((q) => /^3838 white dove drive, florida$/i.test(q)));
  const suffixed = whitedove.filter((q) => suffixWord.test(q));
  assert.ok(suffixed.length <= STREET_TYPE_FALLBACK_CAP);
  assert.equal(suffixed.length, STREET_TYPE_FALLBACK_CAP);

  const maple = suggestionQueryPlan("410 Maple");
  for (const suffix of ["drive", "dr", "street", "st", "circle", "cir", "place", "pl"]) {
    assert.ok(maple.some((q) => new RegExp(`^410 maple ${suffix}, florida$`, "i").test(q)), suffix);
  }
  assert.ok(maple.filter((q) => suffixWord.test(q)).length <= STREET_TYPE_FALLBACK_CAP);

  for (const fragment of ["3838 W", "3838 Wh", "3838 SE"]) {
    const plan = suggestionQueryPlan(fragment);
    assert.equal(plan.some((q) => suffixWord.test(q)), false, fragment);
  }

  const withDr = suggestionQueryPlan("3838 Whitedove Dr");
  assert.ok(withDr.some((q) => /\bdrive\b/i.test(q)));
  assert.equal(withDr.some((q) => /\b(circle|lane|court|place)\b/i.test(q)), false);

  for (const partial of ["3838 Whitedove D", "3838 Whitedove Stre", "3838 Whitedove Ci"]) {
    const plan = suggestionQueryPlan(partial);
    assert.ok(plan.some((q) => /^3838 whitedove, florida$/i.test(q)), partial);
    assert.ok(plan.some((q) => /^3838 whitedove drive, florida$/i.test(q)), partial);
    assert.equal(plan.every((q) => /\b(d|stre|ci)\b/i.test(q)), false, partial);
    assert.equal(plan.some((q) => /\b(d|stre|ci)\b/i.test(q)), false, partial);
  }

  const quadrant = suggestionQueryPlan("141 SE Browning");
  assert.ok(quadrant.some((q) => /^141 southeast browning, florida$/i.test(q)));
  assert.ok(quadrant.some((q) => /^141 southeast browning circle, florida$/i.test(q)));
  const circled = suggestionQueryPlan("141 Browning Circle Southeast");
  assert.equal(circled.some((q) => /\b(drive|lane|court|place)\b/i.test(q)), false);

  const kept = {
    query: "3838 Whitedove",
    suggestions: [{ label: "3838 Whitedove Drive, Lakeland, FL 33812" }],
    status: "ok",
  };
  for (const typed of ["3838 Whitedove D", "3838 Whitedove Stre"]) {
    const merged = mergeAddressSuggestResponse(kept, { query: typed, suggestions: [], status: "empty" });
    assert.equal(merged.suggestions.length, 1, typed);
    assert.equal(merged.status, "ok");
    assert.equal(addedStreetTypeKind(kept.query, typed), "incomplete");
  }
  const throttled = mergeAddressSuggestResponse(kept, { query: "3838 Whitedove Dr", suggestions: [], status: "throttled" });
  assert.equal(throttled.suggestions.length, 1);
  assert.equal(addedStreetTypeKind(kept.query, "3838 Whitedove Dr"), "complete");
  const emptyFinished = mergeAddressSuggestResponse(kept, { query: "3838 Whitedove Street", suggestions: [], status: "empty" });
  assert.equal(emptyFinished.suggestions.length, 0);
  const other = mergeAddressSuggestResponse(kept, { query: "100 Other", suggestions: [], status: "empty" });
  assert.equal(other.suggestions.length, 0);
  const replaced = mergeAddressSuggestResponse(kept, {
    query: "3838 Whitedove Dr",
    suggestions: [{ label: "3838 Whitedove Drive, Lakeland, FL 33812" }],
    status: "ok",
  });
  assert.equal(replaced.query, "3838 Whitedove Dr");
  assert.match(readFileSync("src/components/AddressSuggestInput.tsx", "utf8"), /mergeAddressSuggestResponse/);

  const original = globalThis.fetch;
  const queries: string[] = [];
  const drive = {
    address: {
      house_number: "3838",
      road: "Whitedove Drive",
      city: "Lakeland",
      county: "Polk County",
      state: "Florida",
      postcode: "33812",
    },
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const q = url.searchParams.get("q") ?? "";
    queries.push(q);
    const hit = /\b3838\b/.test(q) && /\bwhitedove\b/i.test(q) && /\b(drive|dr)\b/i.test(q);
    return new Response(JSON.stringify(hit ? [drive] : []), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    for (const typed of ["3838 Whitedove", "3838 WhiteDove", "3838 Whitedove D", "3838 Whitedove Stre"]) {
      queries.length = 0;
      const result = await suggestFloridaAddresses(typed, { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
      assert.equal(result.status, "ok", typed);
      assert.equal(result.suggestions.length, 1, typed);
      assert.equal(result.suggestions[0].street, "3838 Whitedove Drive");
      assert.equal(result.suggestions[0].city, "Lakeland");
      assert.equal(result.suggestions[0].zip, "33812");
      assert.equal(result.suggestions[0].county, "Polk");
      assert.equal(evaluateAddressSubmission(result.suggestions[0].street, result.suggestions[0].token).ok, true);
      assert.doesNotMatch(queries[0], /\b(drive|dr|street|st)\b/i);
      assert.ok(queries.some((q) => /\bwhitedove drive\b/i.test(q)));
      assert.equal(queries.some((q) => /\blane\b/i.test(q)), false);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("the same letters in any case produce the same suggestions and the signed search still matches", { concurrency: false }, async () => {
  for (const city of CITY_SUGGESTIONS) {
    assert.equal(canonicalAddressCase(city), city, city);
    assert.equal(canonicalAddressCase(city.toUpperCase()), city, city);
    assert.equal(canonicalAddressCase(city.toLowerCase()), city, city);
  }
  assert.equal(canonicalAddressCase("SOUTHEAST"), canonicalAddressCase("southeast"));
  assert.equal(canonicalAddressCase("Southeast"), "Southeast");
  assert.equal(canonicalAddressCase("SE"), canonicalAddressCase("se"));
  assert.equal(canonicalAddressCase("Se"), "SE");
  assert.equal(canonicalAddressCase("CIR"), canonicalAddressCase("cir"));
  assert.equal(canonicalAddressCase("Cir"), "Cir");
  assert.equal(canonicalAddressCase("DR"), canonicalAddressCase("dr"));
  assert.equal(canonicalAddressCase("Dr"), "Dr");
  assert.equal(canonicalAddressCase("WhiteDove"), canonicalAddressCase("WHITEDOVE"));
  assert.equal(canonicalAddressCase("whitedove"), "Whitedove");
  assert.equal(canonicalAddressCase("123 NE 1st Ave"), canonicalAddressCase("123 ne 1ST ave"));
  assert.equal(canonicalAddressCase("123 NE 1st Ave"), "123 NE 1st Ave");
  assert.equal(sameAddressCase("141 Browning Circle Southeast", "141 BROWNING CIRCLE SOUTHEAST"), true);
  assert.equal(sameAddressCase("141 Browning Circle Southeast", "141 Browning Circle Southwest"), false);

  const foldPlan = (query: string) => suggestionQueryPlan(query).map((line) => line.toLowerCase().replace(/\s+/g, " ").trim());
  const samePlan = (queries: string[]) => {
    const [first, ...rest] = queries.map(foldPlan);
    for (const plan of rest) assert.deepEqual(plan, first);
  };
  samePlan(["141 Browning Circle Southeast", "141 BROWNING CIRCLE SOUTHEAST", "141 browning circle southeast"]);
  samePlan(["141 Browning Cir", "141 BROWNING CIR", "141 browning cir", "141 browning CIR"]);
  samePlan(["3838 Whitedove", "3838 WhiteDove", "3838 WHITEDOVE", "3838 whitedove"]);
  samePlan(["3838 Whitedove Dr", "3838 WHITEDOVE DR", "3838 whitedove drive", "3838 WhiteDove Dr"]);
  samePlan(["605 S Central Ave Bartow", "605 s CENTRAL ave bartow", "605 SOUTH CENTRAL AVENUE BARTOW"]);

  const browning = {
    address: {
      house_number: "141",
      road: "Browning Circle Southeast",
      city: "Winter Haven",
      county: "Polk County",
      state: "Florida",
      postcode: "33884",
    },
  };
  const dove = {
    address: {
      house_number: "3838",
      road: "Whitedove Drive",
      city: "Lakeland",
      county: "Polk County",
      state: "Florida",
      postcode: "33812",
    },
  };
  const central = {
    address: {
      house_number: "605",
      road: "South Central Avenue",
      city: "Bartow",
      county: "Polk County",
      state: "Florida",
      postcode: "33830",
    },
  };
  const title = {
    address: {
      house_number: "3533",
      road: "Sam Allen Oaks Circle",
      city: "Plant City",
      county: "Hillsborough County",
      state: "Florida",
      postcode: "33563",
    },
  };
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const hit = /sam allen/.test(q)
      ? title
      : /browning/.test(q)
        ? browning
        : /white ?dove/.test(q) && /\b(drive|dr)\b/.test(q)
          ? dove
          : /central/.test(q)
            ? central
            : null;
    return new Response(JSON.stringify(hit ? [hit] : []), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    async function labelsFor(queries: string[]) {
      const labels: string[][] = [];
      for (const typed of queries) {
        const result = await suggestFloridaAddresses(typed, { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
        assert.equal(result.status, "ok", typed);
        labels.push(result.suggestions.map((row) => row.label));
      }
      for (const row of labels) assert.deepEqual(row, labels[0]);
      return labels[0];
    }
    assert.deepEqual(await labelsFor([
      "3533 Sam Allen Oaks Circle, Plant City",
      "3533 SAM ALLEN OAKS CIRCLE, PLANT CITY",
      "3533 sam allen oaks circle, plant city",
    ]), ["3533 Sam Allen Oaks Circle, Plant City, FL 33563"]);
    const browningLabels = await labelsFor([
      "141 Browning Circle Southeast",
      "141 BROWNING CIRCLE SOUTHEAST",
      "141 browning circle southeast",
      "141 Browning Cir",
      "141 BROWNING CIR",
      "141 browning cir",
      "141 browning CIR",
    ]);
    assert.deepEqual(browningLabels, ["141 Browning Circle Southeast, Winter Haven, FL 33884"]);
    assert.deepEqual(await labelsFor([
      "3838 Whitedove",
      "3838 WhiteDove",
      "3838 WHITEDOVE",
      "3838 whitedove",
      "3838 Whitedove Dr",
      "3838 WHITEDOVE DR",
      "3838 whitedove dr",
      "3838 WhiteDove Drive",
    ]), ["3838 Whitedove Drive, Lakeland, FL 33812"]);
    assert.deepEqual(await labelsFor([
      "605 S Central Ave Bartow",
      "605 s CENTRAL ave bartow",
      "605 SOUTH CENTRAL AVENUE BARTOW",
    ]), ["605 South Central Avenue, Bartow, FL 33830"]);

    const capsParts = highlightAddressLabel(browningLabels[0], "141 BROWNING CIR");
    const capsMatched = capsParts.filter((part) => part.match).map((part) => part.text);
    assert.ok(capsMatched.includes("141"));
    assert.ok(capsMatched.includes("Browning"));
    assert.ok(capsMatched.includes("Circle"));
    const driveParts = highlightAddressLabel("3838 Whitedove Drive, Lakeland, FL 33812", "3838 WHITEDOVE DR");
    assert.ok(driveParts.some((part) => part.match && part.text === "Whitedove"));
    assert.ok(driveParts.some((part) => part.match && part.text === "Drive"));
    const doveParts = highlightAddressLabel("3838 Whitedove Drive, Lakeland, FL 33812", "3838 WhiteDove");
    assert.ok(doveParts.some((part) => part.match && part.text === "Whitedove"));

    const kept = {
      query: "141 Browning Cir",
      suggestions: [{ label: browningLabels[0] }],
      status: "ok",
    };
    for (const typed of ["141 BROWNING CIR", "141 browning cir", "141 browning CIR"]) {
      const merged = mergeAddressSuggestResponse(kept, { query: typed, suggestions: [], status: "throttled" });
      assert.equal(merged.suggestions.length, 1, typed);
      assert.equal(merged.status, "ok");
      assert.equal((merged.suggestions[0] as { label: string }).label, browningLabels[0]);
    }
    const emptySameLetters = mergeAddressSuggestResponse(kept, { query: "141 BROWNING CIR", suggestions: [], status: "empty" });
    assert.equal(emptySameLetters.suggestions.length, 1);
  } finally {
    globalThis.fetch = original;
  }

  globalThis.fetch = (async () => new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    const echoed = [
      "9999 Nowhere Rd Bartow",
      "9999 NOWHERE RD BARTOW",
      "9999 nowhere rd bartow",
    ];
    const fallbackLabels: string[] = [];
    for (const typed of echoed) {
      const result = await suggestFloridaAddresses(typed, { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
      assert.equal(result.status, "ok", typed);
      fallbackLabels.push(result.suggestions[0].label);
      assert.equal(result.suggestions[0].city, "Bartow");
    }
    assert.deepEqual(fallbackLabels, ["9999 Nowhere Rd, Bartow, FL", "9999 Nowhere Rd, Bartow, FL", "9999 Nowhere Rd, Bartow, FL"]);
    const places = [
      "10 Oak Street, Highland City, FL 33812",
      "10 OAK STREET, HIGHLAND CITY, FL 33812",
      "10 oak street, highland city, fl 33812",
    ];
    const placeLabels: string[] = [];
    for (const typed of places) {
      const result = await suggestFloridaAddresses(typed, { minIntervalMs: 0, state: { lastAt: 0, cache: new Map() } });
      placeLabels.push(result.suggestions[0].label);
      assert.equal(result.suggestions[0].city, "Highland City");
    }
    assert.equal(new Set(placeLabels).size, 1);
    assert.equal(placeLabels[0], "10 Oak Street, Highland City, FL 33812");
  } finally {
    globalThis.fetch = original;
  }

  const picked = {
    label: "141 Browning Circle Southeast, Winter Haven, FL 33884",
    street: "141 Browning Circle Southeast",
    city: "Winter Haven" as const,
    state: "FL" as const,
    zip: "33884",
  };
  process.env.ADDRESS_SELECTION_SECRET = "test-selection-secret";
  const token = signAddressSelection(picked);
  for (const typed of [picked.street, picked.street.toUpperCase(), picked.street.toLowerCase(), "141 Browning CIRCLE Southeast"]) {
    assert.equal(evaluateAddressSubmission(typed, token).ok, true, typed);
    assert.equal(isAddressSearchEnabled({ mode: "address", text: typed, selected: { label: picked.street, token } }), true, typed);
    assert.equal(permitAddressMatches(parseAddressQuery(typed), { address: "141 BROWNING CIR SE", city: "WINTER HAVEN" }, "Winter Haven"), true, typed);
  }
  assert.equal(evaluateAddressSubmission(picked.label, token).ok, false);
  assert.equal(evaluateAddressSubmission("142 Browning Circle Southeast", token).ok, false);
  assert.equal(evaluateAddressSubmission(picked.street, null).ok, false);
  assert.equal(isAddressSearchEnabled({ mode: "address", text: `${picked.street} x`, selected: { label: picked.street, token } }), false);
  assert.equal(isAddressSearchEnabled({ mode: "address", text: picked.street.toUpperCase(), selected: { label: picked.street, token: "" } }), false);

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ results: [], total: 0, page: 1, per_page: 100 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    process.env.PERMITSTACK_API_KEY = "test-key";
    const accepted = await searchGET(new NextRequest(`http://localhost/api/search?mode=address&q=${encodeURIComponent(picked.street.toUpperCase())}&sel=${encodeURIComponent(token)}`));
    assert.equal(accepted.status, 200);
    assert.ok(calls > 0);
    const blocked = await searchGET(new NextRequest(`http://localhost/api/search?mode=address&q=${encodeURIComponent(picked.street.toUpperCase())}`));
    assert.equal(blocked.status, 422);
  } finally {
    globalThis.fetch = original;
  }
});

test("suggest route source does not read the PermitStack key", () => {
  const route = readFileSync("src/app/api/address-suggest/route.ts", "utf8");
  const suggest = readFileSync("src/lib/address-suggest.ts", "utf8");
  assert.match(route, /NextResponse\.json/);
  assert.doesNotMatch(route + suggest, /PERMITSTACK_API_KEY/);
  assert.match(readFileSync("README.md", "utf8"), /\/api\/address-suggest/);
});
