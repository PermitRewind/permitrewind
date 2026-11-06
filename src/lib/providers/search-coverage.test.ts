import assert from "node:assert/strict";
import test from "node:test";
import { shownPermitCity } from "../address";
import { permitLocationLines, resultsPlaceLabel, sourceAttribution } from "../format";
import { shouldMergePolkSources } from "../jurisdictions";
import type { PermitProvider } from "./types";
import { CompositeProvider } from "./composite";
import { PermitStackProvider } from "./permitstack";
import { Permit, ProviderError, SearchQuery, SearchResult } from "../types";

function permit(partial: Partial<Permit> & Pick<Permit, "id">): Permit {
  return {
    permitNumber: null,
    status: "final",
    category: "ROOFING",
    tags: [],
    description: null,
    address: null,
    city: null,
    state: "FL",
    zip: null,
    parcelId: null,
    jurisdiction: null,
    dateFiled: null,
    dateIssued: "2020-01-01",
    dateCompleted: null,
    estimatedValue: null,
    contractorName: null,
    ownerName: null,
    propertyType: null,
    latitude: null,
    longitude: null,
    ...partial,
  };
}

function stackRow(partial: Record<string, unknown>) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    permit_number: "HC-1",
    status: "final",
    category: "ROOFING",
    tags: [],
    description_raw: "Reroof",
    address_street: "19156 DOVE CREEK DR",
    address_city: "TAMPA",
    address_state: "FL",
    address_zip: "33647",
    jurisdiction_name: "Hillsborough County",
    date_issued: "2023-04-12",
    record_kind: "permit",
    ...partial,
  };
}

const TAMPA_ROWS = [
  stackRow({ id: "11111111-1111-4111-8111-111111111111", permit_number: "HC-ROOF-1", category: "ROOFING" }),
  stackRow({ id: "22222222-2222-4222-8222-222222222222", permit_number: "HC-POOL-2", category: "POOL", description_raw: "Pool" }),
  stackRow({ id: "33333333-3333-4333-8333-333333333333", permit_number: "HC-ELEC-3", category: "ELECTRICAL", description_raw: "Electrical" }),
];

function mockFetch(handler: (url: URL, init?: RequestInit) => { status?: number; body: unknown }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const result = handler(new URL(href), init);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function emptyResult(): SearchResult {
  return { permits: [], total: 0, page: 1, perPage: 0, notices: [] };
}

test("19156 Dove Creek Dr keeps three Tampa permits", async () => {
  let seen: URL | undefined;
  const restore = mockFetch((url, init) => {
    seen = url;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-API-Key"), "test-key");
    return { body: { results: TAMPA_ROWS, total: 3, page: 1, per_page: 100 } };
  });
  try {
    const result = await new PermitStackProvider("test-key").search({ mode: "address", q: "19156 Dove Creek Dr" });
    assert.equal(result.permits.length, 3);
    assert.deepEqual(result.permits.map((p) => p.permitNumber).sort(), ["HC-ELEC-3", "HC-POOL-2", "HC-ROOF-1"]);
    assert.ok(result.permits.every((p) => p.city === "TAMPA" && p.state === "FL" && p.jurisdiction === "Hillsborough County"));
    assert.ok(result.permits.every((p) => sourceAttribution(p) === "PermitStack · statewide Florida"));
    assert.equal(result.notices.some((n) => /hidden/i.test(n)), false);
    assert.equal(seen?.searchParams.get("state"), "FL");
    assert.equal(seen?.searchParams.get("address")?.toLowerCase().replace(/[^a-z0-9]/g, ""), "19156dovecreekdr");
    assert.equal(seen?.searchParams.get("city"), null);
    assert.equal(seen?.searchParams.get("jurisdiction"), null);
    assert.equal(seen?.pathname, "/v1/permits/search");
  } finally {
    restore();
  }
});

test("605 South Central Avenue Bartow excludes a Winter Haven permit and lists Bartow first", async () => {
  const rows = [
    stackRow({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", permit_number: "WH-1", address_street: "605 SOUTH CENTRAL AVENUE", address_city: "WINTER HAVEN", address_zip: "33880", jurisdiction_name: "City of Winter Haven", date_issued: "2024-01-01" }),
    stackRow({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", permit_number: "BT-1", address_street: "605 S CENTRAL AVE", address_city: "BARTOW", address_zip: "33830", jurisdiction_name: "City of Bartow", date_issued: "2011-01-01" }),
  ];
  const seen: URL[] = [];
  const restore = mockFetch((url) => {
    seen.push(url);
    const address = url.searchParams.get("address") ?? "";
    const zip = url.searchParams.get("zip_code");
    // Spelled-out street plus ZIP matches nothing. Abbreviated street matches both cities.
    if (zip || /south central avenue/i.test(address)) return { body: { results: [], total: 0, page: 1, per_page: 100 } };
    return { body: { results: rows, total: rows.length, page: 1, per_page: 100 } };
  });
  try {
    const strict = await new PermitStackProvider("test-key").search({
      mode: "address", q: "605 South Central Avenue", city: "Bartow", state: "FL", zip: "33830", county: "Polk",
    });
    assert.equal(seen[0]?.searchParams.get("address"), "605 S Central Ave");
    assert.equal(seen[0]?.searchParams.get("city"), "Bartow");
    assert.equal(seen[0]?.searchParams.get("state"), "FL");
    assert.equal(seen[0]?.searchParams.get("zip_code"), null);
    assert.equal(seen[0]?.searchParams.get("county"), null);
    assert.deepEqual(strict.permits.map((p) => p.permitNumber), ["BT-1"]);
    const broad = await new PermitStackProvider("test-key").search({ mode: "address", q: "605 South Central Avenue", city: "Bartow", broaden: true });
    assert.deepEqual(broad.permits.map((p) => p.permitNumber), ["BT-1", "WH-1"]);
  } finally {
    restore();
  }
});

test("selected Bartow search falls back when the abbreviated city query misses", async () => {
  const bartow = stackRow({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", permit_number: "BT-1", address_street: "605 SOUTH CENTRAL AVENUE", address_city: null, jurisdiction_name: "City of Bartow", date_issued: "2011-01-01" });
  const winter = stackRow({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", permit_number: "WH-1", address_street: "605 SOUTH CENTRAL AVENUE", address_city: "WINTER HAVEN", jurisdiction_name: "City of Winter Haven", date_issued: "2024-06-01" });
  const seen: URL[] = [];
  const restore = mockFetch((url) => {
    seen.push(url);
    const address = url.searchParams.get("address") ?? "";
    if (address === "Central") return { body: { results: [winter, bartow], total: 2, page: 1, per_page: 100 } };
    return { body: { results: [], total: 0, page: 1, per_page: 100 } };
  });
  try {
    const result = await new PermitStackProvider("test-key").search({
      mode: "address", q: "605 South Central Avenue", city: "Bartow", state: "FL", zip: "33830",
    });
    assert.deepEqual(seen.map((url) => url.searchParams.get("address")), ["605 S Central Ave", "605 Central Ave", "605 South Central Ave", "Central"]);
    assert.deepEqual(result.permits.map((p) => p.permitNumber), ["BT-1"]);
  } finally {
    restore();
  }
});

test("605 South Central Avenue Bartow does not return a bare or east Central row from another city", async () => {
  const winterBare = stackRow({
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    permit_number: "2019-00116512",
    address_street: "605 CENTRAL",
    address_city: "WINTER HAVEN",
    address_zip: "33880",
    jurisdiction_name: "City of Winter Haven",
    description_raw: "SHED",
    category: "COM ADDN",
    date_issued: "2019-08-12",
  });
  const winterEast = stackRow({
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    permit_number: "WH-EAST",
    address_street: "605 E CENTRAL AVE",
    address_city: "WINTER HAVEN",
    address_zip: "33880",
    jurisdiction_name: "City of Winter Haven",
    date_issued: "2019-08-12",
  });
  const bartowBare = stackRow({
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    permit_number: "BT-BARE",
    address_street: "605 CENTRAL",
    address_city: "BARTOW",
    address_zip: "33830",
    jurisdiction_name: "City of Bartow",
    date_issued: "2018-01-01",
  });
  const restore = mockFetch((url) => {
    const address = url.searchParams.get("address") ?? "";
    if (address === "605 S Central Ave" || address === "605 South Central Ave") {
      return { body: { results: [], total: 0, page: 1, per_page: 100 } };
    }
    return { body: { results: [winterBare, winterEast, bartowBare], total: 3, page: 1, per_page: 100 } };
  });
  try {
    const result = await new PermitStackProvider("test-key").search({
      mode: "address",
      q: "605 South Central Avenue",
      city: "Bartow",
      state: "FL",
      zip: "33830",
      county: "Polk",
    });
    assert.deepEqual(result.permits.map((permit) => permit.permitNumber), ["BT-BARE"]);
    const lines = result.permits.flatMap((permit) => permitLocationLines({ ...permit, city: shownPermitCity("Bartow", permit) }));
    assert.match(lines.join("\n"), /Bartow/i);
    assert.equal(lines.some((line) => /winter haven/i.test(line)), false);
  } finally {
    restore();
  }
});

test("a Bartow selection does not merge another city's bare Central row from a county source", async () => {
  const winter = permit({
    id: "polk-pa:other:2019-00116512",
    permitNumber: "2019-00116512",
    address: "605 CENTRAL",
    city: "Winter Haven",
    jurisdiction: "Winter Haven",
    description: "SHED",
    category: "COM ADDN",
    source: "Polk County Property Appraiser",
    dateIssued: "2019-08-12",
  });
  const east = permit({
    id: "polk-pa:other:WH-EAST",
    permitNumber: "WH-EAST",
    address: "605 E CENTRAL AVE",
    city: "Winter Haven",
    jurisdiction: "City of Winter Haven",
    source: "Polk County Property Appraiser",
    dateIssued: "2019-08-12",
  });
  const county = permit({
    id: "polk-pa:county:COUNTY-1",
    permitNumber: "COUNTY-1",
    address: "605 CENTRAL",
    city: null,
    jurisdiction: "Polk County",
    county: "Polk",
    source: "Polk County Property Appraiser",
    dateIssued: "2014-04-01",
  });
  const extra = (permits: Permit[]): PermitProvider => ({
    name: "Polk County Property Appraiser",
    appliesTo: shouldMergePolkSources,
    async search() {
      return { permits, total: permits.length, page: 1, perPage: permits.length, notices: [] };
    },
    async getPermit() {
      return null;
    },
  });
  const search = (rows: Permit[]) => new CompositeProvider(
    {
      name: "PermitStack",
      async search() {
        return emptyResult();
      },
      async getPermit() {
        return null;
      },
    },
    [extra(rows)],
  ).search({ mode: "address", q: "605 South Central Avenue", city: "Bartow", state: "FL", zip: "33830", county: "Polk" });
  const dropped = await search([winter, east]);
  assert.deepEqual(dropped.permits, []);
  const kept = await search([winter, east, county]);
  assert.deepEqual(kept.permits.map((row) => row.permitNumber), ["COUNTY-1"]);
  const lines = permitLocationLines({ ...kept.permits[0], city: shownPermitCity("Bartow", kept.permits[0]) });
  assert.match(lines.join("\n"), /Bartow/);
  assert.equal(lines.some((line) => /winter haven/i.test(line)), false);
});

test("141 Browning Circle Southeast searches the street without the quadrant and with it in front", async () => {
  const seen: string[] = [];
  const browning = (partial: Record<string, unknown>) => stackRow({
    address_city: "WINTER HAVEN",
    address_zip: "33884",
    jurisdiction_name: "City of Winter Haven",
    ...partial,
  });
  const restore = mockFetch((url) => {
    const address = url.searchParams.get("address") ?? "";
    seen.push(address);
    assert.equal(url.searchParams.get("city"), "Winter Haven");
    assert.equal(url.searchParams.get("zip_code"), null);
    assert.equal(url.searchParams.get("state"), "FL");
    if (address === "141 Browning" || address === "141 Browning Cir") {
      return {
        body: {
          results: [
            browning({ id: "aaaaaaa1-1111-4111-8111-111111111111", permit_number: "BT-2024-4680", address_street: "141 BROWNING CIR", description_raw: "HVAC CHANGEOUT", date_issued: "2024-03-21" }),
            browning({ id: "aaaaaaa2-2222-4222-8222-222222222222", permit_number: "BT-2022-1905", address_street: "141 BROWNING CIR", description_raw: "Reroof: Shingle", date_issued: "2022-02-04" }),
            browning({ id: "aaaaaaa3-3333-4333-8333-333333333333", permit_number: "NE-OTHER", address_street: "141 NE BROWNING CIR", date_issued: "2019-01-01" }),
            browning({ id: "aaaaaaa4-4444-4444-8444-444444444444", permit_number: "BT-OTHER-CITY", address_street: "141 BROWNING CIR", address_city: "BARTOW", jurisdiction_name: "City of Bartow", date_issued: "2018-01-01" }),
          ],
          total: 4,
          page: 1,
          per_page: 100,
        },
      };
    }
    if (/^141 (SE|Southeast) Browning( Cir)?$/.test(address)) {
      return {
        body: {
          results: [
            browning({ id: "aaaaaaa5-5555-4555-8555-555555555555", permit_number: "BLD-H-148765", address_street: "141 SE BROWNING CIR", description_raw: "replace 15 windows", date_issued: "2011-09-19" }),
          ],
          total: 1,
          page: 1,
          per_page: 100,
        },
      };
    }
    return { body: { results: [], total: 0, page: 1, per_page: 100 } };
  });
  try {
    const result = await new PermitStackProvider("test-key").search({
      mode: "address",
      q: "141 Browning Circle Southeast",
      city: "Winter Haven",
      state: "FL",
      zip: "33884",
      county: "Polk",
    });
    assert.deepEqual(result.permits.map((permit) => permit.permitNumber).sort(), ["BLD-H-148765", "BT-2022-1905", "BT-2024-4680"]);
    assert.equal(seen[0], "141 Browning");
    assert.ok(seen.includes("141 Browning Cir"));
    assert.ok(seen.includes("141 SE Browning Cir"));
    assert.ok(seen.includes("141 Southeast Browning Cir"));
    assert.equal(seen.includes("141 Browning Circle Southeast"), false);
    assert.equal(result.permits.some((permit) => permit.permitNumber === "NE-OTHER"), false);
    assert.equal(result.permits.some((permit) => permit.permitNumber === "BT-OTHER-CITY"), false);
  } finally {
    restore();
  }
});

test("Dove Creek search keeps all three Tampa permits, including a directional roofing row", async () => {
  let seen: URL | undefined;
  const rows = [
    stackRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", permit_number: "BTR-13-0403822", address_street: "19156 DOVE CREEK DR", address_city: "TAMPA", category: "ELECTRICAL", jurisdiction_name: "Hillsborough County", date_issued: "2013-06-01" }),
    stackRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", permit_number: "BTR-10-0348682", address_street: "19156 DOVE CREEK DR", address_city: "TAMPA", category: "PLUMBING", jurisdiction_name: "City of Tampa", date_issued: "2010-04-01" }),
    stackRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", permit_number: "BTR-23-0567345", address_street: "19156 N DOVE CREEK DR", address_city: "TAMPA", category: "ROOFING", jurisdiction_name: "Hillsborough County", date_issued: "2023-04-10" }),
    stackRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4", permit_number: "BTR-CT", address_street: "19156 DOVE CREEK CT", address_city: "TAMPA", category: "OTHER", jurisdiction_name: "City of Tampa" }),
  ];
  const restore = mockFetch((url) => {
    seen = url;
    return { body: { results: rows, total: rows.length, page: 1, per_page: 100 } };
  });
  try {
    const result = await new PermitStackProvider("test-key").search({ mode: "address", q: "19156 Dove Creek Dr" });
    assert.equal(seen?.searchParams.get("address")?.toLowerCase().replace(/[^a-z0-9]/g, ""), "19156dovecreekdr");
    assert.equal(seen?.searchParams.get("city"), null);
    assert.deepEqual(
      result.permits.map((p) => p.permitNumber).sort(),
      ["BTR-10-0348682", "BTR-13-0403822", "BTR-23-0567345"],
    );
    assert.equal(result.permits.find((p) => p.permitNumber === "BTR-23-0567345")?.category, "ROOFING");
  } finally {
    restore();
  }
});

test("out-of-state rows are hidden and an explicit Polk region still allowlists", async () => {
  const restore = mockFetch(() => ({
    body: {
      results: [
        ...TAMPA_ROWS,
        stackRow({
          id: "44444444-4444-4444-8444-444444444444",
          permit_number: "GA-1",
          address_city: "ATLANTA",
          address_state: "GA",
          jurisdiction_name: "Fulton County",
        }),
      ],
      total: 4,
    },
  }));
  try {
    const provider = new PermitStackProvider("test-key");
    const statewide = await provider.search({ mode: "address", q: "19156 Dove Creek Dr" });
    assert.equal(statewide.permits.length, 3);
    assert.match(statewide.notices.join(" "), /outside Florida/);
    const polkOnly = await provider.search({ mode: "address", q: "19156 Dove Creek Dr", regionId: "polk-fl" });
    assert.equal(polkOnly.permits.length, 0);
    assert.match(polkOnly.notices.join(" "), /outside Polk County, FL/);
  } finally {
    restore();
  }
});

test("PermitStack detail route loads a non-Polk record and ignores county ids", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let path = "";
  let calls = 0;
  const restore = mockFetch((url) => {
    calls += 1;
    path = url.pathname;
    return { body: TAMPA_ROWS[0] };
  });
  try {
    const provider = new PermitStackProvider("test-key");
    const permit = await provider.getPermit(id);
    assert.equal(path, `/v1/permits/${id}`);
    assert.equal(permit?.city, "TAMPA");
    assert.equal(permit?.jurisdiction, "Hillsborough County");
    assert.equal(permit?.source, "PermitStack");
    assert.equal(await provider.getPermit("polk-accela:BLD-100"), null);
    assert.equal(await provider.getPermit("not-a-permitstack-id"), null);
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("3749 Feather Dr, Lakeland, FL merges Polk county records with PermitStack", async () => {
  const stack = permit({
    id: "55555555-5555-4555-8555-555555555555",
    permitNumber: "BLD-100",
    address: "3749 FEATHER DR",
    city: "Lakeland",
    jurisdiction: "City of Lakeland",
    source: "PermitStack",
    dateIssued: "2020-01-01",
  });
  const accelaSame = permit({
    id: "polk-accela:BLD-100",
    permitNumber: "BLD-100",
    address: "3749 FEATHER DR",
    city: "Lakeland",
    jurisdiction: "Polk County",
    source: "Polk County Accela",
    sourceUrl: "https://aca-prod.accela.com/POLKCO/detail",
    dateCompleted: "2020-06-01",
  });
  const accelaOnly = permit({
    id: "polk-accela:BLD-200",
    permitNumber: "BLD-200",
    address: "3749 FEATHER DR",
    city: "Lakeland",
    jurisdiction: "Polk County",
    source: "Polk County Accela",
    dateIssued: "2019-05-01",
  });
  const appraiser = permit({
    id: "polk-pa:123:OLD-1",
    permitNumber: "OLD-1",
    address: "3749 FEATHER DR",
    city: "Lakeland",
    jurisdiction: "Lakeland",
    source: "Polk County Property Appraiser",
    dateIssued: "1998-03-01",
  });
  const query: SearchQuery = { mode: "address", q: "3749 Feather Dr, Lakeland, FL" };
  const extra = (name: string, permits: Permit[]): PermitProvider => ({
    name,
    appliesTo: shouldMergePolkSources,
    async search() {
      return { permits, total: permits.length, page: 1, perPage: permits.length, notices: [] };
    },
    async getPermit() {
      return null;
    },
  });
  const result = await new CompositeProvider(
    {
      name: "PermitStack",
      async search() {
        return { permits: [stack], total: 1, page: 1, perPage: 1, notices: [] };
      },
      async getPermit() {
        return null;
      },
    },
    [extra("Polk County Accela", [accelaSame, accelaOnly]), extra("Polk County Property Appraiser", [appraiser])],
  ).search(query);

  const numbers = result.permits.map((p) => p.permitNumber).sort();
  assert.deepEqual(numbers, ["BLD-100", "BLD-200", "OLD-1"]);
  const merged = result.permits.find((p) => p.permitNumber === "BLD-100");
  assert.equal(merged?.dateCompleted, "2020-06-01");
  assert.equal(merged?.finalFrom, "Polk County Accela");
  assert.match(sourceAttribution(merged ?? {}), /PermitStack · statewide Florida/);
  assert.match(sourceAttribution(merged ?? {}), /Polk County Accela · Polk County only/);
  assert.match(sourceAttribution(result.permits.find((p) => p.permitNumber === "OLD-1") ?? {}), /Polk County only/);
});

test("a bare Dove Creek search still returns Tampa rows when Polk sources run", async () => {
  let polkCalls = 0;
  const tampa = TAMPA_ROWS.map((row) => permit({
    id: String(row.id),
    permitNumber: String(row.permit_number),
    address: "19156 DOVE CREEK DR",
    city: "TAMPA",
    jurisdiction: "Hillsborough County",
    source: "PermitStack",
  }));
  const result = await new CompositeProvider(
    {
      name: "PermitStack",
      async search() {
        return { permits: tampa, total: tampa.length, page: 1, perPage: tampa.length, notices: [] };
      },
      async getPermit() {
        return null;
      },
    },
    [{
      name: "Polk County Accela",
      appliesTo: shouldMergePolkSources,
      async search() {
        polkCalls += 1;
        return emptyResult();
      },
      async getPermit() {
        return null;
      },
    }],
  ).search({ mode: "address", q: "19156 Dove Creek Dr" });
  assert.equal(polkCalls, 1);
  assert.equal(result.permits.length, 3);
  assert.deepEqual(result.permits.map((p) => p.permitNumber).sort(), ["HC-ELEC-3", "HC-POOL-2", "HC-ROOF-1"]);
});

test("Tampa city filter does not call Polk sources", async () => {
  const tampa = permit({
    id: "11111111-1111-4111-8111-111111111111",
    permitNumber: "HC-ROOF-1",
    city: "TAMPA",
    jurisdiction: "Hillsborough County",
    source: "PermitStack",
  });
  const result = await new CompositeProvider(
    {
      name: "PermitStack",
      async search(query) {
        assert.equal(query.city, "Tampa");
        return { permits: [tampa], total: 1, page: 1, perPage: 1, notices: [] };
      },
      async getPermit() {
        return null;
      },
    },
    [{
      name: "Polk County Accela",
      appliesTo: shouldMergePolkSources,
      async search() {
        throw new Error("Polk source should not run for Tampa");
      },
      async getPermit() {
        return null;
      },
    }],
  ).search({ mode: "address", q: "19156 Dove Creek Dr", city: "Tampa" });
  assert.equal(result.permits.length, 1);
  assert.equal(result.permits[0].city, "TAMPA");
});

test("Tampa search still surfaces a PermitStack failure when Polk sources are skipped", async () => {
  await assert.rejects(
    () => new CompositeProvider(
      {
        name: "PermitStack",
        async search() {
          throw new ProviderError("down", 503);
        },
        async getPermit() {
          return null;
        },
      },
      [{
        name: "Polk County Accela",
        appliesTo: () => false,
        async search() {
          return emptyResult();
        },
        async getPermit() {
          return null;
        },
      }],
    ).search({ mode: "address", q: "19156 Dove Creek Dr", city: "Tampa" }),
    /down/,
  );
});

test("3533 Sam Allen Oaks Cir Plant City keeps Cir, Circle, and CR including SFR40294", async () => {
  let seen: URL | undefined;
  const rows = [
    stackRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", permit_number: "PC-1", address_street: "3533 SAM ALLEN OAKS CIR", address_city: "PLANT CITY", jurisdiction_name: "Plant City" }),
    stackRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", permit_number: "PC-2", address_street: "3533 SAM ALLEN OAKS CIRCLE", address_city: "PLANT CITY", jurisdiction_name: "Plant City" }),
    stackRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", permit_number: "PC-3", address_street: "3533 SAM ALLEN OAKS CIR", address_city: "PLANT CITY", jurisdiction_name: "Hillsborough County" }),
    stackRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", permit_number: "SFR40294", address_street: "3533 SAM ALLEN OAKS CR", address_city: "PLANT CITY", jurisdiction_name: "Hillsborough County" }),
    stackRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", permit_number: "PC-BLVD", address_street: "3533 SAM ALLEN OAKS BLVD", address_city: "PLANT CITY", jurisdiction_name: "Plant City" }),
  ];
  const restore = mockFetch((url) => {
    seen = url;
    return { body: { results: rows, total: rows.length, page: 1, per_page: 100 } };
  });
  try {
    for (const q of ["3533 Sam Allen Oaks Cir Plant City", "3533 Sam Allen Oaks Circle, Plant City, FL", "3533 Sam Allen Oaks CR Plant City"]) {
      const result = await new PermitStackProvider("test-key").search({ mode: "address", q });
      assert.deepEqual(result.permits.map((p) => p.permitNumber).sort(), ["PC-1", "PC-2", "PC-3", "SFR40294"]);
      assert.equal(seen?.searchParams.get("address"), "3533 Sam Allen Oaks");
      assert.equal(seen?.searchParams.get("city"), "Plant City");
      assert.equal(seen?.searchParams.get("state"), "FL");
      assert.equal(seen?.searchParams.get("zip_code"), null);
    }
    const selected = await new PermitStackProvider("test-key").search({
      mode: "address", q: "3533 Sam Allen Oaks Circle", city: "Plant City", state: "FL", zip: "33565", county: "Hillsborough",
    });
    assert.deepEqual(selected.permits.map((p) => p.permitNumber).sort(), ["PC-1", "PC-2", "PC-3", "SFR40294"]);
    assert.equal(seen?.searchParams.get("address"), "3533 Sam Allen Oaks");
    assert.equal(seen?.searchParams.get("city"), "Plant City");
    assert.equal(seen?.searchParams.get("zip_code"), null);
    assert.equal(seen?.searchParams.get("county"), null);
    await new PermitStackProvider("test-key").search({ mode: "permit", q: "SFR40294" });
    assert.equal(seen?.searchParams.get("permit_number"), "SFR40294");
    assert.equal(seen?.searchParams.get("address"), null);
  } finally {
    restore();
  }
});

test("3938 WhiteDove Dr returns the same three permits for Highland City and Lakeland, either spelling", async () => {
  const lakelandRows = [
    stackRow({ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", permit_number: "WD-1", address_street: "3938 WHITE DOVE DR", address_city: "LAKELAND", address_zip: "33812", jurisdiction_name: "City of Lakeland", date_issued: "2022-03-01" }),
    stackRow({ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2", permit_number: "WD-2", address_street: "3938 WHITEDOVE DR", address_city: "LAKELAND", address_zip: "33812", jurisdiction_name: "Polk County", date_issued: "2018-06-01" }),
    stackRow({ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3", permit_number: "WD-3", address_street: "3938 WHITE DOVE DRIVE", address_city: "LAKELAND", address_zip: "33812", jurisdiction_name: "City of Lakeland", date_issued: "2011-01-01" }),
  ];
  const tampa = stackRow({ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4", permit_number: "WD-T", address_street: "3938 WHITE DOVE DR", address_city: "TAMPA", address_zip: "33647", jurisdiction_name: "Hillsborough County", date_issued: "2024-01-01" });
  const seen: URL[] = [];
  const restore = mockFetch((url) => {
    seen.push(url);
    const city = url.searchParams.get("city");
    const address = (url.searchParams.get("address") ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (city === "Highland City") return { body: { results: [], total: 0, page: 1, per_page: 100 } };
    if (!address.includes("3938whitedove")) return { body: { results: [], total: 0, page: 1, per_page: 100 } };
    const results = city ? lakelandRows : [...lakelandRows, tampa];
    return { body: { results, total: results.length, page: 1, per_page: 100 } };
  });
  try {
    const provider = new PermitStackProvider("test-key");
    const place = { state: "FL", zip: "33812", county: "Polk" };
    const numbers = async (q: string, city: string) => {
      const result = await provider.search({ mode: "address", q, city, ...place });
      return result.permits.map((permit) => permit.permitNumber).sort();
    };
    const lakeland = await numbers("3938 WhiteDove Dr", "Lakeland");
    const highland = await numbers("3938 WhiteDove Dr", "Highland City");
    const spacedLakeland = await numbers("3938 White Dove Dr", "Lakeland");
    const spacedHighland = await numbers("3938 White Dove Drive", "Highland City");
    assert.deepEqual(lakeland, ["WD-1", "WD-2", "WD-3"]);
    assert.deepEqual(highland, lakeland);
    assert.deepEqual(spacedLakeland, lakeland);
    assert.deepEqual(spacedHighland, lakeland);
    assert.equal(seen.some((url) => url.searchParams.get("city") === "Highland City"), false);
    assert.ok(seen.some((url) => url.searchParams.get("city") === "Lakeland"));
    assert.ok(seen.some((url) => /white dove/i.test(url.searchParams.get("address") ?? "")));
    assert.ok(seen.some((url) => /whitedove/i.test(url.searchParams.get("address") ?? "") && !/white dove/i.test(url.searchParams.get("address") ?? "")));
  } finally {
    restore();
  }

  const stack = permit({
    id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    permitNumber: "WD-1",
    address: "3938 WHITE DOVE DR",
    city: "Lakeland",
    zip: "33812",
    county: "Polk",
    jurisdiction: "City of Lakeland",
    source: "PermitStack",
    dateIssued: "2022-03-01",
  });
  const accela = permit({
    id: "polk-accela:WD-2",
    permitNumber: "WD-2",
    address: "3938 WHITEDOVE DR",
    city: "Lakeland",
    zip: "33812",
    county: "Polk",
    jurisdiction: "Polk County",
    source: "Polk County Accela",
    dateIssued: "2018-06-01",
  });
  const appraiser = permit({
    id: "polk-pa:3938:WD-3",
    permitNumber: "WD-3",
    address: "3938 WHITE DOVE DR",
    city: "Lakeland",
    county: "Polk",
    jurisdiction: "Lakeland",
    source: "Polk County Property Appraiser",
    dateIssued: "2011-01-01",
  });
  const otherCity = permit({
    id: "polk-accela:WD-T",
    permitNumber: "WD-T",
    address: "3938 WHITE DOVE DR",
    city: "Tampa",
    zip: "33647",
    county: "Hillsborough",
    jurisdiction: "Hillsborough County",
    source: "Polk County Accela",
    dateIssued: "2024-01-01",
  });
  const extra = (name: string, permits: Permit[]): PermitProvider => ({
    name,
    appliesTo: shouldMergePolkSources,
    async search() {
      return { permits, total: permits.length, page: 1, perPage: permits.length, notices: [] };
    },
    async getPermit() {
      return null;
    },
  });
  const search = (q: string, city: string) => new CompositeProvider(
    {
      name: "PermitStack",
      async search() {
        return { permits: [stack], total: 1, page: 1, perPage: 1, notices: [] };
      },
      async getPermit() {
        return null;
      },
    },
    [extra("Polk County Accela", [accela, otherCity]), extra("Polk County Property Appraiser", [appraiser])],
  ).search({ mode: "address", q, city, state: "FL", zip: "33812", county: "Polk" });
  const fromLakeland = (await search("3938 White Dove Dr", "Lakeland")).permits.map((row) => row.permitNumber).sort();
  const fromHighland = (await search("3938 WhiteDove Dr", "Highland City")).permits.map((row) => row.permitNumber).sort();
  assert.deepEqual(fromLakeland, ["WD-1", "WD-2", "WD-3"]);
  assert.deepEqual(fromHighland, fromLakeland);
});

test("3806 Whitedove Drive returns the two Lakeland permits for either spelling", async () => {
  const rows = [
    stackRow({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", permit_number: "BT-2023-9026", address_street: "3806 WHITEDOVE DR", address_city: "LAKELAND", address_zip: "33812", jurisdiction_name: "Polk County", date_issued: "2023-06-01" }),
    stackRow({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2", permit_number: "BT-2022-20100", address_street: "3806 WHITEDOVE DR", address_city: "LAKELAND", address_zip: "33812", jurisdiction_name: "Polk County", date_issued: "2022-04-01" }),
    stackRow({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3", permit_number: "BT-OTHER", address_street: "3900 WHITEDOVE DR", address_city: "LAKELAND", address_zip: "33812", jurisdiction_name: "Polk County", date_issued: "2021-01-01" }),
    stackRow({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4", permit_number: "WH-3806", address_street: "3806 WHITEDOVE DR", address_city: "WINTER HAVEN", address_zip: "33880", jurisdiction_name: "City of Winter Haven", date_issued: "2024-01-01" }),
  ];
  const restore = mockFetch((url) => {
    const address = (url.searchParams.get("address") ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!address.includes("3806") && !address.includes("whitedove")) return { body: { results: [], total: 0, page: 1, per_page: 100 } };
    return { body: { results: rows, total: rows.length, page: 1, per_page: 100 } };
  });
  try {
    const provider = new PermitStackProvider("test-key");
    for (const q of ["3806 Whitedove Drive", "3806 White Dove Drive", "3806 WhiteDove Dr"]) {
      const result = await provider.search({ mode: "address", q, city: "Lakeland", state: "FL", zip: "33812", county: "Polk" });
      assert.deepEqual(result.permits.map((permit) => permit.permitNumber).sort(), ["BT-2022-20100", "BT-2023-9026"]);
      assert.ok(result.permits.every((permit) => /lakeland/i.test(permitLocationLines(permit).join(" "))));
      assert.match(resultsPlaceLabel({ q, city: "" }, result.permits), /Lakeland/i);
      assert.match(resultsPlaceLabel({ q, city: "Lakeland" }, result.permits), /Lakeland/);
    }
    const open = await provider.search({ mode: "address", q: "3806 Whitedove Drive", state: "FL", zip: "33812", county: "Polk" });
    assert.ok(open.permits.some((permit) => permit.permitNumber === "BT-2023-9026"));
    assert.ok(open.permits.some((permit) => permit.permitNumber === "BT-2022-20100"));
    assert.equal(open.permits.some((permit) => permit.permitNumber === "BT-OTHER"), false);
    assert.match(resultsPlaceLabel({ q: "3806 Whitedove Drive", city: "" }, open.permits.filter((permit) => permit.permitNumber !== "WH-3806")), /Lakeland/i);
  } finally {
    restore();
  }
});

test("live PermitStack search for 19156 Dove Creek Dr returns three Tampa permits", { skip: !process.env.PERMITSTACK_API_KEY }, async () => {
  const result = await new PermitStackProvider(process.env.PERMITSTACK_API_KEY).search({
    mode: "address",
    q: "19156 Dove Creek Dr",
  });
  const atHouse = result.permits.filter((p) => /19156/.test(p.address ?? "") && /tampa/i.test(`${p.city ?? ""} ${p.jurisdiction ?? ""}`));
  const numbers = atHouse.map((p) => p.permitNumber);
  assert.deepEqual(numbers.filter((n) => ["BTR-23-0567345", "BTR-13-0403822", "BTR-10-0348682"].includes(n ?? "")).sort(), ["BTR-10-0348682", "BTR-13-0403822", "BTR-23-0567345"], result.permits.map((p) => `${p.permitNumber} ${p.address} ${p.city} ${p.jurisdiction} ${p.category} ${p.dateIssued}`).join(" | "));
  assert.equal(result.notices.some((n) => /hidden/i.test(n)), false);
  assert.ok(atHouse.every((p) => sourceAttribution(p) === "PermitStack · statewide Florida"));
});
