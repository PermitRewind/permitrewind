import "server-only";
import * as cheerio from "cheerio";
import type { PermitProvider } from "./types";
import { addressStreetForms } from "../address";
import { shouldMergePolkSources } from "../jurisdictions";
import { Permit, ProviderError, SearchQuery, SearchResult } from "../types";

function mergeStreetForms(parts: SearchResult[]): SearchResult {
  const seen = new Set<string>();
  const permits: Permit[] = [];
  const notices: string[] = [];
  for (const part of parts) {
    for (const notice of part.notices) if (!notices.includes(notice)) notices.push(notice);
    for (const permit of part.permits) {
      const key = (permit.permitNumber ?? permit.id).toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      permits.push(permit);
    }
  }
  return { permits, total: permits.length, page: 1, perPage: permits.length, notices };
}

/**
 * Polk County BOCC Accela Citizen Access (unincorporated Polk building permits, 2010+).
 * Public, anonymous search page (no login/captcha). We perform the same GET + form
 * postback a browser does, then parse the results grid. Max a few pages per search.
 */
const ORIGIN = "https://aca-prod.accela.com";
const SEARCH_URL = `${ORIGIN}/POLKCO/Cap/CapHome.aspx?module=Building&TabName=Building`;
const P = "ctl00$PlaceHolderMain$generalSearchForm$";
const MAX_PAGES = 5;
const SOURCE = "Polk County Accela";
const DETAIL_LIMIT = 15; // max detail pages fetched per search
const DETAIL_CONCURRENCY = 5;
const DETAIL_TIMEOUT_MS = 8000;
type Detail = { contractor: string | null; license: string | null; value: number | null; type: string | null; final: string | null };
const detailCache = new Map<string, Detail>();

/** Non-construction record types (lien/permit search requests etc.). */
export function isOtherRecord(num?: string | null, type?: string | null) {
  return /^BPS-/i.test(num ?? "") || /permit search request|lien search/i.test(type ?? "");
}

const SUFFIXES = new Set(["DR","DRIVE","ST","STREET","AVE","AVENUE","RD","ROAD","LN","LANE","CT","COURT","BLVD","CIR","CIRCLE","WAY","PL","PLACE","TER","TRL","TRAIL","PKWY","HWY","LOOP","RUN","PATH","PT","CV","XING","SQ"]);
const DIRS = new Set(["N","S","E","W","NE","NW","SE","SW","NORTH","SOUTH","EAST","WEST"]);

/** "3749 Feather Dr, Lakeland FL 33812" -> { number: "3749", street: "FEATHER" } */
export function parseAddress(raw: string): { number?: string; street: string } {
  const first = raw.split(",")[0].toUpperCase().replace(/[.#]/g, " ").replace(/\s+/g, " ").trim();
  const m = first.match(/^(\d+)\s+(.*)$/);
  let words = (m ? m[2] : first).split(" ").filter(Boolean);
  if (words.length > 1 && DIRS.has(words[0])) words = words.slice(1);
  if (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words = words.slice(0, -1);
  if (words.length > 1 && DIRS.has(words[words.length - 1])) words = words.slice(0, -1);
  return { number: m?.[1], street: words.join(" ") };
}

function toIso(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

function formFields($: cheerio.CheerioAPI): Record<string, string> {
  const data: Record<string, string> = {};
  $("form#aspnetForm input").each((_, el) => {
    const name = $(el).attr("name");
    const type = ($(el).attr("type") || "text").toLowerCase();
    if (!name || ["checkbox", "radio", "submit", "image", "button"].includes(type)) return;
    data[name] = $(el).attr("value") ?? "";
  });
  $("form#aspnetForm select").each((_, el) => {
    const name = $(el).attr("name");
    if (name) data[name] = $(el).find("option[selected]").attr("value") ?? "";
  });
  return data;
}

export class PolkAccelaProvider implements PermitProvider {
  name = SOURCE;
  constructor(private timeoutMs = 12000) {}

  appliesTo(query: SearchQuery): boolean {
    return shouldMergePolkSources(query);
  }

  private async fetchPage(cookies: string[], body?: URLSearchParams, signal?: AbortSignal) {
    const res = await fetch(SEARCH_URL, {
      method: body ? "POST" : "GET",
      body,
      signal,
      cache: "no-store",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PermitRewind/1.0; +https://permitrewind.com)",
        Referer: SEARCH_URL,
        Origin: ORIGIN,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(cookies.length ? { Cookie: cookies.join("; ") } : {}),
      },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0];
      const k = kv.split("=")[0];
      const i = cookies.findIndex((x) => x.startsWith(k + "="));
      if (i >= 0) cookies[i] = kv; else cookies.push(kv);
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc && /CapDetail/i.test(loc)) {
      const detailUrl = new URL(loc, ORIGIN).toString();
      const d = await fetch(detailUrl, { signal, cache: "no-store", headers: { Cookie: cookies.join("; "), "User-Agent": "Mozilla/5.0 (compatible; PermitRewind/1.0)" } });
      return `<!--DETAIL ${detailUrl}-->` + (await d.text());
    }
    if (res.status >= 300) throw new ProviderError(`Polk County portal returned HTTP ${res.status}`, 502);
    return res.text();
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    if (query.mode === "address") {
      const forms = addressStreetForms(query.q);
      if (forms.length > 1) {
        const parts: SearchResult[] = [];
        for (const q of forms) parts.push(await this.searchOnce({ ...query, q }));
        return mergeStreetForms(parts);
      }
    }
    return this.searchOnce(query);
  }

  private async searchOnce(query: SearchQuery): Promise<SearchResult> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    const cookies: string[] = [];
    const q = query.q.trim();
    let $ = cheerio.load(await this.fetchPage(cookies, undefined, signal));
    const data = formFields($);
    if (query.mode === "address") {
      const { number, street } = parseAddress(q);
      if (!street) return { permits: [], total: 0, page: 1, perPage: 0, notices: [] };
      data[P + "txtGSNumber$ChildControl0"] = number ?? "";
      data[P + "txtGSNumber$ChildControl1"] = number ?? "";
      data[P + "txtGSStreetName"] = street;
    } else if (query.mode === "parcel") {
      data[P + "txtGSParcelNo"] = q.replace(/[^0-9A-Za-z]/g, "");
    } else {
      data[P + "txtGSPermitNumber"] = q;
    }
    data["__EVENTTARGET"] = "ctl00$PlaceHolderMain$btnNewSearch";
    data["__EVENTARGUMENT"] = "";

    let html = await this.fetchPage(cookies, new URLSearchParams(data), signal);
    const dm = html.match(/^<!--DETAIL (\S+)-->/);
    if (dm) {
      const $d = cheerio.load(html);
      const num = $d("#ctl00_PlaceHolderMain_lblPermitNumber").text().trim();
      if (!num) return { permits: [], total: 0, page: 1, perPage: 0, notices: [] };
      const permit: Permit = {
        id: `polk-accela:${num}`, permitNumber: num,
        status: $d("#ctl00_PlaceHolderMain_lblRecordStatus").text().trim() || null,
        category: $d("#ctl00_PlaceHolderMain_lblPermitType").text().trim() || null,
        tags: [], description: null, address: null, city: null, state: "FL", zip: null, parcelId: null,
        jurisdiction: "Polk County", dateFiled: null, dateIssued: null, dateCompleted: null,
        estimatedValue: null, contractorName: null, ownerName: null, propertyType: null,
        latitude: null, longitude: null, source: SOURCE, sourceUrl: dm[1],
      };
      return { permits: [permit], total: 1, page: 1, perPage: 1, notices: [] };
    }
    if (/Error\.aspx|cross-site request forgery/i.test(html.slice(0, 5000)) && !/gdvPermitList/.test(html)) {
      throw new ProviderError("Polk County portal rejected the search request", 502);
    }
    const permits: Permit[] = [];
    let total: number | null = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      $ = cheerio.load(html);
      // Single-record searches redirect straight to a detail page; no grid.
      const grid = $("table[id$='gdvPermitList']");
      const m = grid.text().match(/Showing\s+\d+-\d+\s+of\s+(\d+\+?)/);
      if (m) total = parseInt(m[1], 10);
      grid.find("tr").each((_, tr) => {
        const tds = $(tr).children("td");
        if (tds.length < 9) return;
        const cell = (i: number) => $(tds[i]).text().replace(/\s+/g, " ").trim();
        const num = cell(1);
        if (!num || /Record Number/i.test(num)) return;
        const href = $(tds[1]).find("a[href*='CapDetail']").attr("href");
        const addr = cell(3);
        const am = addr.match(/^(.*?),\s*([A-Z .]+?)\s+FL\s*(\d{5})?/i);
        const date = toIso(cell(6));
        permits.push({
          id: `polk-accela:${num}`,
          permitNumber: num,
          status: cell(5) || null,
          category: cell(2) || null,
          tags: [],
          description: [cell(8), cell(7)].filter(Boolean).join(" — ") || null,
          address: am ? am[1] : addr || null,
          city: am ? am[2].trim() : null,
          state: "FL",
          zip: am?.[3] ?? null,
          parcelId: null,
          jurisdiction: "Polk County",
          dateFiled: null,
          dateIssued: date, // grid "Date" (record date) shown as the permit issue date
          dateCompleted: null,
          estimatedValue: null,
          contractorName: null,
          ownerName: null,
          propertyType: null,
          latitude: null,
          longitude: null,
          source: SOURCE,
          sourceUrl: href ? ORIGIN + href.replace(/&amp;/g, "&") : null,
        });
      });
      const next = $("a:contains('Next >')").attr("href")?.match(/__doPostBack\('([^']+)'/)?.[1];
      if (!next || page === MAX_PAGES) break;
      const d2 = formFields($);
      d2["__EVENTTARGET"] = next;
      d2["__EVENTARGUMENT"] = "";
      html = await this.fetchPage(cookies, new URLSearchParams(d2), signal);
    }
    // Enrich in parallel (capped), never failing the search.
    const dsig = AbortSignal.timeout(DETAIL_TIMEOUT_MS);
    const queue = permits.filter((p) => !isOtherRecord(p.permitNumber, p.category)).slice(0, DETAIL_LIMIT);
    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) await this.enrich(p, dsig).catch(() => {});
    }));
    for (const p of permits) if (isOtherRecord(p.permitNumber, p.category)) p.recordKind = "other";
    const notices: string[] = [];
    if (total != null && total > permits.length) notices.push(`Polk County portal has ${total} matching records; showing the first ${permits.length}.`);
    return { permits, total: total ?? permits.length, page: 1, perPage: permits.length, notices };
  }

  /** Fetch a record's detail page for contractor, license, job value and full type. Cached in memory. */
  private async enrich(p: Permit, signal: AbortSignal): Promise<void> {
    if (!p.sourceUrl) return;
    let d = detailCache.get(p.sourceUrl);
    if (!d) {
      const cookies: string[] = [];
      const ua = "Mozilla/5.0 (compatible; PermitRewind/1.0; +https://permitrewind.com)";
      const res = await fetch(p.sourceUrl, { signal, cache: "no-store", headers: { "User-Agent": ua } });
      if (!res.ok) return;
      for (const c of res.headers.getSetCookie?.() ?? []) cookies.push(c.split(";")[0]);
      const $ = cheerio.load(await res.text());
      // Finaled date: latest passed "... Final" inspection (Inspections tab is loaded by a postback).
      let finalDate: string | null = null;
      try {
        const form = formFields($);
        form["__EVENTTARGET"] = "ctl00$PlaceHolderMain$InspectionList$btnRefreshGridView";
        form["__EVENTARGUMENT"] = "";
        const ir = await fetch(p.sourceUrl, {
          method: "POST", signal, cache: "no-store", body: new URLSearchParams(form),
          headers: { "User-Agent": ua, Referer: p.sourceUrl, Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies.join("; ") },
        });
        const txt = cheerio.load(await ir.text()).root().text().replace(/\s+/g, " ");
        const dates = [...txt.matchAll(/Final\s*\(\d+\)\s*-\s*Passed\s*Result by:.*? on (\d{2}\/\d{2}\/\d{4})/g)].map((m) => toIso(m[1])).filter((x): x is string => !!x);
        finalDate = dates.sort().pop() ?? null;
      } catch {
        /* inspections unavailable; keep other details */
      }
      const lp = $("#tbl_licensedps").find("td").eq(1).html() ?? "";
      const lines = lp.split(/<br\s*\/?>/i).map((l) => cheerio.load(l).text().replace(/\s+/g, " ").trim()).filter(Boolean);
      const lic = lines.map((l) => l.match(/\b([A-Z]{2,3}\d{5,8})\b/)?.[1]).find(Boolean) ?? null;
      const val = $.root().text().match(/Job Value\(\$\):\s*\$?([\d,]+(?:\.\d+)?)/)?.[1];
      d = {
        contractor: lines[1] ?? (lines[0] ? lines[0].replace(/\S+@\S+/, "").trim() : null) ?? null,
        license: lic,
        value: val ? Number(val.replace(/,/g, "")) : null,
        type: $("#ctl00_PlaceHolderMain_lblPermitType").text().trim() || null,
        final: finalDate,
      };
      if (detailCache.size > 2000) detailCache.clear();
      detailCache.set(p.sourceUrl, d);
    }
    p.contractorName ??= d.contractor;
    p.contractorLicense ??= d.license;
    p.estimatedValue ??= d.value;
    if (d.type) p.category = d.type;
    if (d.final) p.dateCompleted = d.final;
  }

  async getPermit(): Promise<Permit | null> {
    return null; // detail pages link out to the county portal
  }
}
