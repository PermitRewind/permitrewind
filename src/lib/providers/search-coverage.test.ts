import assert from "node:assert/strict";
import test from "node:test";
import { sourceAttribution } from "../format";
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
    assert.deepEqual(result.permits.map((p) => p.permitNumber), ["HC-ROOF-1", "HC-POOL-2", "HC-ELEC-3"]);
    assert.ok(result.permits.every((p) => p.city === "TAMPA" && p.state === "FL" && p.jurisdiction === "Hillsborough County"));
    assert.ok(result.permits.every((p) => sourceAttribution(p) === "PermitStack · statewide Florida"));
    assert.equal(result.notices.some((n) => /hidden/i.test(n)), false);
    assert.equal(seen?.searchParams.get("state"), "FL");
    assert.equal(seen?.searchParams.get("address"), "19156 Dove Creek Dr");
    assert.equal(seen?.searchParams.get("city"), null);
    assert.equal(seen?.searchParams.get("jurisdiction"), null);
    assert.equal(seen?.pathname, "/v1/permits/search");
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
    assert.equal(seen?.searchParams.get("address"), "19156 Dove Creek Dr");
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
    }
    await new PermitStackProvider("test-key").search({ mode: "permit", q: "SFR40294" });
    assert.equal(seen?.searchParams.get("permit_number"), "SFR40294");
    assert.equal(seen?.searchParams.get("address"), null);
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
