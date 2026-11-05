import { CITY_SUGGESTIONS, trailingKnownCity } from "./jurisdictions";

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
  const city = trailingKnownCity(trimmed);
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
  return streetRemainder(raw, trailingKnownCity(raw));
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
  return {
    address,
    ...(parsed.city ? { city: parsed.city } : {}),
    ...(parsed.zip ? { zip: parsed.zip } : {}),
  };
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
  const flat = canonDirections(rowTokens).join("");
  const nameFlat = nameTokens.join("");
  if (!containsSequence(canonDirections(rowTokens), nameTokens) && !flat.includes(nameFlat)) return false;
  if (parsed.suffix) {
    const rowSuffix = suffixInLine(line);
    if (rowSuffix && !suffixEquivalents(parsed.suffix).includes(rowSuffix)) return false;
  }
  if (parsed.city && cityPreference(parsed.city, permit) >= 2) return false;
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
 * 0 = this city (or its "City of" jurisdiction), 1 = no city named, 2 = a different known city.
 * City is the primary rank, ahead of permit date.
 */
export function cityPreference(
  wanted: string | null | undefined,
  permit: { city?: string | null; jurisdiction?: string | null },
): number {
  if (!wanted?.trim()) return 0;
  const target = norm(wanted);
  const named = [permit.city, permit.jurisdiction].map((value) => (value ? knownCityIn(value) : null)).filter((value): value is string => !!value);
  if (named.some((city) => city === target)) return 0;
  if (!named.length) return 1;
  return 2;
}

const UNIT_LABEL: Record<string, string> = { APT: "Apt", APARTMENT: "Apt", UNIT: "Unit", STE: "Suite", SUITE: "Suite" };

/** Pull a trailing Apt/Unit/Suite off a street line. The street sent to PermitStack stays without it. */
export function splitStreetUnit(line: string): { street: string; unitType: string | null; unitNumber: string | null } {
  const match = line.trim().match(/^(.*?)(?:\s+)(APT|APARTMENT|UNIT|STE|SUITE)\.?\s+([A-Z0-9-]+)\s*$/i);
  if (!match) return { street: line.trim(), unitType: null, unitNumber: null };
  return { street: match[1].trim(), unitType: UNIT_LABEL[match[2].toUpperCase()] ?? "Unit", unitNumber: match[3] };
}
