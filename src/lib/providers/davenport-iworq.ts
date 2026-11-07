import "server-only";
import * as cheerio from "cheerio";
import type { PermitProvider } from "./types";
import { parseAddress } from "./polk-accela";
import { solveDavenportCaptcha, DAVENPORT_PORTAL_PAGE } from "./davenport-captcha";
import { loadHarvest, lookupHarvest, toPermit } from "./davenport-harvest";
import { foldAddressCase } from "../address-normalize";
import { localityFromQuery, trailingKnownCity } from "../jurisdictions";
import { Permit, ProviderError, SearchQuery, SearchResult } from "../types";

/**
 * City of Davenport building permits (iWorQ).
 *
 * Search (`/DAVENPORT/permits/600?searchField=text6&search=...`) is invisible
 * reCAPTCHA v2. A raw request without a token is HTTP 302 back to the form.
 * Detail pages (`/DAVENPORT/permit/600/{internalId}`) are public once the id
 * is known. 1832 Buckeye Road is internal id 15350875, permit 210405.
 *
 * Address search reads data/davenport-harvest.json first. A saved browser
 * capture (1832 Buckeye Rd → permit 210405) returns with captcha disabled.
 * DAVENPORT_CAPTCHA_* is optional once that address is in the cache.
 *
 * Addresses missing from the cache use a cached portal session when one is
 * still valid, and otherwise DAVENPORT_CAPTCHA_API_KEY (2captcha by default,
 * or anticaptcha). The key is never hardcoded. Without a key, a cache miss
 * returns a notice and the other providers still run.
 *
 * Refresh the cache: save search and detail HTML in a browser, then
 * `npx tsx scripts/ingest-davenport-harvest.ts <files...>` and commit the JSON.
 */

const ORIGIN = "https://portal.iworq.net";
const MODULE_ID = "600";
const SOURCE = "City of Davenport";
const UA = "Mozilla/5.0 (compatible; PermitRewind/1.0; +https://permitrewind.com)";
const SESSION_MS = 90 * 60 * 1000;
const DETAIL_LIMIT = 8;

export const DAVENPORT_CAPTCHA_NOTICE =
  "City of Davenport search needs DAVENPORT_CAPTCHA_API_KEY (2captcha or anticaptcha). The portal blocks address search without it. Detail pages stay public once a permit id is known.";

export function shouldSearchDavenport(query: { q: string; city?: string | null }): boolean {
  const city = query.city?.trim();
  if (city) return city.toLowerCase() === "davenport";
  const place = localityFromQuery(query.q) ?? trailingKnownCity(query.q);
  return place?.toLowerCase() === "davenport";
}

/** "1832 Buckeye Road" → "1832 Buckeye", the query the city portal accepts. */
export function davenportAddressQuery(raw: string): string {
  const { number, street } = parseAddress(raw);
  if (!street) return raw.trim();
  const name = street
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
  return [number, name].filter(Boolean).join(" ");
}

export function davenportPermitQuery(raw: string): string {
  return raw.replace(/^SFR[\s-]*/i, "").trim();
}

export function davenportDetailUrl(internalId: string): string {
  return `${ORIGIN}/DAVENPORT/permit/${MODULE_ID}/${internalId}`;
}

function toIso(d: string | null | undefined): string | null {
  const m = (d ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

function money(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function internalIdFrom(href: string | undefined): string | null {
  return href?.match(/\/permit\/600\/(\d+)/)?.[1] ?? null;
}

export interface DavenportListRow {
  internalId: string | null;
  permitNumber: string | null;
  permitDate: string | null;
  contractorName: string | null;
  applicantName: string | null;
  address: string | null;
  lot: string | null;
  description: string | null;
  estimatedValue: number | null;
  status: string | null;
}

export interface DavenportDetail {
  permitNumber: string | null;
  permitDate: string | null;
  issuedDate: string | null;
  completionDate: string | null;
  coIssueDate: string | null;
  status: string | null;
  estimatedValue: number | null;
  feeAmount: number | null;
  contractorName: string | null;
  otherContractors: string[];
  applicantName: string | null;
  address: string | null;
  lot: string | null;
  description: string | null;
}

function cellText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Parse the iWorQ results table. Cells are identified by data-label, not column index. */
export function parseDavenportList(html: string): DavenportListRow[] {
  const $ = cheerio.load(html);
  const rows: DavenportListRow[] = [];
  $("tr").each((_, tr) => {
    const fields = new Map<string, string>();
    let route: string | undefined;
    $(tr).find("[data-label]").each((__, el) => {
      const label = $(el).attr("data-label");
      if (!label || label === "Inspection") return;
      fields.set(label, cellText($(el).text()));
      route ??= $(el).attr("data-route") ?? $(el).find("a[href*='/permit/600/']").attr("href");
    });
    const permitNumber = fields.get("Permit #") || null;
    if (!permitNumber || permitNumber === "Permit #") return;
    route ??= $(tr).find("a[href*='/permit/600/']").attr("href");
    rows.push({
      internalId: internalIdFrom(route),
      permitNumber,
      permitDate: toIso(fields.get("Date")),
      contractorName: fields.get("Primary Contractor") || null,
      applicantName: fields.get("Applicant Name") || null,
      address: fields.get("Site Address") || null,
      lot: fields.get("Lot") || null,
      description: fields.get("Description") || null,
      estimatedValue: money(fields.get("Project Cost")),
      status: fields.get("Permit Status") || null,
    });
  });
  return rows;
}

/** Parse a public permit detail page. Issued and completion dates are the ones shown on results. */
export function parseDavenportDetail(html: string): DavenportDetail {
  const $ = cheerio.load(html);
  const fields = new Map<string, string>();
  $(".row").each((_, row) => {
    const cols = $(row).children(".col");
    if (cols.length < 2) return;
    const raw = cellText($(cols[0]).text());
    if (!raw.endsWith(":")) return;
    fields.set(raw.replace(/:$/, "").toLowerCase(), cellText($(cols[1]).text()));
  });
  const otherContractors: string[] = [];
  let contractorName: string | null = null;
  $(".contractor").each((_, el) => {
    const clone = $(el).clone();
    clone.find("em").remove();
    const line = cellText(clone.text());
    const name = line.split(" - ")[0]?.trim();
    if (!name) return;
    if ($(el).hasClass("primary") && !contractorName) contractorName = name;
    else otherContractors.push(name);
  });
  const pick = (label: string) => fields.get(label) || null;
  return {
    permitNumber: pick("permit number"),
    permitDate: toIso(pick("permit date")),
    issuedDate: toIso(pick("issued date")),
    completionDate: toIso(pick("completion date")),
    coIssueDate: toIso(pick("co issue date")),
    status: pick("permit status"),
    estimatedValue: money(pick("project cost")),
    feeAmount: money(pick("total fees")),
    contractorName,
    otherContractors,
    applicantName: pick("applicant name"),
    address: pick("site address"),
    lot: pick("lot"),
    description: pick("description"),
  };
}

function blankPermit(partial: Partial<Permit> & Pick<Permit, "id">): Permit {
  return {
    permitNumber: null,
    status: null,
    category: null,
    tags: [],
    description: null,
    address: null,
    city: "Davenport",
    state: "FL",
    zip: null,
    county: "Polk",
    parcelId: null,
    jurisdiction: "City of Davenport",
    dateFiled: null,
    dateIssued: null,
    dateCompleted: null,
    estimatedValue: null,
    contractorName: null,
    applicantName: null,
    ownerName: null,
    propertyType: null,
    latitude: null,
    longitude: null,
    source: SOURCE,
    ...partial,
  };
}

function permitFromRow(row: DavenportListRow): Permit {
  const id = row.internalId ? `davenport-iworq:${row.internalId}` : `davenport-iworq:num:${row.permitNumber}`;
  return blankPermit({
    id,
    permitNumber: row.permitNumber,
    status: row.status,
    description: row.description,
    address: row.address,
    dateFiled: row.permitDate,
    estimatedValue: row.estimatedValue,
    contractorName: row.contractorName,
    applicantName: row.applicantName,
    sourceUrl: row.internalId ? davenportDetailUrl(row.internalId) : null,
  });
}

function applyDetail(permit: Permit, detail: DavenportDetail): void {
  // List "Date" is the permit date. Issue and final come from the detail page.
  if (detail.permitDate) permit.dateFiled = detail.permitDate;
  if (detail.issuedDate) permit.dateIssued = detail.issuedDate;
  if (detail.completionDate) permit.dateCompleted = detail.completionDate;
  if (detail.status) permit.status = detail.status;
  if (detail.estimatedValue != null) permit.estimatedValue = detail.estimatedValue;
  if (detail.feeAmount != null) permit.feeAmount = detail.feeAmount;
  if (detail.contractorName) permit.contractorName = detail.contractorName;
  if (detail.applicantName) permit.applicantName = detail.applicantName;
  if (detail.address) permit.address = detail.address;
  if (detail.description) permit.description = detail.description;
  if (detail.permitNumber) permit.permitNumber = detail.permitNumber;
}

function addressKeeps(query: string, site: string | null): boolean {
  if (!site) return false;
  const { number, street } = parseAddress(query);
  const line = foldAddressCase(site);
  if (number && !new RegExp(`^${foldAddressCase(number)}\\b`).test(line)) return false;
  const token = street?.split(" ")[0];
  if (token && !line.includes(foldAddressCase(token))) return false;
  return true;
}

type FetchImpl = typeof fetch;

export class DavenportIworqProvider implements PermitProvider {
  name = SOURCE;
  private session: { cookie: string; until: number } | null = null;

  constructor(private opts?: { fetchImpl?: FetchImpl; solve?: () => Promise<string | null>; timeoutMs?: number }) {}

  appliesTo(query: SearchQuery): boolean {
    return shouldSearchDavenport(query);
  }

  private fetchImpl(): FetchImpl {
    return this.opts?.fetchImpl ?? fetch;
  }

  private async solve(): Promise<string | null> {
    if (this.opts && "solve" in this.opts) return (await this.opts.solve?.()) ?? null;
    return solveDavenportCaptcha(this.fetchImpl());
  }

  private async request(url: string, cookie?: string): Promise<{ status: number; html: string; cookie: string }> {
    const res = await this.fetchImpl()(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(this.opts?.timeoutMs ?? 12000),
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const next = cookie ? [cookie] : [];
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0];
      const key = kv.split("=")[0];
      const i = next.findIndex((x) => x.startsWith(key + "="));
      if (i >= 0) next[i] = kv;
      else next.push(kv);
    }
    if (res.status >= 500) throw new ProviderError(`City of Davenport portal returned HTTP ${res.status}`, 502);
    const html = res.status >= 300 && res.status < 400 ? "" : await res.text();
    return { status: res.status, html, cookie: next.join("; ") };
  }

  private searchUrl(query: SearchQuery, token?: string): string {
    const url = new URL(DAVENPORT_PORTAL_PAGE);
    if (query.mode === "permit") {
      url.searchParams.set("searchField", "permitnum_id");
      url.searchParams.set("search", davenportPermitQuery(query.q));
    } else if (query.mode === "parcel") {
      url.searchParams.set("searchField", "propertyparcel");
      url.searchParams.set("search", query.q.trim());
    } else {
      url.searchParams.set("searchField", "text6");
      url.searchParams.set("search", davenportAddressQuery(query.q));
    }
    if (token) url.searchParams.set("g-recaptcha-response", token);
    return url.toString();
  }

  /** Harvested rows for this address or permit number. Empty when the cache has no match. */
  private async fromHarvest(query: SearchQuery): Promise<Permit[]> {
    if (query.mode === "parcel") return [];
    try {
      const doc = await loadHarvest();
      return lookupHarvest(doc, query).map(toPermit);
    } catch (err) {
      console.error("Davenport harvest cache failed", err);
      return [];
    }
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const harvested = await this.fromHarvest(query);
    if (harvested.length) {
      return { permits: harvested, total: harvested.length, page: 1, perPage: harvested.length, notices: [] };
    }
    const empty = (notice: string): SearchResult => ({ permits: [], total: 0, page: 1, perPage: 0, notices: [notice] });
    const cookie = this.session && this.session.until > Date.now() ? this.session.cookie : undefined;
    let res = cookie ? await this.request(this.searchUrl(query), cookie) : null;
    if (!res || (res.status >= 300 && res.status < 400)) {
      const token = await this.solve();
      if (!token) return empty(DAVENPORT_CAPTCHA_NOTICE);
      res = await this.request(this.searchUrl(query, token), cookie);
      if (res.status >= 300 && res.status < 400) {
        return empty("City of Davenport portal did not accept the search. Other sources are shown.");
      }
    }
    if (res.cookie) this.session = { cookie: res.cookie, until: Date.now() + SESSION_MS };

    let rows = parseDavenportList(res.html);
    if (query.mode === "address") rows = rows.filter((row) => addressKeeps(query.q, row.address));
    const permits: Permit[] = [];
    for (const row of rows.slice(0, DETAIL_LIMIT)) {
      const permit = permitFromRow(row);
      if (row.internalId) {
        try {
          const detail = await this.request(davenportDetailUrl(row.internalId), res.cookie);
          if (detail.status === 200 && detail.html) applyDetail(permit, parseDavenportDetail(detail.html));
        } catch {
          // Keep the list row when the detail page is slow.
        }
      }
      permits.push(permit);
    }
    return { permits, total: permits.length, page: 1, perPage: permits.length, notices: [] };
  }

  async getPermit(id: string): Promise<Permit | null> {
    const internalId = id.startsWith("davenport-iworq:") ? id.slice("davenport-iworq:".length) : "";
    if (!/^\d+$/.test(internalId)) return null;
    const harvested = await this.fromHarvest({ mode: "permit", q: internalId });
    if (harvested[0]) return harvested[0];
    const res = await this.request(davenportDetailUrl(internalId));
    if (res.status === 404 || /Page Can Not Be Found/i.test(res.html)) return null;
    const detail = parseDavenportDetail(res.html);
    if (!detail.permitNumber) return null;
    const permit = blankPermit({
      id,
      permitNumber: detail.permitNumber,
      sourceUrl: davenportDetailUrl(internalId),
    });
    applyDetail(permit, detail);
    return permit;
  }
}
