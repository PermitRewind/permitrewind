/**
 * Jurisdiction configuration. Add a new region by appending a Region entry;
 * the UI and provider read everything from here.
 */
export interface Jurisdiction {
  /** Display name (matches the provider's jurisdiction_name where possible). */
  name: string;
  /** City name as it appears in permit addresses (used for the city filter). */
  city?: string;
}

export interface Region {
  id: string;
  label: string;
  state: string;
  county: string;
  /** Provider jurisdiction names that belong to this region. */
  jurisdictions: Jurisdiction[];
}

export const REGIONS: Region[] = [
  {
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
  },
];

export const DEFAULT_REGION = REGIONS[0];

export function getRegion(id?: string | null): Region {
  return REGIONS.find((r) => r.id === id) ?? DEFAULT_REGION;
}

export function regionCities(region: Region): string[] {
  return region.jurisdictions.map((j) => j.city).filter((c): c is string => !!c);
}

/** True if a permit's jurisdiction or city belongs to the region. */
export function inRegion(region: Region, jurisdictionName?: string | null, city?: string | null): boolean {
  const names = region.jurisdictions.map((j) => j.name.toLowerCase());
  const cities = regionCities(region).map((c) => c.toLowerCase());
  return (
    (!!jurisdictionName && names.includes(jurisdictionName.toLowerCase())) ||
    (!!city && cities.includes(city.toLowerCase()))
  );
}

export const PERMIT_CATEGORIES = [
  "ROOFING", "MECHANICAL", "HVAC", "ELECTRICAL", "PLUMBING", "SOLAR", "RENOVATION",
  "ADDITION", "NEW_CONSTRUCTION", "DEMOLITION", "POOL", "FENCE", "WINDOWS_DOORS", "OTHER",
];

export const PERMIT_STATUSES = [
  "filed", "issued", "in_progress", "final", "expired", "cancelled", "revoked", "unknown",
];
