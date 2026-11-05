import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sourceAttribution } from "../format";
import { CompositeProvider } from "./composite";
import {
  DAVENPORT_CAPTCHA_NOTICE,
  DavenportIworqProvider,
  davenportAddressQuery,
  davenportPermitQuery,
  parseDavenportDetail,
  parseDavenportList,
  shouldSearchDavenport,
} from "./davenport-iworq";
import type { SearchResult } from "../types";

const listHtml = readFileSync("fixtures/davenport-iworq/search-1832-buckeye.html", "utf8");
const detailHtml = readFileSync("fixtures/davenport-iworq/permit-210405-detail.html", "utf8");

function emptyResult(): SearchResult {
  return { permits: [], total: 0, page: 1, perPage: 0, notices: [] };
}

test("1832 Buckeye list fixture is the city portal row for permit 210405", () => {
  assert.match(listHtml, /210405/);
  assert.match(listHtml, /BUCKEYE/);
  const rows = parseDavenportList(listHtml);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.internalId, "15350875");
  assert.equal(row.permitNumber, "210405");
  assert.equal(row.permitDate, "2021-04-29");
  assert.equal(row.contractorName, "D R HORTON, INC.");
  assert.equal(row.applicantName, "D.R. HORTON");
  assert.equal(row.address, "1832 BUCKEYE RD");
  assert.equal(row.lot, "245");
  assert.equal(row.description, "NEW SFR - 5 BED, 3 BATH - 2 STORY");
  assert.equal(row.estimatedValue, 402839);
  assert.equal(row.status, "Finaled");
});

test("210405 detail fixture maps issued and completion dates, not the permit date", () => {
  assert.match(detailHtml, /210405/);
  assert.match(detailHtml, /BUCKEYE/);
  const detail = parseDavenportDetail(detailHtml);
  assert.equal(detail.permitNumber, "210405");
  assert.equal(detail.permitDate, "2021-04-29");
  assert.equal(detail.issuedDate, "2021-06-25");
  assert.equal(detail.completionDate, "2022-04-18");
  assert.equal(detail.coIssueDate, "2022-04-26");
  assert.equal(detail.status, "Finaled");
  assert.equal(detail.estimatedValue, 402839);
  assert.equal(detail.feeAmount, 15658.49);
  assert.equal(detail.contractorName, "D R HORTON, INC.");
  assert.equal(detail.applicantName, "D.R. HORTON");
  assert.equal(detail.address, "1832 BUCKEYE RD");
  assert.equal(detail.description, "NEW SFR - 5 BED, 3 BATH - 2 STORY");
  const others = detail.otherContractors.join(" | ");
  assert.match(others, /BAYONET PLUMBING, HEATING & AIR-CONDITIONING/i);
  assert.match(others, /KEYSTONE ENERGY & POWER/i);
  assert.match(others, /LINSCOTT PLUMBING/i);
  assert.match(others, /PROFORMANCE ROOFING/i);
  assert.match(others, /WINDHAM'S GRASSHOPPER LAWN SERVICES/i);
  assert.equal(others.includes("D R HORTON"), false);
});

test("Davenport search runs only when the city or address says Davenport", () => {
  assert.equal(davenportAddressQuery("1832 Buckeye Road"), "1832 Buckeye");
  assert.equal(davenportAddressQuery("1832 BUCKEYE RD"), "1832 Buckeye");
  assert.equal(davenportPermitQuery("SFR 210405"), "210405");
  assert.equal(davenportPermitQuery("210405"), "210405");
  assert.equal(shouldSearchDavenport({ q: "1832 Buckeye Road", city: "Davenport" }), true);
  assert.equal(shouldSearchDavenport({ q: "1832 Buckeye Rd, Davenport, FL" }), true);
  assert.equal(shouldSearchDavenport({ q: "1832 Buckeye Road" }), false);
  assert.equal(shouldSearchDavenport({ q: "3749 Feather Dr", city: "Lakeland" }), false);
  assert.equal(shouldSearchDavenport({ q: "19156 Dove Creek Dr", city: "Tampa" }), false);
  assert.equal(new DavenportIworqProvider().appliesTo({ mode: "address", q: "1832 Buckeye Road", city: "Davenport" }), true);
});

test("selected Davenport address search uses a captcha token, then the open detail page", async () => {
  const urls: string[] = [];
  let solves = 0;
  const provider = new DavenportIworqProvider({
    solve: async () => {
      solves += 1;
      return "test-token";
    },
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      urls.push(url.toString());
      if (url.pathname.endsWith("/15350875")) {
        return new Response(detailHtml, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      assert.equal(url.searchParams.get("searchField"), "text6");
      assert.equal(url.searchParams.get("search"), "1832 Buckeye");
      if (urls.length === 1) assert.equal(url.searchParams.get("g-recaptcha-response"), "test-token");
      return new Response(listHtml, {
        status: 200,
        headers: { "Content-Type": "text/html", "set-cookie": "iworq_api_session=abc; Path=/; HttpOnly" },
      });
    }) as typeof fetch,
  });

  const result = await provider.search({ mode: "address", q: "1832 Buckeye Road", city: "Davenport", state: "FL", zip: "33837", county: "Polk" });
  assert.equal(solves, 1);
  assert.equal(result.permits.length, 1);
  const permit = result.permits[0];
  assert.equal(permit.permitNumber, "210405");
  assert.equal(permit.id, "davenport-iworq:15350875");
  assert.equal(permit.dateFiled, "2021-04-29");
  assert.equal(permit.dateIssued, "2021-06-25");
  assert.equal(permit.dateCompleted, "2022-04-18");
  assert.notEqual(permit.dateIssued, permit.dateFiled);
  assert.equal(permit.status, "Finaled");
  assert.equal(permit.estimatedValue, 402839);
  assert.equal(permit.feeAmount, 15658.49);
  assert.equal(permit.contractorName, "D R HORTON, INC.");
  assert.equal(permit.address, "1832 BUCKEYE RD");
  assert.equal(permit.city, "Davenport");
  assert.equal(permit.county, "Polk");
  assert.equal(permit.sourceUrl, "https://portal.iworq.net/DAVENPORT/permit/600/15350875");
  assert.equal(sourceAttribution(permit), "City of Davenport · city only");
  assert.equal(urls.some((url) => url.includes("zip")), false);

  const again = await provider.search({ mode: "address", q: "1832 Buckeye Road", city: "Davenport" });
  assert.equal(solves, 1);
  assert.equal(again.permits[0]?.permitNumber, "210405");
  assert.match(urls.at(-2) ?? "", /iworq/);
  const secondSearch = urls.filter((url) => url.includes("searchField=text6"));
  assert.equal(secondSearch.length, 2);
  assert.equal(new URL(secondSearch[1]).searchParams.get("g-recaptcha-response"), null);
});

test("a cached session that the portal rejects is solved once and still returns Buckeye", async () => {
  let searches = 0;
  const provider = new DavenportIworqProvider({
    solve: async () => "test-token",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname.endsWith("/15350875")) return new Response(detailHtml, { status: 200 });
      searches += 1;
      const cookie = new Headers(init?.headers).get("cookie");
      if (cookie && !url.searchParams.get("g-recaptcha-response")) {
        return new Response("", { status: 302, headers: { location: "https://portal.iworq.net/DAVENPORT/permits/600" } });
      }
      return new Response(listHtml, { status: 200, headers: { "set-cookie": "iworq_api_session=abc; Path=/" } });
    }) as typeof fetch,
  });
  await provider.search({ mode: "address", q: "1832 Buckeye Road", city: "Davenport" });
  const second = await provider.search({ mode: "address", q: "1832 Buckeye Road", city: "Davenport" });
  assert.equal(second.permits[0]?.dateIssued, "2021-06-25");
  assert.ok(searches >= 3);
});

test("without a captcha solver the city search does not call the portal", async () => {
  let calls = 0;
  const provider = new DavenportIworqProvider({
    solve: async () => null,
    fetchImpl: (async () => {
      calls += 1;
      throw new Error("portal should not be called");
    }) as typeof fetch,
  });
  const result = await provider.search({ mode: "address", q: "1832 Buckeye Road", city: "Davenport" });
  assert.equal(calls, 0);
  assert.deepEqual(result.permits, []);
  assert.match(result.notices.join(" "), /DAVENPORT_CAPTCHA_API_KEY/);
  assert.equal(result.notices[0], DAVENPORT_CAPTCHA_NOTICE);
});

test("detail lookup by internal id does not need a captcha token", async () => {
  const provider = new DavenportIworqProvider({
    solve: async () => {
      throw new Error("detail pages are not captcha gated");
    },
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.match(url, /\/DAVENPORT\/permit\/600\/15350875$/);
      assert.equal(url.includes("g-recaptcha-response"), false);
      return new Response(detailHtml, { status: 200 });
    }) as typeof fetch,
  });
  const permit = await provider.getPermit("davenport-iworq:15350875");
  assert.equal(permit?.permitNumber, "210405");
  assert.equal(permit?.dateIssued, "2021-06-25");
  assert.equal(permit?.dateCompleted, "2022-04-18");
});

test("another house on the same street is not kept", async () => {
  const extra = listHtml.replace(
    "</tbody>",
    `<tr>
      <th data-label="Permit #" data-route="https://portal.iworq.net/DAVENPORT/permit/600/99"><a href="https://portal.iworq.net/DAVENPORT/permit/600/99">999999</a></th>
      <td data-label="Site Address">1840 BUCKEYE RD</td>
      <td data-label="Permit Status">Issued</td>
    </tr></tbody>`,
  );
  const provider = new DavenportIworqProvider({
    solve: async () => "test-token",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/15350875")) return new Response(detailHtml, { status: 200 });
      return new Response(extra, { status: 200 });
    }) as typeof fetch,
  });
  const result = await provider.search({ mode: "address", q: "1832 Buckeye Road", city: "Davenport" });
  assert.deepEqual(result.permits.map((p) => p.permitNumber), ["210405"]);
});

test("Tampa does not call Davenport, and a Davenport city search does", async () => {
  let calls = 0;
  const city = {
    name: "City of Davenport",
    appliesTo: shouldSearchDavenport,
    async search() {
      calls += 1;
      return emptyResult();
    },
    async getPermit() {
      return null;
    },
  };
  const primary = {
    name: "PermitStack",
    async search() {
      return emptyResult();
    },
    async getPermit() {
      return null;
    },
  };
  const composite = new CompositeProvider(primary, [city]);
  await composite.search({ mode: "address", q: "19156 Dove Creek Dr", city: "Tampa" });
  assert.equal(calls, 0);
  await composite.search({ mode: "address", q: "1832 Buckeye Road", city: "Davenport" });
  assert.equal(calls, 1);
  await composite.search({ mode: "address", q: "3749 Feather Dr", city: "Lakeland" });
  assert.equal(calls, 1);
});

test("captcha key is an environment variable, not a hardcoded secret", () => {
  const source = readFileSync("src/lib/providers/davenport-captcha.ts", "utf8") + readFileSync("src/lib/providers/davenport-iworq.ts", "utf8");
  assert.match(source, /DAVENPORT_CAPTCHA_API_KEY/);
  assert.match(readFileSync(".env.example", "utf8"), /DAVENPORT_CAPTCHA_API_KEY=/);
  assert.doesNotMatch(source, /DAVENPORT_CAPTCHA_API_KEY\s*=\s*["'][A-Za-z0-9]{8,}/);
  assert.match(readFileSync("README.md", "utf8"), /1832 Buckeye/);
});

test("live Davenport search for 1832 Buckeye Road returns permit 210405", { skip: !process.env.DAVENPORT_CAPTCHA_API_KEY }, async () => {
  const result = await new DavenportIworqProvider().search({ mode: "address", q: "1832 Buckeye Road", city: "Davenport" });
  const permit = result.permits.find((p) => p.permitNumber === "210405");
  assert.ok(permit, result.notices.join(" ") || "missing 210405");
  assert.equal(permit?.dateIssued, "2021-06-25");
  assert.equal(permit?.dateCompleted, "2022-04-18");
  assert.equal(permit?.address, "1832 BUCKEYE RD");
});
