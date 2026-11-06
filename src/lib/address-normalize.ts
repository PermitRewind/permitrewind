import { CITY_SUGGESTIONS } from "./jurisdictions";

/**
 * Address lookup variants. Nominatim and permit rows store the same road as
 * "NE" or "Northeast", and as "St" or "Street". Callers search the expanded
 * form, the raw input, and the abbreviated form.
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

/** Expanded, then the raw input, then abbreviated. Case-insensitive duplicates drop out. */
export function addressQueryVariants(query: string): string[] {
  const original = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!original) return [];
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const variant of [expandAddress(original), original, abbreviateAddress(original)]) {
    const key = variant.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    variants.push(variant);
  }
  return variants;
}

/** Split a suggestion label into match / plain pieces for the typed query. */
export function highlightAddressLabel(label: string, query: string): { text: string; match: boolean }[] {
  const forms = new Set<string>();
  for (const variant of [query, ...addressQueryVariants(query)]) {
    for (const token of variant.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      if (HIGHLIGHT_SKIP.has(token)) continue;
      if (token.length === 1 && !(token in DIRECTIONAL_EXPAND) && !/^\d$/.test(token)) continue;
      forms.add(token);
    }
  }
  return label.split(/([^A-Za-z0-9]+)/).filter((part) => part !== "").map((text) => ({
    text,
    match: forms.has(text.toLowerCase()),
  }));
}
