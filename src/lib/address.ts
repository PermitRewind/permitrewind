import { trailingKnownCity } from "./jurisdictions";

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

/** PermitStack address param: house number + street name, suffix omitted so Cir/Circle/CR all match. */
export function toPermitStackAddress(parsed: ParsedAddress): { address: string; city?: string; zip?: string } {
  const street = [parsed.number, parsed.streetName].filter(Boolean).join(" ").trim();
  const address = parsed.streetName ? street : parsed.raw.trim();
  return {
    address,
    ...(parsed.city ? { city: parsed.city } : {}),
    ...(parsed.zip ? { zip: parsed.zip } : {}),
  };
}

function norm(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

/** Keep rows for the same house and street, including Cir/Circle/CR when that family was typed. */
export function permitAddressMatches(
  parsed: ParsedAddress,
  permit: { address?: string | null; city?: string | null },
): boolean {
  if (!parsed.streetName) return true;
  const row = parseAddressQuery(permit.address ?? "");
  if (!row.streetName) return false;
  if (parsed.number && row.number !== parsed.number) return false;
  if (norm(row.streetName) !== norm(parsed.streetName)) return false;
  if (parsed.suffix && row.suffix && !suffixEquivalents(parsed.suffix).includes(row.suffix)) return false;
  if (parsed.city && permit.city && norm(permit.city) !== norm(parsed.city)) return false;
  return true;
}
