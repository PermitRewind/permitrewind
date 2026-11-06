import { streetNameForms, streetNamesMatch, fuzzyKnownCity } from "./address-normalize";
import { CITY_SUGGESTIONS, isPermittingCity, isPolkCity, localityFromQuery, normalizePlace, trailingKnownCity } from "./jurisdictions";

/**
 * Street-suffix families. PermitStack stores the same road as Cir, Circle, or CR,
 * so a search for one of those must keep the others.
 */
const SUFFIX_GROUPS: string[][] = [
  ["CIR", "CIRCLE", "CIRCL", "CR"],
  ["DR", "DRIVE"],
  ["ST", "STREET"],
  ["AVE", "AVENUE", "AV"],
  ["RD", "ROAD"],
  ["BLVD", "BOULEVARD"],
  ["LN", "LANE"],
  ["CT", "COURT"],
  ["PL", "PLACE"],
  ["TER", "TERRACE", "TERR"],
  ["TRL", "TRAIL"],
  ["PKWY", "PARKWAY"],
  ["HWY", "HIGHWAY"],
  ["WAY"],
  ["LOOP"],
  ["RUN"],
  ["PATH"],
  ["PT", "POINT"],
  ["CV", "COVE"],
  ["XING", "CROSSING"],
  ["SQ", "SQUARE"],
  ["PLZ", "PLAZA"],
];

const SUFFIX_TO_GROUP = new Map<string, string[]>();
for (const group of SUFFIX_GROUPS) {
  for (const token of group) SUFFIX_TO_GROUP.set(token, group);
}

const UNIT_TOKENS = new Set(["APT", "APARTMENT", "UNIT", "STE", "SUITE", "BLDG", "BUILDING", "FLOOR"]);

export interface ParsedAddress {
  raw: string;
  number: string | null;
  streetName: string | null;
  /** Normalized suffix token, e.g. "CIR". */
  suffix: string | null;
  city: string | null;
  zip: string | null;
}

export function suffixEquivalents(suffix: string | null | undefined): string[] {
  if (!suffix) return [];
  const key = suffix.toUpperCase().replace(/[^A-Z]/g, "");
  return SUFFIX_TO_GROUP.get(key) ?? [key];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Known permitting city, or a one-edit miss such as Lakland → Lakeland. CDPs stay null. */
export function hardCity(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  const exact = CITY_SUGGESTIONS.find((city) => normalizePlace(city) === normalizePlace(name));
  if (exact) return exact;
  const fuzzy = fuzzyKnownCity(name);
  if (!fuzzy || !isPermittingCity(fuzzy)) return null;
  return CITY_SUGGESTIONS.find((city) => normalizePlace(city) === normalizePlace(fuzzy)) ?? fuzzy;
}

/** Trailing permitting city, or the place named after a comma (Highland City). */
function localityInQuery(raw: string): string | null {
  return trailingKnownCity(raw) ?? localityFromQuery(raw);
}

/** Drop a trailing city, state, and ZIP so the street line can be parsed. */
function streetRemainder(raw: string, city: string | null): string {
  let s = raw.replace(/[#]/g, " ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  // A trailing ZIP only. A leading 5-digit token is a house number (19156 Dove Creek).
  s = s.replace(/\s+\d{5}(?:-\d{4})?$/g, "").trim();
  s = s.replace(/\b(?:FLORIDA|FL)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (city) {
    const c = city.replace(/\./g, "").replace(/\s+/g, " ").trim();
    s = s.replace(new RegExp(`${escapeRegExp(c)}\\s*$`, "i"), "").trim();
  }
  return s;
}

function stripUnit(tokens: string[]): string[] {
  const idx = tokens.findIndex((t) => UNIT_TOKENS.has(t.toUpperCase()) || t.startsWith("#"));
  return idx > 0 ? tokens.slice(0, idx) : tokens;
}

/**
 * Parse a typed Florida address, including ones with no commas.
 * "3533 Sam Allen Oaks Cir Plant City" → number 3533, name Sam Allen Oaks, suffix CIR, city Plant City.
 */
export function parseAddressQuery(raw: string): ParsedAddress {
  const trimmed = raw.trim();
  const city = localityInQuery(trimmed);
  const zip = trimmed.match(/(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
  const tokens = stripUnit(streetRemainder(trimmed, city).split(/\s+/).filter(Boolean));
  let number: string | null = null;
  let rest = tokens;
  if (rest.length && /^\d+[A-Za-z]?$/.test(rest[0])) {
    number = rest[0];
    rest = rest.slice(1);
  }
  let suffix: string | null = null;
  if (rest.length) {
    const last = rest[rest.length - 1].toUpperCase().replace(/[^A-Z]/g, "");
    if (last && SUFFIX_TO_GROUP.has(last) && rest.length > 1) {
      suffix = last;
      rest = rest.slice(0, -1);
    }
  }
  const streetName = rest.join(" ").trim() || null;
  return { raw: trimmed, number, streetName, suffix, city, zip };
}

function norm(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

function tokens(s: string): string[] {
  const n = norm(s);
  return n ? n.split(" ") : [];
}

/** Cir/Circle/CR are stored interchangeably. Other suffixes stay as typed so the API query matches raw PermitStack. */
function expandsSuffix(suffix: string | null): boolean {
  if (!suffix) return false;
  const group = suffixEquivalents(suffix);
  return group.includes("CIR") && group.includes("CR");
}

function containsSequence(hay: string[], needle: string[]): boolean {
  if (!needle.length || hay.length < needle.length) return false;
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (needle.every((t, j) => hay[i + j] === t)) return true;
  }
  return false;
}

/** Last recognized suffix in the line, so "DR N" and "N DOVE CREEK DR" both count as DR. */
function suffixInLine(line: string): string | null {
  const parts = tokens(line);
  for (let i = parts.length - 1; i >= 0; i--) {
    const key = parts[i].replace(/[^A-Z]/g, "");
    if (SUFFIX_TO_GROUP.has(key)) return key;
  }
  return null;
}

function prettyToken(token: string): string {
  const upper = token.toUpperCase();
  if (DIR_FULL[upper]) return DIR_FULL[upper];
  if (upper.length === 1) return upper;
  return upper.charAt(0) + upper.slice(1).toLowerCase();
}

function shortSuffix(suffix: string | null): string | null {
  if (!suffix) return null;
  const group = suffixEquivalents(suffix);
  return group[0] ? prettyToken(group[0]) : null;
}

/** Street line with a trailing city, state, and ZIP removed. */
export function streetLineWithoutLocality(raw: string): string {
  return streetRemainder(raw, localityInQuery(raw));
}

/**
 * Address string for PermitStack's partial match.
 * Directions and suffixes are shortened (South → S, Avenue → Ave) because stored
 * rows are usually abbreviated. Cir/Circle/CR stays unsuffixed so all three match.
 * ZIP is returned for display only; sending it as zip_code ANDs away rows that omit it.
 */
export function toPermitStackAddress(parsed: ParsedAddress): { address: string; city?: string; zip?: string } {
  const name = parsed.streetName
    ? tokens(parsed.streetName).map((token) => prettyToken(token)).join(" ")
    : "";
  const address = !parsed.streetName
    ? parsed.raw.trim()
    : expandsSuffix(parsed.suffix)
      ? [parsed.number, name].filter(Boolean).join(" ")
      : [parsed.number, name, shortSuffix(parsed.suffix)].filter(Boolean).join(" ");
  const city = hardCity(parsed.city);
  return {
    address,
    ...(city ? { city } : {}),
    ...(parsed.zip ? { zip: parsed.zip } : {}),
  };
}

/** Street lines to send for one address. Compound names are queried both ways. */
export function addressStreetForms(raw: string): string[] {
  const parsed = parseAddressQuery(raw);
  if (!parsed.streetName) return [raw.trim()];
  const suffix = expandsSuffix(parsed.suffix) ? null : shortSuffix(parsed.suffix);
  const lines = streetNameForms(parsed.streetName).map((name) => {
    const pretty = name.split(/\s+/).filter(Boolean).map((part) => prettyToken(part)).join(" ");
    return [parsed.number, pretty, suffix].filter(Boolean).join(" ");
  });
  const unique = [...new Set(lines)];
  return unique.length ? unique : [raw.trim()];
}

/** PermitStack address strings for this parse, including the other compound spelling. */
export function permitAddressQueries(parsed: ParsedAddress): string[] {
  const primary = toPermitStackAddress(parsed).address;
  return [...new Set([primary, ...addressStreetForms(parsed.raw)].filter(Boolean))];
}

/**
 * A shorter address that is still a substring of both "S CENTRAL AVE" and
 * "SOUTH CENTRAL AVENUE". Used only after the abbreviated query misses.
 */
export function loosePermitStackAddress(parsed: ParsedAddress): string | null {
  if (!parsed.streetName) return null;
  const parts = tokens(parsed.streetName);
  const hadDirection = parts.some((part) => DIR_FULL[part] || ["N", "S", "E", "W"].includes(part));
  if (!hadDirection) return null;
  const core = parts.filter((part) => !DIR_FULL[part] && !["N", "S", "E", "W"].includes(part)).map((part) => prettyToken(part));
  return core.length ? core.join(" ") : null;
}

/**
 * Same house and street name. Equivalent suffixes (Dr/Drive, Cir/Circle/CR) match.
 * A direction before or after the suffix still matches. A different suffix family does not.
 */
export function permitAddressMatches(
  parsed: ParsedAddress,
  permit: { address?: string | null; city?: string | null; jurisdiction?: string | null },
): boolean {
  if (!parsed.streetName) return true;
  const line = permit.address ?? "";
  const rowTokens = tokens(line);
  if (!rowTokens.length) return false;
  const rowNumber = /^\d+[A-Z]?$/.test(rowTokens[0]) ? rowTokens[0] : null;
  if (parsed.number && rowNumber !== parsed.number.toUpperCase()) return false;
  const nameTokens = canonDirections(tokens(parsed.streetName));
  const resolvedCity = hardCity(parsed.city);
  if (!containsSequence(canonDirections(rowTokens), nameTokens) && !streetNamesMatch(line, nameTokens.join(" "))) return false;
  if (parsed.suffix) {
    const rowSuffix = suffixInLine(line);
    if (rowSuffix && !suffixEquivalents(parsed.suffix).includes(rowSuffix)) return false;
  }
  if (resolvedCity && cityPreference(resolvedCity, permit) >= 2) return false;
  return true;
}

const DIR_FULL: Record<string, string> = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };

function canonDirections(parts: string[]): string[] {
  return parts.map((part) => DIR_FULL[part] ?? part);
}

const KNOWN_CITY_NORMS = [...CITY_SUGGESTIONS]
  .map((city) => norm(city))
  .sort((a, b) => b.length - a.length);

function knownCityIn(text: string): string | null {
  const n = norm(text).replace(/^CITY OF /, "");
  return KNOWN_CITY_NORMS.find((city) => n === city) ?? null;
}

/**
 * 0 = this permitting city (or its "City of" jurisdiction), 1 = no conflicting city,
 * 2 = a different permitting city.
 * An unofficial place name never scores 2, so it cannot wipe out a real AHJ.
 * Among permitting cities, city is the rank ahead of permit date.
 */
export function cityPreference(
  wanted: string | null | undefined,
  permit: { city?: string | null; jurisdiction?: string | null },
): number {
  if (!wanted?.trim()) return 0;
  const resolved = hardCity(wanted);
  const target = norm(resolved ?? wanted);
  const rawLabels = [permit.city, permit.jurisdiction].map((value) => (value ? norm(value).replace(/^CITY OF /, "") : "")).filter(Boolean);
  if (rawLabels.some((label) => label === target || label === norm(wanted))) return 0;
  const named = [permit.city, permit.jurisdiction].map((value) => (value ? knownCityIn(value) : null)).filter((value): value is string => !!value);
  if (named.some((city) => city === target)) return 0;
  if (!resolved) return 1;
  if (!named.length) return 1;
  return 2;
}

function zip5(value: string | null | undefined): string | null {
  return value?.match(/\d{5}/)?.[0] ?? null;
}

function permitInCounty(
  permit: { city?: string | null; jurisdiction?: string | null; county?: string | null },
  county: string,
): boolean {
  const wanted = normalizePlace(county.replace(/\s+county$/i, ""));
  if (!wanted) return false;
  const fields = [permit.county, permit.jurisdiction, permit.city].filter((value): value is string => !!value?.trim());
  if (fields.some((field) => {
    const place = normalizePlace(field);
    return place === wanted || place === `${wanted} county`;
  })) return true;
  if (wanted === "polk" && fields.some((field) => isPolkCity(field) || isPolkCity(field.replace(/^city of\s+/i, "")))) return true;
  return false;
}

/** ZIP or county agrees, or the row does not say it is somewhere else. */
export function placeKeeps(
  permit: { city?: string | null; jurisdiction?: string | null; zip?: string | null; county?: string | null },
  query: { zip?: string | null; county?: string | null },
): boolean {
  const zip = zip5(query.zip);
  const permitZip = zip5(permit.zip);
  const county = query.county?.trim() ?? "";
  if (zip && permitZip && zip === permitZip) return true;
  if (county && permitInCounty(permit, county)) return true;
  if (!zip && !county) return true;
  if (county && !permit.city && !permit.jurisdiction && !permit.county && !permitZip) return true;
  if (zip && !permitZip && !county) return true;
  return false;
}

/**
 * Street matches stay. A permitting city drops other cities when it has any
 * match. An unofficial place, or a city filter that would drop every row,
 * keeps ZIP/county matches instead of returning nothing.
 */
export function selectPermitsByCity<T extends { city?: string | null; jurisdiction?: string | null; zip?: string | null; county?: string | null }>(
  permits: T[],
  query: { city?: string | null; zip?: string | null; county?: string | null; broaden?: boolean },
): T[] {
  if (!query.city?.trim() || query.broaden) return permits;
  const resolved = hardCity(query.city);
  if (resolved) {
    const matched = permits.filter((permit) => cityPreference(resolved, permit) < 2);
    if (matched.length) return matched;
  }
  if (query.county || query.zip) {
    const placed = permits.filter((permit) => placeKeeps(permit, query));
    if (placed.length) return placed;
  }
  return permits;
}

const UNIT_LABEL: Record<string, string> = { APT: "Apt", APARTMENT: "Apt", UNIT: "Unit", STE: "Suite", SUITE: "Suite" };

/** Pull a trailing Apt/Unit/Suite off a street line. The street sent to PermitStack stays without it. */
export function splitStreetUnit(line: string): { street: string; unitType: string | null; unitNumber: string | null } {
  const match = line.trim().match(/^(.*?)(?:\s+)(APT|APARTMENT|UNIT|STE|SUITE)\.?\s+([A-Z0-9-]+)\s*$/i);
  if (!match) return { street: line.trim(), unitType: null, unitNumber: null };
  return { street: match[1].trim(), unitType: UNIT_LABEL[match[2].toUpperCase()] ?? "Unit", unitNumber: match[3] };
}
