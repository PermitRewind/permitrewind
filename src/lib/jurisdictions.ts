/**
 * Coverage configuration.
 *
 * PermitStack is queried with state=FL and is statewide: do not allowlist its
 * rows to Polk County. Polk County Accela and the Property Appraiser stay
 * supplemental and only merge for Polk searches.
 */
export interface Jurisdiction {
  /** Display name (matches a provider jurisdiction_name where possible). */
  name: string;
  /** City name as it appears in permit addresses (used for the city filter). */
  city?: string;
}

export interface Region {
  id: string;
  label: string;
  state: string;
  /** Set for a single-county region. Omit for statewide coverage. */
  county?: string;
  /**
   * When true, every permit in `state` is in coverage.
   * `jurisdictions` is not an allowlist on a statewide region.
   */
  statewide?: boolean;
  jurisdictions: Jurisdiction[];
}

/** Single-county allowlist used only to recognize Polk searches and Polk-only sources. */
export const POLK_REGION: Region = {
  id: "polk-fl",
  label: "Polk County, FL",
  state: "FL",
  county: "Polk",
  jurisdictions: [
    { name: "Polk County" },
    { name: "Auburndale", city: "Auburndale" },
    { name: "Bartow", city: "Bartow" },
    { name: "Davenport", city: "Davenport" },
    { name: "Dundee", city: "Dundee" },
    { name: "Eagle Lake", city: "Eagle Lake" },
    { name: "Fort Meade", city: "Fort Meade" },
    { name: "Frostproof", city: "Frostproof" },
    { name: "Haines City", city: "Haines City" },
    { name: "Lake Alfred", city: "Lake Alfred" },
    { name: "Lake Hamilton", city: "Lake Hamilton" },
    { name: "Lake Wales", city: "Lake Wales" },
    { name: "Lakeland", city: "Lakeland" },
    { name: "Mulberry", city: "Mulberry" },
    { name: "Polk City", city: "Polk City" },
    { name: "Winter Haven", city: "Winter Haven" },
  ],
};

/** Default search coverage. Statewide Florida — not a county allowlist. */
export const FLORIDA_REGION: Region = {
  id: "fl",
  label: "Florida",
  state: "FL",
  statewide: true,
  jurisdictions: [],
};

export const REGIONS: Region[] = [FLORIDA_REGION, POLK_REGION];

export const DEFAULT_REGION = FLORIDA_REGION;

export const COVERAGE_NOTE =
  "Coverage is statewide Florida through PermitStack. Searches in Polk County also merge Polk County Accela and Polk County Property Appraiser records.";

const MAJOR_FLORIDA_CITIES = [
  "Apopka", "Boca Raton", "Bonita Springs", "Bradenton", "Brandon", "Cape Coral",
  "Clearwater", "Coral Springs", "Daytona Beach", "Delray Beach", "Deltona",
  "Fort Lauderdale", "Fort Myers", "Fort Pierce", "Gainesville", "Hialeah",
  "Hollywood", "Homestead", "Jacksonville", "Kissimmee", "Largo", "Melbourne",
  "Miami", "Miami Beach", "Miami Gardens", "Miramar", "Naples", "North Port",
  "Ocala", "Orlando", "Palm Bay", "Palm Coast", "Panama City", "Pembroke Pines",
  "Pensacola", "Plant City", "Pompano Beach", "Port Orange", "Port St. Lucie",
  "Sanford", "Sarasota", "St. Cloud", "St. Petersburg", "Tallahassee", "Tampa",
  "Titusville", "West Palm Beach", "Winter Garden",
];

/** Suggestions for the city filter. Any other Florida city can still be typed. */
export const CITY_SUGGESTIONS: string[] = [...new Set([...regionCities(POLK_REGION), ...MAJOR_FLORIDA_CITIES])].sort((a, b) => a.localeCompare(b));

export function getRegion(id?: string | null): Region {
  return REGIONS.find((r) => r.id === id) ?? DEFAULT_REGION;
}

export function regionCities(region: Region): string[] {
  return region.jurisdictions.map((j) => j.city).filter((c): c is string => !!c);
}

const STATE_ALIASES: Record<string, string> = { FLORIDA: "FL" };

function canonicalState(value: string): string {
  const upper = value.trim().toUpperCase();
  return STATE_ALIASES[upper] ?? upper;
}

/** True if a permit's jurisdiction or city belongs to a county allowlist. */
export function inRegion(region: Region, jurisdictionName?: string | null, city?: string | null): boolean {
  const names = region.jurisdictions.map((j) => j.name.toLowerCase());
  const cities = regionCities(region).map((c) => c.toLowerCase());
  return (
    (!!jurisdictionName && names.includes(jurisdictionName.toLowerCase())) ||
    (!!city && cities.includes(city.toLowerCase()))
  );
}

/**
 * Whether a PermitStack row is shown for this region.
 * Statewide Florida keeps every in-state row, including Tampa and other non-Polk cities.
 * Rows are dropped only when the state is explicitly somewhere else, or when the caller
 * selected a county region such as Polk.
 */
export function permitInCoverage(
  region: Region,
  permit: { jurisdiction?: string | null; city?: string | null; state?: string | null },
): boolean {
  if (permit.state?.trim() && canonicalState(permit.state) !== canonicalState(region.state)) return false;
  if (region.statewide) return true;
  return inRegion(region, permit.jurisdiction, permit.city);
}

export function normalizePlace(name: string): string {
  return name
    .replace(/\b(FL|FLORIDA)\b/gi, " ")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const POLK_PLACES = new Set<string>([
  ...POLK_REGION.jurisdictions.flatMap((j) => [j.name, j.city].filter((x): x is string => !!x).map((x) => normalizePlace(x))),
  "polk",
  "polk county",
]);

export function isPolkCity(name: string): boolean {
  const n = normalizePlace(name);
  return !!n && POLK_PLACES.has(n);
}

/**
 * Known Florida city at the end of an address, with or without commas.
 * "3533 Sam Allen Oaks Cir Plant City" → "Plant City".
 */
export function trailingKnownCity(q: string): string | null {
  const norm = q
    .replace(/[.,]/g, " ")
    .replace(/\b(FL|FLORIDA)\b/gi, " ")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  let best: string | null = null;
  let bestLen = 0;
  for (const city of CITY_SUGGESTIONS) {
    const c = city.replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!c) continue;
    if ((norm === c || norm.endsWith(" " + c)) && c.length > bestLen) {
      best = city;
      bestLen = c.length;
    }
  }
  return best;
}

/** City named in "street, City, ST ZIP" — not a guess from the street line. */
export function localityFromQuery(q: string): string | null {
  const parts = q.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts.slice(1)) {
    const candidate = normalizePlace(part);
    if (candidate) return part.replace(/\b(FL|FLORIDA)\b/gi, " ").replace(/\b\d{5}(?:-\d{4})?\b/g, " ").replace(/\s+/g, " ").trim();
  }
  return null;
}

/**
 * Polk County portals are enhancements. Merge them for Polk cities and for
 * addresses that do not name another city (the property may still be in Polk).
 * Skip them when the search names a Florida city outside Polk, such as Tampa.
 */
export function shouldMergePolkSources(query: { q: string; city?: string | null }): boolean {
  const city = query.city?.trim();
  if (city) return isPolkCity(city);
  const place = localityFromQuery(query.q) ?? trailingKnownCity(query.q);
  if (place) return isPolkCity(place);
  return true;
}

export const PERMIT_CATEGORIES = [
  "ROOFING", "MECHANICAL", "HVAC", "ELECTRICAL", "PLUMBING", "SOLAR", "RENOVATION",
  "ADDITION", "NEW_CONSTRUCTION", "DEMOLITION", "POOL", "FENCE", "WINDOWS_DOORS", "OTHER",
];

export const PERMIT_STATUSES = [
  "filed", "issued", "in_progress", "final", "expired", "cancelled", "revoked", "unknown",
];
