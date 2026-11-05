import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sourceAttribution } from "./format";
import {
  CITY_SUGGESTIONS,
  DEFAULT_REGION,
  POLK_REGION,
  getRegion,
  isPolkCity,
  permitInCoverage,
  shouldMergePolkSources,
} from "./jurisdictions";
import { permitLinkTarget } from "./permit-link";

const read = (path: string) => readFileSync(path, "utf8");

test("default coverage is statewide Florida, not the Polk allowlist", () => {
  assert.equal(DEFAULT_REGION.id, "fl");
  assert.equal(DEFAULT_REGION.label, "Florida");
  assert.equal(DEFAULT_REGION.statewide, true);
  assert.equal(getRegion(undefined).id, "fl");
  assert.equal(getRegion("missing").id, "fl");
  assert.equal(getRegion("polk-fl").id, "polk-fl");
  assert.equal(POLK_REGION.statewide, undefined);
});

test("statewide coverage keeps Tampa permits that the Polk allowlist rejects", () => {
  const tampa = { jurisdiction: "Hillsborough County", city: "TAMPA", state: "FL" };
  const spelledOut = { jurisdiction: "City of Tampa", city: "Tampa", state: "Florida" };
  const missingState = { jurisdiction: "City of Tampa", city: "Tampa", state: null };
  assert.equal(permitInCoverage(DEFAULT_REGION, tampa), true);
  assert.equal(permitInCoverage(DEFAULT_REGION, spelledOut), true);
  assert.equal(permitInCoverage(DEFAULT_REGION, missingState), true);
  assert.equal(permitInCoverage(POLK_REGION, tampa), false);
  assert.equal(permitInCoverage(POLK_REGION, spelledOut), false);
  assert.equal(permitInCoverage(DEFAULT_REGION, { jurisdiction: "Fulton County", city: "Atlanta", state: "GA" }), false);
});

test("Polk allowlist still matches Lakeland and other Polk cities", () => {
  const lakeland = { jurisdiction: "City of Lakeland", city: "Lakeland", state: "FL" };
  assert.equal(permitInCoverage(POLK_REGION, lakeland), true);
  assert.equal(permitInCoverage(DEFAULT_REGION, lakeland), true);
  assert.equal(isPolkCity("Lakeland"), true);
  assert.equal(isPolkCity("LAKELAND"), true);
  assert.equal(isPolkCity("Winter Haven"), true);
  assert.equal(isPolkCity("Tampa"), false);
  assert.equal(isPolkCity("Plant City"), false);
  assert.equal(isPolkCity("Winter Garden"), false);
  assert.ok(CITY_SUGGESTIONS.includes("Tampa"));
  assert.ok(CITY_SUGGESTIONS.includes("Lakeland"));
  assert.ok(CITY_SUGGESTIONS.includes("Miami"));
});

test("Polk sources merge for Lakeland and unqualified addresses, not for Tampa", () => {
  assert.equal(shouldMergePolkSources({ q: "3749 Feather Dr, Lakeland, FL" }), true);
  assert.equal(shouldMergePolkSources({ q: "3749 Feather Dr", city: "Lakeland" }), true);
  assert.equal(shouldMergePolkSources({ q: "3749 Feather Dr, Lakeland FL 33812" }), true);
  assert.equal(shouldMergePolkSources({ q: "19156 Dove Creek Dr" }), true);
  assert.equal(shouldMergePolkSources({ q: "19156 Dove Creek Dr, Tampa, FL" }), false);
  assert.equal(shouldMergePolkSources({ q: "19156 Dove Creek Dr", city: "Tampa" }), false);
  assert.equal(shouldMergePolkSources({ q: "3749 Feather Dr, Lakeland, FL", city: "Tampa" }), false);
});

test("source labels distinguish statewide PermitStack from Polk-only records", () => {
  assert.equal(sourceAttribution({ source: "PermitStack" }), "PermitStack · statewide Florida");
  assert.equal(
    sourceAttribution({ source: "PermitStack", alsoIn: ["Polk County Accela", "Polk County Property Appraiser"] }),
    "PermitStack · statewide Florida + Polk County Accela · Polk County only + Polk County Property Appraiser · Polk County only",
  );
  assert.equal(sourceAttribution({ source: "PermitStack" }).includes("Polk County only"), false);
});

test("PermitStack ids route internally, including non-Polk records", () => {
  const tampaId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(permitLinkTarget({ id: tampaId }), { kind: "internal", href: `/permit/${tampaId}` });
  assert.deepEqual(
    permitLinkTarget({ id: "polk-accela:BLD-100", sourceUrl: "https://aca-prod.accela.com/POLKCO/detail" }),
    { kind: "external", href: "https://aca-prod.accela.com/POLKCO/detail" },
  );
  assert.deepEqual(
    permitLinkTarget({ id: "polk-pa:123:OLD-1", sourceUrl: "https://www.polkflpa.gov/example" }),
    { kind: "external", href: "https://www.polkflpa.gov/example" },
  );
  assert.deepEqual(permitLinkTarget({ id: "polk-pa:123:OLD-1" }), { kind: "none" });
});

test("user-facing copy describes Florida coverage", () => {
  const layout = read("src/app/layout.tsx");
  const home = read("src/app/page.tsx");
  const search = read("src/app/search/page.tsx");
  const about = read("src/app/about/page.tsx");
  const site = read("src/lib/site.ts");
  const readme = read("README.md");
  assert.match(layout, /Florida Permit History/);
  assert.match(layout, /across Florida/);
  assert.doesNotMatch(layout, /Polk County Permit History/);
  assert.match(home, /Florida coverage/);
  assert.doesNotMatch(home, /Polk County coverage/);
  assert.match(search, /All of Florida/);
  assert.match(search, /CITY_SUGGESTIONS/);
  assert.match(search, /sourceAttribution/);
  assert.match(search, /permitLinkTarget/);
  assert.doesNotMatch(search, /regionCities/);
  assert.match(about, /across Florida/);
  assert.match(about, /Permit search coverage: Florida/);
  assert.match(site, /for Florida/);
  assert.doesNotMatch(site, /Polk County, FL/);
  assert.match(readme, /19156 Dove Creek Dr/);
  assert.match(readme, /3749 Feather Dr, Lakeland, FL/);
  assert.doesNotMatch(readme, /filtered to the configured Polk/);
  assert.doesNotMatch(read("src/lib/providers/permitstack.ts"), /NEXT_PUBLIC_/);
  assert.doesNotMatch(read("src/lib/providers/index.ts"), /NEXT_PUBLIC_/);
  assert.match(read("src/app/api/search/route.ts"), /statewide Florida/);
  assert.doesNotMatch(read("src/app/api/search/route.ts"), /polk-fl/);
});
