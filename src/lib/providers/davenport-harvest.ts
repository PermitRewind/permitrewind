import { promises as fs } from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { localityFromQuery, normalizePlace, trailingKnownCity } from "../jurisdictions";
import type { Permit } from "../types";

/**
 * City of Davenport (FL) iWorQ harvest.
 *
 * Live search on https://portal.iworq.net/DAVENPORT/permits/600 binds reCAPTCHA
 * to the solver's IP, so a server-side token usually comes back HTTP 302.
 * Detail pages work once the internal id is known. This cache is the address
 * lookup source: save the search (and detail) HTML from a real browser, then
 *   npx tsx scripts/ingest-davenport-harvest.ts search.html detail.html
 * and commit data/davenport-harvest.json. DAVENPORT_CAPTCHA_* is optional
 * after the address is in the cache.
 */
export const HARVEST_VERSION = 1 as const;
export const DAVENPORT_SOURCE = "City of Davenport";
export const DAVENPORT_PORTAL = "https://portal.iworq.net/DAVENPORT/permits/600";
export const HARVEST_PATH = path.join(process.cwd(), "data", "davenport-harvest.json");

const SUFFIXES = new Set([
  "DR", "DRIVE", "ST", "STREET", "AVE", "AVENUE", "RD", "ROAD", "LN", "LANE", "CT", "COURT",
  "BLVD", "BOULEVARD", "CIR", "CIRCLE", "WAY", "PL", "PLACE", "TER", "TERRACE", "TRL", "TRAIL",
  "PKWY", "PARKWAY", "HWY", "HIGHWAY", "LOOP", "RUN", "PATH", "PT", "CV", "XING", "SQ",
]);
const DIRS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "NORTH", "SOUTH", "EAST", "WEST"]);

export interface HarvestPermit {
  internalId: string;
  permitNumber: string;
  permitDate: string | null;
  dateIssued: string | null;
  dateCompleted: string | null;
  coIssued: string | null;
  status: string | null;
  applicantName: string | null;
  contractorName: string | null;
  address: string | null;
  city: string;
  state: string;
  zip: string | null;
  county: string;
  lot: string | null;
  description: string | null;
  estimatedValue: number | null;
  squareFootage: number | null;
  feeAmount: number | null;
  sourceUrl: string;
}

export interface HarvestFile {
  version: typeof HARVEST_VERSION;
  city: "Davenport";
  state: "FL";
  portal: string;
  /** Calendar day the permit rows last changed (YYYY-MM-DD). Unchanged reruns keep this. */
  updated: string;
  permits: HarvestPermit[];
  /** "1832|buckeye" -> internal ids. City and ZIP are matched loosely at lookup. */
  addressIndex: Record<string, string[]>;
}

export interface HarvestLookup {
  mode?: "address" | "parcel" | "permit";
  q: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

const PERMIT_KEYS = [
  "internalId", "permitNumber", "permitDate", "dateIssued", "dateCompleted", "coIssued", "status",
  "applicantName", "contractorName", "address", "city", "state", "zip", "county", "lot", "description",
  "estimatedValue", "squareFootage", "feeAmount", "sourceUrl",
] as const;

const memory = new Map<string, { mtimeMs: number; doc: HarvestFile }>();

export function emptyHarvest(updated = "1970-01-01"): HarvestFile {
  return {
    version: HARVEST_VERSION,
    city: "Davenport",
    state: "FL",
    portal: DAVENPORT_PORTAL,
    updated,
    permits: [],
    addressIndex: {},
  };
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function toIso(d?: string | null): string | null {
  if (!d) return null;
  const m = collapse(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Positive amounts only. Zero and blank portal fields stay null. */
function parseAmount(raw?: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").match(/(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").slice(0, 2).padEnd(2, "0"));
  if (!cents) return null;
  return cents / 100;
}

function zip5(v?: string | null): string | null {
  return (v ?? "").match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
}

export function isDavenportCity(name?: string | null): boolean {
  const n = normalizePlace(name ?? "");
  return n === "davenport" || n === "city of davenport";
}

/**
 * Loose street key: house number + core street name.
 * "1832 Buckeye Rd, Davenport, FL 33837" and "1832 BUCKEYE RD" both become "1832|buckeye".
 * Suffixes (Rd/Road), a trailing Davenport, and a trailing state/ZIP are ignored.
 * The city name is not stripped out of the street itself ("Davenport Rd" stays).
 */
export function harvestAddressKey(raw: string): string | null {
  let line = raw;
  const comma = line.indexOf(",");
  if (comma >= 0) line = line.slice(0, comma);
  line = line.replace(/[.#]/g, " ");
  line = line.replace(/\b\d{5}(?:-\d{4})?\b/g, " ");
  line = line.replace(/\b(?:FL|FLORIDA)\b/gi, " ");
  line = line.replace(/\b(?:APT|APARTMENT|UNIT|STE|SUITE)\b\.?\s*[A-Z0-9-]*/gi, " ");
  if (comma < 0) line = line.replace(/\s+(?:city\s+of\s+)?davenport\s*$/i, " ");
  const parts = collapse(line).toUpperCase().split(" ").filter(Boolean);
  if (!parts.length || !/^\d+$/.test(parts[0])) return null;
  const number = parts[0];
  let words = parts.slice(1);
  if (words.length > 1 && DIRS.has(words[0])) words = words.slice(1);
  if (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words = words.slice(0, -1);
  if (words.length > 1 && DIRS.has(words[words.length - 1])) words = words.slice(0, -1);
  const street = words.join(" ").trim();
  if (!street) return null;
  return `${number}|${street.toLowerCase()}`;
}

export function rebuildAddressIndex(permits: HarvestPermit[]): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const permit of permits) {
    if (!permit.address) continue;
    const key = harvestAddressKey(permit.address);
    if (!key) continue;
    const list = index[key] ?? [];
    if (!list.includes(permit.internalId)) list.push(permit.internalId);
    index[key] = list.sort();
  }
  return Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
}

function detailUrl(internalId: string): string {
  return `https://portal.iworq.net/DAVENPORT/permit/600/${internalId}`;
}

function blankPermit(internalId: string, permitNumber: string): HarvestPermit {
  return {
    internalId,
    permitNumber,
    permitDate: null,
    dateIssued: null,
    dateCompleted: null,
    coIssued: null,
    status: null,
    applicantName: null,
    contractorName: null,
    address: null,
    city: "Davenport",
    state: "FL",
    zip: null,
    county: "Polk",
    lot: null,
    description: null,
    estimatedValue: null,
    squareFootage: null,
    feeAmount: null,
    sourceUrl: detailUrl(internalId),
  };
}

/** Results table on a saved portal search page. One row per permit; mobile cards are ignored. */
export function parseSearchHtml(html: string): HarvestPermit[] {
  const $ = cheerio.load(html);
  const byId = new Map<string, HarvestPermit>();
  $("table.table tbody tr").each((_, tr) => {
    const fields = new Map<string, string>();
    let internalId: string | null = null;
    $(tr).find("th, td").each((__, cell) => {
      const el = $(cell);
      const label = el.attr("data-label")?.trim();
      if (label) fields.set(label, collapse(el.text()));
      const route = el.attr("data-route") ?? el.find("a[href*='/permit/']").attr("href") ?? "";
      const id = route.match(/\/permit\/\d+\/(\d+)/)?.[1];
      if (id) internalId = id;
    });
    const permitNumber = fields.get("Permit #")?.trim();
    if (!internalId || !permitNumber || /record number/i.test(permitNumber)) return;
    const row = blankPermit(internalId, permitNumber);
    row.permitDate = toIso(fields.get("Date"));
    row.contractorName = fields.get("Primary Contractor") || null;
    row.applicantName = fields.get("Applicant Name") || null;
    row.address = fields.get("Site Address") || null;
    row.lot = fields.get("Lot") || null;
    row.description = fields.get("Description") || null;
    row.estimatedValue = parseAmount(fields.get("Project Cost"));
    row.status = fields.get("Permit Status") || null;
    byId.set(internalId, row);
  });
  return [...byId.values()];
}

function rowValue($: cheerio.CheerioAPI, label: string): { text: string; title: string } | null {
  let found: { text: string; title: string } | null = null;
  $(".row").each((_, row) => {
    if (found) return;
    const cols = $(row).children().toArray().filter((el) => /\bcol\b/.test($(el).attr("class") ?? ""));
    if (cols.length < 2) return;
    const lab = collapse($(cols[0]).text()).replace(/:$/, "");
    if (lab !== label) return;
    const valueEl = $(cols[1]);
    found = { text: collapse(valueEl.text()), title: collapse(valueEl.attr("title") ?? "") };
  });
  return found;
}

function prefer(field: { text: string; title: string } | null, kind: "text" | "title" | "date" | "amount"): string | null {
  if (!field) return null;
  if (kind === "date") return field.title.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/) ? field.title : field.text || null;
  if (kind === "amount") return field.title || field.text || null;
  if (kind === "title") return field.title || field.text || null;
  return field.text || field.title || null;
}

function primaryContractor($: cheerio.CheerioAPI): string | null {
  const block = $(".contractor.primary > div").first();
  if (!block.length) return null;
  const text = collapse(block.contents().toArray().filter((node) => node.type === "text").map((node) => $(node).text()).join(" "));
  const name = text.split(/\s+-\s+/)[0]?.replace(/[\s,-]+$/, "").trim();
  return name || null;
}

/** Detail page for /DAVENPORT/permit/600/{internalId}. */
export function parseDetailHtml(html: string): HarvestPermit | null {
  const $ = cheerio.load(html);
  const number = prefer(rowValue($, "Permit Number"), "text");
  const internalId = html.match(/\/(?:permit|inspection-request)\/600\/(\d+)/)?.[1] ?? null;
  if (!number || !internalId) return null;
  const row = blankPermit(internalId, number);
  row.permitDate = toIso(prefer(rowValue($, "Permit Date"), "date"));
  row.dateIssued = toIso(prefer(rowValue($, "Issued Date"), "date"));
  row.dateCompleted = toIso(prefer(rowValue($, "Completion Date"), "date"));
  row.coIssued = toIso(prefer(rowValue($, "CO Issue Date"), "date"));
  row.applicantName = prefer(rowValue($, "Applicant Name"), "title");
  row.address = prefer(rowValue($, "Site Address"), "title");
  row.lot = prefer(rowValue($, "Lot"), "title");
  row.description = prefer(rowValue($, "Description"), "title");
  row.estimatedValue = parseAmount(prefer(rowValue($, "Project Cost"), "amount"));
  row.squareFootage = parseAmount(prefer(rowValue($, "Square Feet"), "amount"));
  row.status = prefer(rowValue($, "Permit Status"), "title");
  row.feeAmount = parseAmount(prefer(rowValue($, "Total Fees"), "text"));
  row.contractorName = primaryContractor($);
  return row;
}

export function htmlKind(html: string): "search" | "detail" | "both" | "unknown" {
  const search = /data-label=["']Permit #["']/i.test(html);
  const detail = /Permit Information\s*<\/h2>/i.test(html);
  if (search && detail) return "both";
  if (search) return "search";
  if (detail) return "detail";
  return "unknown";
}

function mergePermit(prev: HarvestPermit, incoming: HarvestPermit): HarvestPermit {
  const next: HarvestPermit = { ...prev };
  for (const key of PERMIT_KEYS) {
    const value = incoming[key];
    if (value == null || value === "") continue;
    (next[key] as HarvestPermit[typeof key]) = value;
  }
  next.city = "Davenport";
  next.state = "FL";
  next.county = "Polk";
  next.sourceUrl = detailUrl(next.internalId);
  return next;
}

export function upsertPermits(doc: HarvestFile, incoming: HarvestPermit[], today = new Date().toISOString().slice(0, 10)): HarvestFile {
  const byId = new Map(doc.permits.map((p) => [p.internalId, p]));
  let changed = doc.version !== HARVEST_VERSION;
  for (const row of incoming) {
    const prev = byId.get(row.internalId);
    const next = prev ? mergePermit(prev, row) : { ...row, sourceUrl: detailUrl(row.internalId) };
    if (!prev || JSON.stringify(orderPermit(prev)) !== JSON.stringify(orderPermit(next))) changed = true;
    byId.set(row.internalId, next);
  }
  const permits = [...byId.values()].sort((a, b) => a.internalId.localeCompare(b.internalId, undefined, { numeric: true }));
  return {
    version: HARVEST_VERSION,
    city: "Davenport",
    state: "FL",
    portal: DAVENPORT_PORTAL,
    updated: changed ? today : doc.updated,
    permits,
    addressIndex: rebuildAddressIndex(permits),
  };
}

function orderPermit(p: HarvestPermit): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PERMIT_KEYS) out[key] = p[key];
  return out;
}

export function serializeHarvest(doc: HarvestFile): string {
  const body = {
    version: HARVEST_VERSION,
    city: "Davenport" as const,
    state: "FL" as const,
    portal: DAVENPORT_PORTAL,
    updated: doc.updated,
    permits: doc.permits.map(orderPermit),
    addressIndex: doc.addressIndex,
  };
  return JSON.stringify(body, null, 2) + "\n";
}

export async function readHarvest(file: string): Promise<HarvestFile> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const doc = JSON.parse(raw) as HarvestFile;
    if (doc.version !== HARVEST_VERSION || !Array.isArray(doc.permits)) {
      throw new Error(`Unsupported Davenport harvest cache version in ${file}`);
    }
    return doc;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return emptyHarvest();
    throw e;
  }
}

export async function loadHarvest(file = HARVEST_PATH): Promise<HarvestFile> {
  let stat: { mtimeMs: number } | null = null;
  try {
    stat = await fs.stat(file);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return emptyHarvest();
    throw e;
  }
  const hit = memory.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.doc;
  const doc = await readHarvest(file);
  memory.set(file, { mtimeMs: stat.mtimeMs, doc });
  return doc;
}

export async function ingestHtmlFiles(paths: string[], outPath: string, today = new Date().toISOString().slice(0, 10)): Promise<HarvestFile> {
  let doc = await readHarvest(outPath);
  const searches: string[] = [];
  const details: string[] = [];
  for (const file of paths) {
    const html = await fs.readFile(file, "utf8");
    const kind = htmlKind(html);
    if (kind === "unknown") throw new Error(`Unrecognized Davenport iWorQ HTML: ${file}`);
    if (kind === "search" || kind === "both") searches.push(html);
    if (kind === "detail" || kind === "both") details.push(html);
  }
  const incoming: HarvestPermit[] = [];
  for (const html of searches) incoming.push(...parseSearchHtml(html));
  for (const html of details) {
    const row = parseDetailHtml(html);
    if (row) incoming.push(row);
  }
  if (paths.length > 0 && incoming.length === 0) throw new Error("No Davenport permits found in the saved HTML.");
  doc = upsertPermits(doc, incoming, today);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const body = serializeHarvest(doc);
  const previous = await fs.readFile(outPath, "utf8").catch(() => "");
  if (previous !== body) await fs.writeFile(outPath, body, "utf8");
  memory.delete(outPath);
  return doc;
}

function namedCity(query: HarvestLookup): string | null {
  const explicit = query.city?.trim();
  if (explicit) return explicit;
  return localityFromQuery(query.q) ?? trailingKnownCity(query.q);
}

/** Address hits from the cache. An empty or numberless address returns nothing. */
export function lookupHarvest(doc: HarvestFile, query: HarvestLookup): HarvestPermit[] {
  const q = query.q.trim();
  if (!q) return [];
  const mode = query.mode ?? "address";
  if (mode === "parcel") return [];
  if (mode === "permit") {
    const key = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return doc.permits.filter((p) => p.permitNumber.toUpperCase().replace(/[^A-Z0-9]/g, "") === key || p.internalId === q);
  }
  const city = namedCity(query);
  if (city && !isDavenportCity(city)) return [];
  const key = harvestAddressKey(q);
  if (!key) return [];
  const zip = zip5(query.zip) ?? zip5(q);
  const ids = doc.addressIndex[key] ?? [];
  const byId = new Map(doc.permits.map((p) => [p.internalId, p]));
  const hits: HarvestPermit[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    if (zip && row.zip && row.zip !== zip) continue;
    hits.push(row);
  }
  return hits;
}

export function toPermit(row: HarvestPermit): Permit {
  return {
    id: `davenport-iworq:${row.internalId}`,
    permitNumber: row.permitNumber,
    status: row.status,
    category: null,
    tags: [],
    description: row.description,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    county: row.county,
    parcelId: null,
    jurisdiction: "City of Davenport",
    dateFiled: row.permitDate,
    dateIssued: row.dateIssued,
    dateCompleted: row.dateCompleted,
    estimatedValue: row.estimatedValue,
    feeAmount: row.feeAmount,
    contractorName: row.contractorName,
    applicantName: row.applicantName,
    ownerName: null,
    propertyType: null,
    squareFootage: row.squareFootage,
    latitude: null,
    longitude: null,
    source: DAVENPORT_SOURCE,
    sourceUrl: row.sourceUrl,
  };
}
