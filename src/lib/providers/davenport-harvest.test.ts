import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceAttribution } from "../format";
import { CompositeProvider } from "./composite";
import { DavenportIworqProvider } from "./davenport-iworq";
import {
  HARVEST_PATH,
  ingestHtmlFiles,
  loadHarvest,
  lookupHarvest,
  readHarvest,
} from "./davenport-harvest";
import type { PermitProvider } from "./types";
import type { SearchResult } from "../types";

const SEARCH_FIXTURE = path.join(process.cwd(), "fixtures/davenport-iworq/search-1832-buckeye.html");
const DETAIL_FIXTURE = path.join(process.cwd(), "fixtures/davenport-iworq/permit-210405-detail.html");
const FIXTURES = [SEARCH_FIXTURE, DETAIL_FIXTURE];

function emptyResult(): SearchResult {
  return { permits: [], total: 0, page: 1, perPage: 0, notices: [] };
}

test("seeded harvest returns permit 210405 for 1832 Buckeye Rd, Davenport", async () => {
  const doc = await loadHarvest(HARVEST_PATH);
  assert.equal(doc.version, 1);
  assert.equal(doc.permits.length, 1);
  assert.deepEqual(doc.addressIndex["1832|buckeye"], ["15350875"]);

  const queries = [
    { mode: "address" as const, q: "1832 Buckeye Rd, Davenport, FL" },
    { mode: "address" as const, q: "1832 Buckeye Road", city: "Davenport", state: "FL", zip: "33837" },
    { mode: "address" as const, q: "1832 BUCKEYE RD" },
    { mode: "address" as const, q: "1832 Buckeye Rd Davenport FL" },
  ];
  for (const query of queries) {
    const hits = lookupHarvest(doc, query);
    assert.equal(hits.length, 1, JSON.stringify(query));
    const row = hits[0];
    assert.equal(row.permitNumber, "210405");
    assert.equal(row.internalId, "15350875");
    assert.equal(row.dateIssued, "2021-06-25");
    assert.equal(row.dateCompleted, "2022-04-18");
    assert.equal(row.permitDate, "2021-04-29");
    assert.equal(row.status, "Finaled");
    assert.equal(row.contractorName, "D R HORTON, INC.");
    assert.equal(row.applicantName, "D.R. HORTON");
    assert.equal(row.estimatedValue, 402839);
    assert.equal(row.address, "1832 BUCKEYE RD");
    assert.equal(row.city, "Davenport");
    assert.equal(row.description, "NEW SFR - 5 BED, 3 BATH - 2 STORY");
    assert.equal(row.sourceUrl, "https://portal.iworq.net/DAVENPORT/permit/600/15350875");
  }

  const provider = new DavenportIworqProvider();
  const result = await provider.search({ mode: "address", q: "1832 Buckeye Rd", city: "Davenport", state: "FL" });
  assert.equal(result.permits.length, 1);
  const permit = result.permits[0];
  assert.equal(permit.permitNumber, "210405");
  assert.equal(permit.id, "davenport-iworq:15350875");
  assert.equal(permit.dateIssued, "2021-06-25");
  assert.equal(permit.dateCompleted, "2022-04-18");
  assert.equal(permit.dateFiled, "2021-04-29");
  assert.equal(permit.status, "Finaled");
  assert.equal(permit.estimatedValue, 402839);
  assert.equal(permit.feeAmount, 15658.49);
  assert.equal(permit.contractorName, "D R HORTON, INC.");
  assert.equal(permit.jurisdiction, "City of Davenport");
  assert.equal(permit.county, "Polk");
  assert.equal(sourceAttribution(permit), "City of Davenport · city only");
  assert.equal(result.notices.length, 0);
  assert.deepEqual(await provider.getPermit("davenport-iworq:15350875"), permit);
});

test("empty address and a different city return nothing", async () => {
  const doc = await readHarvest(HARVEST_PATH);
  const provider = new DavenportIworqProvider();
  for (const q of ["", "   ", "Davenport, FL", "Buckeye"]) {
    assert.deepEqual(lookupHarvest(doc, { mode: "address", q, city: q.trim() ? "Davenport" : undefined }), [], q);
    const result = await provider.search({ mode: "address", q, city: "Davenport" });
    assert.deepEqual(result.permits, [], q);
  }
  assert.deepEqual(lookupHarvest(doc, { mode: "address", q: "1832 Buckeye Rd", city: "Tampa" }), []);
  assert.deepEqual(lookupHarvest(doc, { mode: "address", q: "1832 Buckeye Rd, Lakeland, FL" }), []);
  assert.equal(provider.appliesTo({ mode: "address", q: "1832 Buckeye Rd", city: "Tampa" }), false);
  assert.equal(provider.appliesTo({ mode: "address", q: "1832 Buckeye Rd", city: "Davenport" }), true);
  assert.deepEqual(lookupHarvest(doc, { mode: "parcel", q: "1832 Buckeye Rd", city: "Davenport" }), []);
});

test("ingest is idempotent and does not invent a second permit", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "davenport-harvest-"));
  try {
    const out = path.join(dir, "harvest.json");
    const first = await ingestHtmlFiles(FIXTURES, out, "2026-11-05");
    const once = readFileSync(out, "utf8");
    const second = await ingestHtmlFiles(FIXTURES, out, "2026-11-06");
    const twice = readFileSync(out, "utf8");
    assert.equal(twice, once);
    assert.equal(second.updated, first.updated);
    assert.equal(second.permits.length, 1);
    assert.equal(lookupHarvest(second, { mode: "address", q: "1832 Buckeye Rd, Davenport, FL" })[0]?.permitNumber, "210405");

    const copy = path.join(dir, "committed.json");
    writeFileSync(copy, readFileSync(HARVEST_PATH));
    const before = readFileSync(copy, "utf8");
    await ingestHtmlFiles(FIXTURES, copy, "2030-01-01");
    assert.equal(readFileSync(copy, "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saved fixtures do not keep captcha tokens", () => {
  for (const file of FIXTURES) {
    const html = readFileSync(file, "utf8");
    assert.equal(html.includes("0cAFcWeA"), false, file);
    assert.doesNotMatch(html, /g-recaptcha-response=[A-Za-z0-9_-]{20,}/);
    assert.doesNotMatch(html, /name="_token" value="(?!REDACTED")[^"]+"/);
  }
});

test("address search does not call the portal when the harvest cache hits", async () => {
  let called = false;
  const provider = new DavenportIworqProvider({
    solve: async () => {
      throw new Error("captcha should not run for a cached address");
    },
    fetchImpl: (async () => {
      called = true;
      return new Response("", { status: 500 });
    }) as typeof fetch,
  });
  const result = await provider.search({ mode: "address", q: "1832 Buckeye Rd", city: "Davenport" });
  assert.equal(called, false);
  assert.equal(result.permits[0]?.permitNumber, "210405");
  assert.deepEqual(result.notices, []);
});

test("a rejected live captcha search still returns the harvested Buckeye permit", async () => {
  let calls = 0;
  const provider = new DavenportIworqProvider({
    solve: async () => "test-token",
    fetchImpl: (async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: "https://portal.iworq.net/DAVENPORT/permits/600" } });
    }) as typeof fetch,
  });
  const result = await provider.search({ mode: "address", q: "1832 Buckeye Rd", city: "Davenport", state: "FL" });
  assert.equal(calls, 0);
  assert.equal(result.permits.length, 1);
  assert.equal(result.permits[0]?.permitNumber, "210405");
  assert.equal(result.permits[0]?.dateIssued, "2021-06-25");
  const missed = await provider.search({ mode: "address", q: "4100 Main Street", city: "Davenport" });
  assert.equal(calls, 1);
  assert.deepEqual(missed.permits, []);
  assert.match(missed.notices.join(" "), /did not accept/);
});

test("composite address search merges the Davenport cache without a captcha", async () => {
  const primary: PermitProvider = {
    name: "PermitStack",
    async search() {
      return emptyResult();
    },
    async getPermit() {
      return null;
    },
  };
  const result = await new CompositeProvider(primary, [new DavenportIworqProvider()]).search({
    mode: "address",
    q: "1832 Buckeye Rd",
    city: "Davenport",
    state: "FL",
  });
  assert.equal(result.permits.length, 1);
  assert.equal(result.permits[0]?.permitNumber, "210405");
  assert.equal(result.permits[0]?.dateIssued, "2021-06-25");
  assert.equal(result.permits[0]?.dateCompleted, "2022-04-18");
  assert.equal(result.permits[0]?.status, "Finaled");
  assert.equal(result.permits[0]?.estimatedValue, 402839);
  assert.match(result.permits[0]?.contractorName ?? "", /HORTON/);
});
