import { compassAbbrev, compassFull, compassPairAbbrev, streetNameForms, streetNamesMatch, fuzzyKnownCity } from "./address-normalize";
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
  /** Leading compass abbrev (N, SE, …) when a real street word follows it. */
  preDirectional: string | null;
  /** Trailing compass abbrev when the map or the record puts the quadrant after the street. */
  postDirectional: string | null;
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

function letters(token: string): string {
  return token.toUpperCase().replace(/[^A-Z]/g, "");
}

function isSuffixWord(token: string): boolean {
  const key = letters(token);
  return key.length > 0 && SUFFIX_TO_GROUP.has(key);
}

/** A word that is neither a quadrant nor a suffix, so the directional is not the street name. */
function hasStreetCore(words: string[]): boolean {
  return words.some((word) => letters(word) && !compassAbbrev(word) && !isSuffixWord(word));
}

/** Any non-suffix word, including a compass word used as the street name ("North St"). */
function hasNameWord(words: string[]): boolean {
  return words.some((word) => letters(word) && !isSuffixWord(word));
}

function peelEdge(words: string[], edge: "start" | "end", keep: (rest: string[]) => boolean): { words: string[]; dir: string | null } {
  if (words.length < 2) return { words, dir: null };
  if (edge === "end") {
    const pair = compassPairAbbrev(words[words.length - 2], words[words.length - 1]);
    const pairRest = words.slice(0, -2);
    if (pair && keep(pairRest)) return { words: pairRest, dir: pair };
  } else {
    const pair = compassPairAbbrev(words[0], words[1]);
    const pairRest = words.slice(2);
    if (pair && keep(pairRest)) return { words: pairRest, dir: pair };
  }
  const token = edge === "end" ? words[words.length - 1] : words[0];
  const dir = compassAbbrev(token);
  const rest = edge === "end" ? words.slice(0, -1) : words.slice(1);
  if (dir && keep(rest)) return { words: rest, dir };
  return { words, dir: null };
}

/**
 * Parse a typed Florida address, including ones with no commas.
 * "3533 Sam Allen Oaks Cir Plant City" → number 3533, name Sam Allen Oaks, suffix CIR, city Plant City.
 * A compass word after the suffix ("Circle Southeast") or before the name ("SE Browning")
 * is a quadrant, not part of the street name. "North St" keeps North as the name.
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
  let preDirectional: string | null = null;
  let postDirectional: string | null = null;
  const take = (edge: "start" | "end", keep: (rest: string[]) => boolean) => {
    const peeled = peelEdge(rest, edge, keep);
    if (!peeled.dir) return;
    rest = peeled.words;
    if (edge === "start") preDirectional ??= peeled.dir;
    else postDirectional ??= peeled.dir;
  };
  // Quadrant after the suffix ("Circle Southeast", "Cir SE", "Circle South East").
  take("end", hasNameWord);
  // Quadrant before the name ("SE Browning", "South Central", "South East Browning").
  take("start", hasStreetCore);
  let suffix: string | null = null;
  if (rest.length) {
    const last = letters(rest[rest.length - 1]);
    if (last && SUFFIX_TO_GROUP.has(last) && rest.length > 1) {
      suffix = last;
      rest = rest.slice(0, -1);
    }
  }
  // Quadrant between the name and the suffix ("Browning SE Circle").
  take("end", hasNameWord);
  take("start", hasStreetCore);
  const streetName = rest.join(" ").trim() || null;
  return { raw: trimmed, number, streetName, suffix, preDirectional, postDirectional, city, zip };
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
  if (compassAbbrev(token) === upper) return upper;
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

function streetLine(number: string | null, dir: string | null, name: string, suffix: string | null): string {
  const pretty = name.split(/\s+/).filter(Boolean).map((part) => prettyToken(part)).join(" ");
  return [number, dir, pretty, suffix].filter(Boolean).join(" ");
}

/**
 * Address string for PermitStack's partial match.
 * Directions and suffixes are shortened (South → S, Southeast → SE, Avenue → Ave)
 * because stored rows are usually abbreviated. A trailing quadrant is left off this
 * primary line; `permitAddressQueries` also tries it in front of the street.
 * Cir/Circle/CR stays unsuffixed so all three match.
 * ZIP is returned for display only; sending it as zip_code ANDs away rows that omit it.
 */
export function toPermitStackAddress(parsed: ParsedAddress): { address: string; city?: string; zip?: string } {
  const address = !parsed.streetName
    ? parsed.raw.trim()
    : streetLine(parsed.number, parsed.preDirectional, parsed.streetName, expandsSuffix(parsed.suffix) ? null : shortSuffix(parsed.suffix));
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
  const lines = streetNameForms(parsed.streetName).map((name) => streetLine(parsed.number, parsed.preDirectional, name, suffix));
  const unique = [...new Set(lines)];
  return unique.length ? unique : [raw.trim()];
}

function pushQuery(lines: string[], seen: Set<string>, line: string | null | undefined) {
  const text = line?.replace(/\s+/g, " ").trim();
  if (!text) return;
  const key = text.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  lines.push(text);
}

/**
 * PermitStack address strings for this parse.
 * Compound names are queried both ways. A compass quadrant (before the name or
 * after the suffix, abbreviated or spelled) is also tried off the street and in
 * front of it, so "Circle Southeast" hits "BROWNING CIR" and "SE BROWNING CIR".
 */
export function permitAddressQueries(parsed: ParsedAddress): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  pushQuery(lines, seen, toPermitStackAddress(parsed).address);
  for (const line of addressStreetForms(parsed.raw)) pushQuery(lines, seen, line);
  const dirs = [...new Set([parsed.preDirectional, parsed.postDirectional].filter((dir): dir is string => !!dir))];
  if (dirs.length && parsed.streetName) {
    const natural = shortSuffix(parsed.suffix);
    const policy = expandsSuffix(parsed.suffix) ? null : natural;
    for (const name of streetNameForms(parsed.streetName)) {
      pushQuery(lines, seen, streetLine(parsed.number, null, name, policy));
      if (natural && natural !== policy) pushQuery(lines, seen, streetLine(parsed.number, null, name, natural));
      for (const dir of dirs) {
        const full = compassFull(dir);
        const withSuffix = natural ?? policy;
        pushQuery(lines, seen, streetLine(parsed.number, dir, name, withSuffix));
        if (full && full.toLowerCase() !== dir.toLowerCase()) pushQuery(lines, seen, streetLine(parsed.number, full, name, withSuffix));
        if ((natural ?? null) !== policy) {
          pushQuery(lines, seen, streetLine(parsed.number, dir, name, policy));
          if (full) pushQuery(lines, seen, streetLine(parsed.number, full, name, policy));
        }
      }
    }
  }
  return lines;
}

/**
 * A shorter address that is still a substring of both "S CENTRAL AVE" and
 * "SOUTH CENTRAL AVENUE". Used only after the abbreviated query misses.
 */
export function loosePermitStackAddress(parsed: ParsedAddress): string | null {
  if (!parsed.streetName) return null;
  const parts = tokens(parsed.streetName);
  const hadDirection = !!(parsed.preDirectional || parsed.postDirectional) || parts.some((part) => compassAbbrev(part));
  if (!hadDirection) return null;
  const core = parts.filter((part) => !compassAbbrev(part)).map((part) => prettyToken(part));
  return core.length ? core.join(" ") : null;
}

/**
 * Compass words at either end of a permit line. A compass word between other
 * name words stays part of the name.
 */
function rowQuadrants(parts: string[]): string[] {
  const body = parts[0] && /^\d/.test(parts[0]) ? parts.slice(1) : parts.slice();
  const dirs: string[] = [];
  while (body.length) {
    const dir = compassAbbrev(body[0]);
    if (!dir) break;
    dirs.push(dir);
    body.shift();
  }
  while (body.length) {
    const last = body[body.length - 1];
    const dir = compassAbbrev(last);
    if (!dir && !isSuffixWord(last)) break;
    if (dir) dirs.push(dir);
    body.pop();
  }
  return dirs;
}

/**
 * Same house and street name. Equivalent suffixes (Dr/Drive, Cir/Circle/CR) match.
 * A direction before or after the suffix still matches, including when the query
 * named that quadrant and the row omitted it. A different quadrant does not.
 * A different suffix family does not.
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
  const expected = [...new Set([parsed.preDirectional, parsed.postDirectional].filter((dir): dir is string => !!dir))];
  if (expected.length && rowQuadrants(rowTokens).some((dir) => !expected.includes(dir))) return false;
  if (parsed.suffix) {
    const rowSuffix = suffixInLine(line);
    if (rowSuffix && !suffixEquivalents(parsed.suffix).includes(rowSuffix)) return false;
  }
  if (resolvedCity && cityPreference(resolvedCity, permit) >= 2) return false;
  return true;
}

const DIR_FULL: Record<string, string> = {
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};

function canonDirections(parts: string[]): string[] {
  return parts.map((part) => DIR_FULL[part] ?? compassAbbrev(part) ?? part);
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
