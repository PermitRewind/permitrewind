import { CITY_SUGGESTIONS, trailingKnownCity } from "./jurisdictions";

/**
 * Address lookup variants. Nominatim and permit rows store the same road as
 * "NE" or "Northeast", and as "St" or "Street". A compound street is the same
 * road with or without a space ("WhiteDove" / "White Dove", "OakRidge" /
 * "Oak Ridge"). Callers search the expanded form, the raw input, and the
 * abbreviated form before near-matches: a trailing s on a street name
 * ("Kings" / "King") and a small city typo ("Lakland" / "Lakeland", "Bartw" /
 * "Bartow").
 *
 * PermitStack's own query string still goes through `toPermitStackAddress`.
 */

export const ADDRESS_SUGGEST_MIN_CHARS = 3;
export const ADDRESS_SUGGEST_DEBOUNCE_MS = 350;
export const ADDRESS_SUGGEST_LIMIT = 10;

/** Short token → full word. Compounds (ne, sw) are listed before single letters. */
const DIRECTIONAL_EXPAND: Record<string, string> = {
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ft: "fort",
};

const STREET_TYPE_EXPAND: Record<string, string> = {
  st: "street",
  ave: "avenue",
  av: "avenue",
  blvd: "boulevard",
  dr: "drive",
  rd: "road",
  ln: "lane",
  ct: "court",
  pl: "place",
  cir: "circle",
  hwy: "highway",
  pkwy: "parkway",
  pkway: "parkway",
  ter: "terrace",
  terr: "terrace",
  trl: "trail",
  cv: "cove",
  pt: "point",
  sq: "square",
  plz: "plaza",
  xing: "crossing",
  aly: "alley",
  rte: "route",
  expy: "expressway",
  fwy: "freeway",
};

const DIRECTIONAL_ABBREV: Record<string, string> = {
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  fort: "ft",
};

/**
 * Compass quadrants only. Fort is a place word ("Fort King"), not a quadrant.
 * Spelled-out compounds and two-word forms ("South East") share one abbrev.
 */
const COMPASS_TO_ABBREV: Record<string, string> = {
  n: "N",
  north: "N",
  s: "S",
  south: "S",
  e: "E",
  east: "E",
  w: "W",
  west: "W",
  ne: "NE",
  northeast: "NE",
  nw: "NW",
  northwest: "NW",
  se: "SE",
  southeast: "SE",
  sw: "SW",
  southwest: "SW",
};

const COMPASS_PAIRS: Record<string, string> = {
  "n e": "NE",
  "north east": "NE",
  "n w": "NW",
  "north west": "NW",
  "s e": "SE",
  "south east": "SE",
  "s w": "SW",
  "south west": "SW",
};

const COMPASS_FULL: Record<string, string> = {
  N: "North",
  S: "South",
  E: "East",
  W: "West",
  NE: "Northeast",
  NW: "Northwest",
  SE: "Southeast",
  SW: "Southwest",
};

function compassKey(token: string): string {
  return token.toLowerCase().replace(/[^a-z]/g, "");
}

/** "Southeast", "SE", and "S.E." are the quadrant SE. Fort and street suffixes are not. */
export function compassAbbrev(token: string): string | null {
  return COMPASS_TO_ABBREV[compassKey(token)] ?? null;
}

/**
 * Letter case is not part of an address. Every compare of address text goes
 * through `sameAddressCase`. A line we echo back, because the map did not
 * standardize it, goes through `canonicalAddressCase` so any mix of upper
 * and lower case is one label.
 */
export function foldAddressCase(value: string): string {
  return value.trim().toLowerCase();
}

/** True when both strings are the same address text aside from letter case. */
export function sameAddressCase(a: string, b: string): boolean {
  return foldAddressCase(a) === foldAddressCase(b);
}

/**
 * One display spelling for a letter mix. Compass abbreviations stay uppercase
 * ("SE", "se", and "Se" are "SE"). A letter glued to a house number stays an
 * ordinal or a lot letter ("1ST" is "1st", "12a" is "12A"). Every other word
 * is capitalized ("SOUTHEAST" and "southeast" are "Southeast"; "WHITEDOVE"
 * and "WhiteDove" are "Whitedove").
 */
export function canonicalAddressCase(value: string): string {
  return value.replace(/[A-Za-z]+/g, (word: string, offset: number, whole: string) => {
    const lower = word.toLowerCase();
    const prev = offset > 0 ? whole[offset - 1] : "";
    if (/\d/.test(prev)) return lower.length === 1 ? lower.toUpperCase() : lower;
    const abbrev = compassAbbrev(word);
    if (abbrev && abbrev.toLowerCase() === lower) return abbrev;
    if (lower.length === 1) return lower.toUpperCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

/** "South" + "East" is SE. "South" + "Central" is not a quadrant. */
export function compassPairAbbrev(a: string, b: string): string | null {
  return COMPASS_PAIRS[`${compassKey(a)} ${compassKey(b)}`] ?? null;
}

/** Canonical abbrev back to the spelled quadrant: "SE" → "Southeast". */
export function compassFull(abbrev: string): string | null {
  return COMPASS_FULL[abbrev.toUpperCase()] ?? null;
}

const STREET_TYPE_ABBREV: Record<string, string> = {
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  drive: "dr",
  road: "rd",
  lane: "ln",
  court: "ct",
  place: "pl",
  circle: "cir",
  highway: "hwy",
  parkway: "pkwy",
  terrace: "ter",
  trail: "trl",
  cove: "cv",
  point: "pt",
  square: "sq",
  plaza: "plz",
  crossing: "xing",
  alley: "aly",
  route: "rte",
  expressway: "expy",
  freeway: "fwy",
};

/** Cities whose names contain St / Fort. Masked so they are not rewritten. */
const PROTECTED_PLACES = [
  ...CITY_SUGGESTIONS,
  "St. Augustine",
  "St. Augustine Beach",
  "St. Pete Beach",
  "St. Marks",
  "Port St. Joe",
  "St. James City",
];

const HIGHLIGHT_SKIP = new Set(["fl", "florida"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Chunk {
  value: string;
  word: boolean;
}

function chunksOf(input: string): Chunk[] {
  const chunks: Chunk[] = [];
  const re = /[a-z0-9]+|[^a-z0-9]+/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    chunks.push({ value: match[0], word: /^[a-z0-9]+$/i.test(match[0]) });
  }
  return chunks;
}

function isStreetType(word: string): boolean {
  return word in STREET_TYPE_EXPAND || word in STREET_TYPE_ABBREV;
}

function maskPlaces(input: string): { text: string; places: string[] } {
  const places = [...PROTECTED_PLACES].sort((a, b) => b.length - a.length);
  let text = input;
  const found: string[] = [];
  for (const place of places) {
    const parts = place.toLowerCase().replace(/\./g, "").split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (!parts.length) continue;
    const re = new RegExp(`\\b${parts.join("\\.?\\s+")}\\b`, "gi");
    text = text.replace(re, (match) => {
      const token = `placehold${found.length}placehold`;
      found.push(match.replace(/\s+/g, " ").trim());
      return token;
    });
  }
  return { text, places: found };
}

function unmaskPlaces(text: string, places: string[]): string {
  return text.replace(/placehold(\d+)placehold/g, (_, n: string) => places[Number(n)] ?? "");
}

function prepare(query: string): { chunks: Chunk[]; words: string[]; places: string[] } {
  const lowered = query.toLowerCase().replace(/\s+/g, " ").trim();
  const masked = maskPlaces(lowered);
  const chunks = chunksOf(masked.text.replace(/\./g, ""));
  const words = chunks.filter((chunk) => chunk.word).map((chunk) => chunk.value.toLowerCase());
  return { chunks, words, places: masked.places };
}

function finish(chunks: Chunk[], places: string[]): string {
  return unmaskPlaces(chunks.map((chunk) => chunk.value).join(""), places).replace(/\s+/g, " ").trim();
}

/**
 * Lowercase, then expand directionals and street types at word boundaries.
 * "123 NE Main St" → "123 northeast main street".
 * A leading "St" that is followed by another street type stays put (St Joseph St).
 */
export function expandAddress(query: string): string {
  const { chunks, words, places } = prepare(query);
  let lastStreet = -1;
  words.forEach((word, index) => {
    if (isStreetType(word)) lastStreet = index;
  });
  let wordIndex = 0;
  for (const chunk of chunks) {
    if (!chunk.word) continue;
    const word = words[wordIndex];
    const directional = DIRECTIONAL_EXPAND[word];
    if (directional) chunk.value = directional;
    wordIndex += 1;
  }
  wordIndex = 0;
  for (const chunk of chunks) {
    if (!chunk.word) continue;
    const word = words[wordIndex];
    const full = STREET_TYPE_EXPAND[word];
    if (full && !(word === "st" && wordIndex !== lastStreet)) chunk.value = full;
    wordIndex += 1;
  }
  return finish(chunks, places);
}

/** Full words back to the short forms stored on many permit rows. */
export function abbreviateAddress(query: string): string {
  const { chunks, places } = prepare(query);
  for (const chunk of chunks) {
    if (!chunk.word) continue;
    const word = chunk.value.toLowerCase();
    chunk.value = DIRECTIONAL_ABBREV[word] ?? STREET_TYPE_ABBREV[word] ?? word;
  }
  return finish(chunks, places);
}

const STREET_OR_DIRECTION = new Set([
  ...Object.keys(DIRECTIONAL_EXPAND),
  ...Object.keys(DIRECTIONAL_ABBREV),
  ...Object.keys(STREET_TYPE_EXPAND),
  ...Object.keys(STREET_TYPE_ABBREV),
  "fl",
  "florida",
  "city",
]);

/** Second halves of compound street names. Longer tails win (creek before ee). */
const COMPOUND_TAILS = [
  "beach", "bridge", "brook", "crest", "creek", "dale", "dove", "field", "ford",
  "gate", "glen", "grove", "haven", "hill", "hollow", "hurst", "lake", "land",
  "meadow", "mont", "park", "point", "ridge", "shore", "side", "spring", "stone",
  "view", "water", "wood",
].sort((a, b) => b.length - a.length);

/**
 * Street types Nominatim often needs after a house number and street name.
 * Full words are tried first. Abbreviations are the same roads, not extra places.
 */
export const STREET_TYPE_FALLBACKS: { full: string; abbrev: string }[] = [
  { full: "drive", abbrev: "dr" },
  { full: "street", abbrev: "st" },
  { full: "circle", abbrev: "cir" },
  { full: "road", abbrev: "rd" },
  { full: "lane", abbrev: "ln" },
  { full: "court", abbrev: "ct" },
  { full: "avenue", abbrev: "ave" },
  { full: "place", abbrev: "pl" },
];

/**
 * Extra map queries after the unsuffixed plan misses.
 * A single spelling uses eight full types and eight abbreviations.
 * A compound spelling uses the full types, then Drive/Street/Circle/Road
 * as abbreviations and as the other spacing, and stops at this cap.
 */
export const STREET_TYPE_FALLBACK_CAP = 16;

/** Suffixes parseAddressQuery accepts that the expand/abbrev maps do not list. */
const EXTRA_COMPLETE_STREET_TYPES = new Set(["way", "loop", "run", "path", "cr", "circl"]);

const COMPLETE_STREET_TYPE_TOKENS = new Set<string>([
  ...Object.keys(STREET_TYPE_EXPAND),
  ...Object.keys(STREET_TYPE_ABBREV),
  ...EXTRA_COMPLETE_STREET_TYPES,
]);

const INCOMPLETE_STREET_TYPE_PREFIXES = new Set<string>();
for (const token of COMPLETE_STREET_TYPE_TOKENS) {
  for (let len = 1; len < token.length && len <= 4; len++) {
    INCOMPLETE_STREET_TYPE_PREFIXES.add(token.slice(0, len));
  }
}
for (const token of COMPLETE_STREET_TYPE_TOKENS) INCOMPLETE_STREET_TYPE_PREFIXES.delete(token);
for (const tail of COMPOUND_TAILS) INCOMPLETE_STREET_TYPE_PREFIXES.delete(tail);

function streetTypeLetters(token: string): string {
  return token.toLowerCase().replace(/[^a-z]/g, "");
}

/** "Dr", "Drive", "Cir", and "Way" are finished street types. "D" and "Stre" are not. */
export function isCompleteStreetTypeToken(token: string): boolean {
  const letters = streetTypeLetters(token);
  return letters.length > 0 && COMPLETE_STREET_TYPE_TOKENS.has(letters);
}

/**
 * A trailing token the visitor has started but not finished: "D", "S", "C", "Stre", "Ci".
 * "Park" stays a name word. "Dr" and "SE" are finished and return false.
 */
export function isIncompleteStreetTypeToken(token: string): boolean {
  const letters = streetTypeLetters(token);
  if (!letters || letters.length > 4 || isCompleteStreetTypeToken(token)) return false;
  return INCOMPLETE_STREET_TYPE_PREFIXES.has(letters);
}

/** A real street-name word, not a house number, quadrant, or suffix fragment. */
export function isSubstantialStreetToken(token: string): boolean {
  const letters = streetTypeLetters(token);
  if (letters.length < 3) return false;
  if (compassAbbrev(token)) return false;
  if (isCompleteStreetTypeToken(token) || isIncompleteStreetTypeToken(token)) return false;
  return true;
}

function wordsOf(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

function isKnownCityWord(word: string): boolean {
  const norm = word.toLowerCase();
  return CITY_SUGGESTIONS.some((city) => city.toLowerCase() === norm);
}

/**
 * Split one street token into two words. Camel case wins ("WhiteDove"), then a
 * known tail ("whitedove" → white + dove, "oakridge" → oak + ridge).
 * Known city names are left whole so Lakeland is not "Lake Land".
 */
export function splitCompoundToken(word: string): [string, string] | null {
  const bare = word.replace(/[^A-Za-z0-9]/g, "");
  if (!bare || STREET_OR_DIRECTION.has(bare.toLowerCase()) || isKnownCityWord(bare)) return null;
  const camel = bare.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (camel !== bare && camel.includes(" ")) {
    const parts = camel.split(" ");
    if (parts.length === 2 && parts.every((part) => part.length >= 3)) return [parts[0], parts[1]];
  }
  const lower = bare.toLowerCase();
  for (const tail of COMPOUND_TAILS) {
    if (!lower.endsWith(tail)) continue;
    const head = lower.slice(0, lower.length - tail.length);
    if (head.length >= 3) return [head, tail];
  }
  return null;
}

/** Spaced and joined spellings of one street name. "White Dove" and "WhiteDove" are one road. */
export function streetNameForms(streetName: string): string[] {
  const words = streetName.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const forms: string[] = [];
  const seen = new Set<string>();
  const add = (parts: string[]) => {
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    forms.push(text);
  };
  add(words);
  if (words.length === 1) {
    const split = splitCompoundToken(words[0]);
    if (split) add(split);
  } else if (
    words.length === 2 &&
    words.every((word) => !STREET_OR_DIRECTION.has(word.toLowerCase()) && !isKnownCityWord(word))
  ) {
    add([words[0] + words[1]]);
  } else {
    for (let i = 0; i < words.length - 1; i++) {
      const tail = words[i + 1].toLowerCase();
      if (STREET_OR_DIRECTION.has(words[i].toLowerCase()) || STREET_OR_DIRECTION.has(tail)) continue;
      if (isKnownCityWord(words[i]) || isKnownCityWord(words[i + 1])) continue;
      if (!COMPOUND_TAILS.includes(tail)) continue;
      add([...words.slice(0, i), words[i] + words[i + 1], ...words.slice(i + 2)]);
    }
  }
  return forms;
}

/**
 * The same street name with the space removed or inserted.
 * House numbers and suffixes are ignored so "3938 White Dove Dr" matches "WHITEDOVE".
 * "White Dover" does not match "White Dove".
 */
export function streetNamesMatch(a: string, b: string): boolean {
  const significant = (value: string) => wordsOf(value).filter((word, index, all) => {
    if (index === 0 && /^\d/.test(word) && all.length > 1) return false;
    return !STREET_OR_DIRECTION.has(word);
  });
  const left = significant(a);
  const right = significant(b);
  if (!left.length || !right.length) return false;
  const collapse = (words: string[]) => words.join("");
  if (collapse(left) === collapse(right)) return true;
  const [shorter, longer] = collapse(left).length <= collapse(right).length ? [left, right] : [right, left];
  const target = collapse(shorter);
  let acc = "";
  for (const token of longer) {
    acc += token;
    if (acc === target) return true;
  }
  return false;
}

function queryTokens(query: string): string[] {
  return query.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
}

function nameTokenIndexes(tokens: string[]): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const bare = tokens[index].replace(/[^A-Za-z0-9]/g, "");
    if (tokens[index].includes(",")) break;
    if (!bare || /^\d/.test(bare) || STREET_OR_DIRECTION.has(bare.toLowerCase()) || isKnownCityWord(bare)) continue;
    indexes.push(index);
  }
  return indexes;
}

/** Other spacing of a compound street, for geocoder and permit queries. */
export function compoundAddressVariants(query: string): string[] {
  const tokens = queryTokens(query);
  const names = nameTokenIndexes(tokens);
  const variants: string[] = [];
  const seen = new Set<string>();
  const add = (next: string[]) => {
    const text = next.join(" ").replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key) || key === query.trim().toLowerCase().replace(/\s+/g, " ")) return;
    seen.add(key);
    variants.push(text);
  };
  names.forEach((index) => {
    if (tokens[index + 1]?.replace(/[^A-Za-z]/g, "").toLowerCase() === "city") return;
    const split = splitCompoundToken(tokens[index]);
    if (!split) return;
    const next = tokens.slice();
    next[index] = split.join(" ");
    add(next);
  });
  if (names.length === 2) {
    const [first, second] = names;
    if (second === first + 1) {
      const next = tokens.slice();
      next.splice(first, 2, tokens[first].replace(/[^A-Za-z0-9]/g, "") + tokens[second].replace(/[^A-Za-z0-9]/g, ""));
      add(next);
    }
  }
  for (let i = 0; i < names.length - 1; i++) {
    const left = names[i];
    const right = names[i + 1];
    if (right !== left + 1) continue;
    const tail = tokens[right].replace(/[^A-Za-z]/g, "").toLowerCase();
    if (!COMPOUND_TAILS.includes(tail)) continue;
    const next = tokens.slice();
    next.splice(left, 2, tokens[left].replace(/[^A-Za-z0-9]/g, "") + tokens[right].replace(/[^A-Za-z0-9]/g, ""));
    add(next);
  }
  return variants;
}

const CITY_MATCHES = [...new Set(CITY_SUGGESTIONS)]
  .map((name) => ({ name, norm: normCity(name) }))
  .filter((city) => city.norm.length >= 4);

function normCity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Drop a trailing s so "kings" and "king", and "aves" and "ave", compare equal. */
export function stemTrailingS(token: string): string {
  const word = token.toLowerCase();
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Edit distance with an early exit once the caller’s limit is exceeded. */
export function levenshtein(a: string, b: string, limit = 2): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > limit) return limit + 1;
  if (!n) return m;
  if (!m) return n;
  let prev = Array.from({ length: m + 1 }, (_, index) => index);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const val = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[m];
}

function isIndel(a: string, b: string): boolean {
  if (a === b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.length - shorter.length !== 1) return false;
  let index = 0;
  while (index < shorter.length && shorter[index] === longer[index]) index += 1;
  return shorter.slice(index) === longer.slice(index + 1);
}

function isSubsequence(shorter: string, longer: string): boolean {
  let index = 0;
  for (let cursor = 0; cursor < longer.length && index < shorter.length; cursor++) {
    if (shorter[index] === longer[cursor]) index += 1;
  }
  return index === shorter.length;
}

/**
 * A near city edit, not a different name. Inserting or deleting one character
 * is enough for Lakland/Lakeland and Bartw/Bartow. A substitution has to be on
 * a longer name so Barton does not become Bartow.
 */
function cityEditOk(typed: string, city: string, dist: number): boolean {
  if (dist <= 0 || dist > 2) return false;
  const shorterLen = Math.min(typed.length, city.length);
  const longerLen = Math.max(typed.length, city.length);
  const [shorter, longer] = typed.length <= city.length ? [typed, city] : [city, typed];
  if (dist === 1 && shorterLen >= 5 && isIndel(typed, city)) return true;
  if (dist === 1 && shorterLen >= 8 && typed.length === city.length && typed.slice(0, 4) === city.slice(0, 4)) return true;
  if (
    dist === 2 &&
    shorterLen >= 6 &&
    longerLen - shorterLen === 2 &&
    typed.slice(0, 3) === city.slice(0, 3) &&
    isSubsequence(shorter, longer)
  ) {
    return true;
  }
  return false;
}

function exactCityName(phrase: string): string | null {
  const norm = normCity(phrase);
  if (!norm) return null;
  return CITY_MATCHES.find((city) => city.norm === norm)?.name ?? null;
}

function localityPhraseSkippable(phrase: string): boolean {
  const parts = normCity(phrase).split(" ").filter(Boolean);
  return parts.length > 0 && parts.every((part) => STREET_OR_DIRECTION.has(part) || /^\d+$/.test(part));
}

/** Unique known city within a small edit of `phrase`, or null when it is exact, tied, or too far. */
export function fuzzyKnownCity(phrase: string): string | null {
  const typed = normCity(phrase);
  if (typed.length < 5 || !/[a-z]/.test(typed) || exactCityName(phrase)) return null;
  let best: { name: string; dist: number } | null = null;
  let ties = 0;
  for (const city of CITY_MATCHES) {
    if (city.norm[0] !== typed[0] || Math.abs(city.norm.length - typed.length) > 2) continue;
    const dist = levenshtein(typed, city.norm, 2);
    if (!cityEditOk(typed, city.norm, dist)) continue;
    if (!best || dist < best.dist) {
      best = { name: city.name, dist };
      ties = 1;
    } else if (dist === best.dist && city.name !== best.name) {
      ties += 1;
    }
  }
  return best && ties === 1 ? best.name : null;
}

function peelStateZip(tokens: string[]): number {
  let end = tokens.length;
  while (end > 0) {
    const bare = tokens[end - 1].replace(/[.,]/g, "");
    if (/^\d{5}(?:-\d{4})?$/.test(bare) || /^(fl|florida)$/i.test(bare)) {
      end -= 1;
      continue;
    }
    break;
  }
  return end;
}

/**
 * City the visitor meant. Exact trailing cities win. Otherwise a unique near
 * miss at the end of the line (Lakland → Lakeland, Bartw → Bartow).
 */
export function intendedCity(query: string): string | null {
  const known = trailingKnownCity(query);
  if (known) return known;
  const tokens = query.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const end = peelStateZip(tokens);
  const max = Math.min(3, end);
  for (let len = max; len >= 1; len--) {
    const phrase = tokens.slice(end - len, end).join(" ");
    if (localityPhraseSkippable(phrase)) continue;
    const city = fuzzyKnownCity(phrase);
    if (city) return city;
  }
  return null;
}

/** Query with a mistyped trailing city replaced. Null when the city is already exact or unknown. */
export function correctFuzzyCity(query: string): string | null {
  const tokens = query.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const end = peelStateZip(tokens);
  const max = Math.min(3, end);
  for (let len = max; len >= 1; len--) {
    const phrase = tokens.slice(end - len, end).join(" ");
    if (!localityPhraseSkippable(phrase) && exactCityName(phrase)) return null;
  }
  for (let len = max; len >= 1; len--) {
    const phrase = tokens.slice(end - len, end).join(" ");
    if (localityPhraseSkippable(phrase)) continue;
    const city = fuzzyKnownCity(phrase);
    if (!city) continue;
    return [...tokens.slice(0, end - len), city, ...tokens.slice(end)].join(" ");
  }
  return null;
}

export function citiesNear(a: string, b: string): boolean {
  const left = normCity(a);
  const right = normCity(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return cityEditOk(left, right, levenshtein(left, right, 2));
}

/** Street-name tokens are close: same stem, or a 1–2 character indel on a long token. */
export function tokensNear(a: string, b: string): boolean {
  const left = stemTrailingS(a);
  const right = stemTrailingS(b);
  if (left === right && left.length >= 3) return true;
  if (left.length < 5 || right.length < 5 || left[0] !== right[0]) return false;
  return cityEditOk(left, right, levenshtein(left, right, 2));
}

function localityWordCount(words: string[]): number {
  const max = Math.min(3, words.length);
  for (let len = max; len >= 1; len--) {
    const slice = words.slice(words.length - len);
    if (slice.some((word) => word.startsWith("placehold"))) {
      if (slice.length === 1) return 1;
      continue;
    }
    const phrase = slice.join(" ");
    if (localityPhraseSkippable(phrase)) continue;
    if (exactCityName(phrase) || fuzzyKnownCity(phrase)) return len;
  }
  return 0;
}

function streetNameIndexes(words: string[]): number[] {
  const limit = words.length - localityWordCount(words);
  const indexes: number[] = [];
  for (let index = 0; index < limit; index++) {
    const word = words[index];
    if (word.startsWith("placehold") || /^\d/.test(word) || STREET_OR_DIRECTION.has(word) || word.length <= 3) continue;
    indexes.push(index);
  }
  return indexes;
}

function rewriteWords(query: string, edits: Map<number, string>): string | null {
  if (!edits.size) return null;
  const { chunks, places } = prepare(query);
  let wordIndex = 0;
  let changed = false;
  for (const chunk of chunks) {
    if (!chunk.word) continue;
    const next = edits.get(wordIndex);
    if (next && next !== chunk.value.toLowerCase()) {
      chunk.value = next;
      changed = true;
    }
    wordIndex += 1;
  }
  return changed ? finish(chunks, places) : null;
}

/** "1221 Kings avenue Lakeland" → "1221 king avenue lakeland". Null when nothing changes. */
export function stemStreetTokens(query: string): string | null {
  const { words } = prepare(query);
  const edits = new Map<number, string>();
  for (const index of streetNameIndexes(words)) {
    const stemmed = stemTrailingS(words[index]);
    if (stemmed !== words[index]) edits.set(index, stemmed);
  }
  return rewriteWords(query, edits);
}

/** Last street-name token gains an s so "King" can find "Kings" after the exact queries miss. */
export function pluralizeStreetToken(query: string): string | null {
  const { words } = prepare(query);
  const index = streetNameIndexes(words).filter((item) => !words[item].endsWith("s")).at(-1);
  if (index === undefined) return null;
  return rewriteWords(query, new Map([[index, `${words[index]}s`]]));
}

/**
 * 0 exact street-name token, 1 trailing-s stem, 2 other near edit, 3 not close.
 * Missing street names stay 0 so city ranking is unchanged.
 */
export function streetTokenRank(query: string, street: string): number {
  const { words } = prepare(query);
  const wanted = streetNameIndexes(words).map((index) => words[index]);
  const road = street.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token && !STREET_OR_DIRECTION.has(token) && !/^\d/.test(token));
  const limit = words.length - localityWordCount(words);
  const compoundWords = words.filter((word, index) => index < limit && !word.startsWith("placehold") && !/^\d/.test(word) && !STREET_OR_DIRECTION.has(word) && word.length >= 3);
  if (compoundWords.length && road.length && streetNamesMatch(compoundWords.join(" "), road.join(" "))) return 0;
  if (!wanted.length) return 0;
  const rankOf = (token: string) => {
    if (road.some((part) => part === token)) return 0;
    const stem = stemTrailingS(token);
    if (stem.length >= 3 && road.some((part) => stemTrailingS(part) === stem)) return 1;
    if (road.some((part) => tokensNear(token, part))) return 2;
    return 3;
  };
  return Math.max(...wanted.map(rankOf));
}

function pushVariant(variants: string[], seen: Set<string>, variant: string | null | undefined) {
  if (!variant) return;
  const cleaned = variant.replace(/\s+/g, " ").trim();
  const key = cleaned.toLowerCase();
  if (!key || seen.has(key)) return;
  seen.add(key);
  variants.push(cleaned);
}

function pushFuzzy(variants: string[], seen: Set<string>, variant: string | null) {
  if (!variant) return;
  pushVariant(variants, seen, variant);
  pushVariant(variants, seen, expandAddress(variant));
  pushVariant(variants, seen, abbreviateAddress(variant));
}

/**
 * Expanded, then the raw input, then abbreviated, then near-matches.
 * Near-matches drop a trailing s on street-name tokens, correct a trailing
 * city typo, and only then add an s. Case-insensitive duplicates drop out.
 */
export function addressQueryVariants(query: string): string[] {
  const original = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!original) return [];
  const seen = new Set<string>();
  const variants: string[] = [];
  const expanded = expandAddress(original);
  for (const variant of [expanded, original, abbreviateAddress(original)]) {
    pushVariant(variants, seen, variant);
  }
  for (const variant of [...variants]) {
    for (const alt of compoundAddressVariants(variant)) pushVariant(variants, seen, alt);
  }
  pushFuzzy(variants, seen, stemStreetTokens(expanded));
  const corrected = correctFuzzyCity(expanded) ?? correctFuzzyCity(original);
  if (corrected) {
    const correctedExpanded = expandAddress(corrected);
    pushFuzzy(variants, seen, correctedExpanded);
    pushFuzzy(variants, seen, stemStreetTokens(correctedExpanded));
  }
  pushFuzzy(variants, seen, pluralizeStreetToken(expanded));
  return variants;
}

function labelTokenMatches(text: string, forms: Set<string>): boolean {
  const lower = foldAddressCase(text);
  if (HIGHLIGHT_SKIP.has(lower)) return false;
  if (forms.has(lower) || forms.has(stemTrailingS(lower))) return true;
  for (const form of forms) {
    if (tokensNear(form, lower)) return true;
  }
  return false;
}

/** Split a suggestion label into match / plain pieces for the typed query. */
export function highlightAddressLabel(label: string, query: string): { text: string; match: boolean }[] {
  const forms = new Set<string>();
  for (const variant of [query, ...addressQueryVariants(query)]) {
    for (const token of foldAddressCase(variant).split(/[^a-z0-9]+/).filter(Boolean)) {
      if (HIGHLIGHT_SKIP.has(token)) continue;
      if (token.length === 1 && !(token in DIRECTIONAL_EXPAND) && !/^\d$/.test(token)) continue;
      forms.add(token);
      const stemmed = stemTrailingS(token);
      if (stemmed !== token) forms.add(stemmed);
      const split = splitCompoundToken(token);
      if (split) {
        forms.add(split[0].toLowerCase());
        forms.add(split[1].toLowerCase());
      }
    }
  }
  const typed = foldAddressCase(query).split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < typed.length - 1; i++) {
    if (STREET_OR_DIRECTION.has(typed[i]) || STREET_OR_DIRECTION.has(typed[i + 1])) continue;
    forms.add(typed[i] + typed[i + 1]);
  }
  return label.split(/([^A-Za-z0-9]+)/).filter((part) => part !== "").map((text) => ({
    text,
    match: labelTokenMatches(text, forms),
  }));
}
