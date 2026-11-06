import "server-only";
import type { PermitProvider } from "./types";
import { cityPreference, hardCity, loosePermitStackAddress, parseAddressQuery, permitAddressMatches, permitAddressQueries, selectPermitsByCity, splitStreetUnit } from "../address";
import { getRegion, permitInCoverage } from "../jurisdictions";
import { isPermitStackId } from "../permit-link";
import { Permit, ProviderError, SearchQuery, SearchResult } from "../types";

const BASE_URL = process.env.PERMITSTACK_BASE_URL || "https://api.permit-stack.com";
const PER_PAGE = 100;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPermit(r: any): Permit {
  return {
    id: r.id,
    permitNumber: r.permit_number ?? null,
    status: r.status ?? null,
    category: r.category ?? null,
    tags: r.tags ?? [],
    description: r.description_raw ?? r.enrichment?.work_summary ?? null,
    ...(() => {
      const split = splitStreetUnit(r.address_street ?? "");
      const jurisdiction = r.jurisdiction_name ?? null;
      const countyRaw = r.county ?? r.address_county ?? (typeof jurisdiction === "string" && /county/i.test(jurisdiction) ? jurisdiction : null);
      return {
        address: split.street || null,
        unitType: r.unit_type ?? split.unitType,
        unitNumber: r.unit_number ?? split.unitNumber,
        county: countyRaw ? String(countyRaw).replace(/\s+county$/i, "") : null,
      };
    })(),
    city: r.address_city ?? null,
    state: r.address_state ?? null,
    zip: r.address_zip ?? null,
    parcelId: r.parcel_id ?? null,
    jurisdiction: r.jurisdiction_name ?? null,
    dateFiled: r.date_filed ?? null,
    dateIssued: r.date_issued ?? null,
    dateCompleted: r.date_completed ?? null,
    dateExpired: r.date_expired ?? null,
    estimatedValue: r.estimated_value ?? null,
    feeAmount: r.fee_amount ?? null,
    contractorName: r.contractor_name ?? null,
    contractorLicense: r.contractor_license ?? null,
    applicantName: r.applicant_name ?? null,
    ownerName: r.owner_name ?? null,
    propertyType: r.property_type ?? null,
    squareFootage: r.square_footage ?? null,
    stories: r.stories ?? null,
    units: r.units ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    recordKind: r.record_kind ?? null,
    source: "PermitStack",
  };
}

export class PermitStackProvider implements PermitProvider {
  name = "PermitStack";
  constructor(private apiKey?: string) {}

  private async request(path: string, params?: Record<string, string | undefined>) {
    if (!this.apiKey) {
      throw new ProviderError("Server is missing PERMITSTACK_API_KEY. See README.", 500, "no_key");
    }
    const url = new URL(path, BASE_URL);
    for (const [k, v] of Object.entries(params ?? {})) if (v) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: { "X-API-Key": this.apiKey, Accept: "application/json" },
      cache: "no-store", // always fresh; avoids serving responses cached under an old key/plan
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const d = body?.detail;
      const msg =
        (typeof d === "object" && d?.message) ||
        (typeof d === "string" && d) ||
        (res.status === 429
          ? "Daily or per-minute lookup limit reached. Please try again later."
          : res.status === 401
          ? "The permit data service rejected our API key."
          : `Permit data service error (HTTP ${res.status}).`);
      throw new ProviderError(msg, res.status, typeof d === "object" ? d?.error : undefined);
    }
    return body;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const region = getRegion(query.regionId);
    const q = query.q.trim();
    const parsed = query.mode === "address" ? parseAddressQuery(q) : null;
    const wantedCity = query.city?.trim() || parsed?.city || "";
    // Only a permitting city is sent. A CDP such as Highland City would AND the
    // query down to zero; the street is searched instead and ZIP/county narrows it.
    const apiCity = hardCity(wantedCity) || undefined;
    const base: Record<string, string | undefined> = {
      state: query.state?.trim() || region.state,
      category: query.category || undefined,
      status: query.status || undefined,
      date_after: query.dateFrom || undefined,
      date_before: query.dateTo || undefined,
      page: String(query.page ?? 1),
      per_page: String(PER_PAGE),
    };
    // PermitStack ANDs every param. zip_code drops rows that leave ZIP blank or
    // disagree with Nominatim, so ZIP stays on the form and is not sent.
    const attempts: Record<string, string | undefined>[] = [];
    const specificAddresses = parsed ? permitAddressQueries(parsed) : [];
    if (query.mode === "address" && parsed) {
      for (const address of specificAddresses) attempts.push({ ...base, address, city: apiCity });
      const loose = loosePermitStackAddress(parsed);
      if (loose && !specificAddresses.some((address) => address.toLowerCase() === loose.toLowerCase())) {
        attempts.push({ ...base, address: loose, city: apiCity });
      }
      if (apiCity) {
        for (const address of specificAddresses) attempts.push({ ...base, address });
      }
    } else if (query.mode === "parcel") {
      attempts.push({ ...base, parcel: q, city: apiCity });
    } else {
      attempts.push({ ...base, permit_number: q, city: apiCity });
    }

    const keep = (rows: unknown[]) => {
      const all: Permit[] = rows.map(mapPermit);
      const covered = all.filter((p) => permitInCoverage(region, p));
      let permits = parsed?.streetName ? covered.filter((p) => permitAddressMatches(parsed, p)) : covered;
      permits = selectPermitsByCity(permits, { city: wantedCity, zip: query.zip, county: query.county, broaden: query.broaden });
      return { all, covered, permits };
    };

    const seenIds = new Set<string>();
    const mergedRows: unknown[] = [];
    type SearchBody = { results?: unknown[]; tier_window_days?: number; tier_window_from?: string; total?: number; page?: number; per_page?: number };
    let body: SearchBody = {};
    const take = (next: SearchBody) => {
      for (const row of next.results ?? []) {
        const id = String((row as { id?: string; permit_number?: string }).id ?? (row as { permit_number?: string }).permit_number ?? "");
        const key = id || JSON.stringify(row);
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        mergedRows.push(row);
      }
    };
    // Compound spellings are the same street, so their rows are unioned.
    // A shorter street, then a query without city, run only when that union is empty.
    const compoundCount = query.mode === "address" && parsed ? specificAddresses.length : 1;
    body = await this.request("/v1/permits/search", attempts[0]);
    take(body);
    for (let i = 1; i < compoundCount && i < attempts.length; i++) {
      body = await this.request("/v1/permits/search", attempts[i]);
      take(body);
    }
    let picked = keep(mergedRows);
    for (let i = compoundCount; i < attempts.length && picked.permits.length === 0; i++) {
      body = await this.request("/v1/permits/search", attempts[i]);
      const next = keep([...(body.results ?? [])]);
      if (next.permits.length || next.all.length) {
        mergedRows.length = 0;
        seenIds.clear();
        take(body);
        picked = next;
      }
    }
    const { all, covered, permits } = picked;
    permits.sort((a, b) => cityPreference(wantedCity, a) - cityPreference(wantedCity, b) || ((b.dateIssued ?? b.dateFiled ?? "") > (a.dateIssued ?? a.dateFiled ?? "") ? 1 : -1));

    const notices: string[] = [];
    if (body?.tier_window_days) {
      notices.push(
        `Current data plan covers permits from ${body.tier_window_from} onward (last ${body.tier_window_days} days). Older history requires a paid PermitStack plan.`
      );
    }
    if (all.length !== covered.length) {
      notices.push(`${all.length - covered.length} matching permit(s) outside ${region.label} were hidden.`);
    }
    return {
      permits,
      total: permits.length === all.length ? body?.total ?? null : permits.length,
      page: body?.page ?? 1,
      perPage: body?.per_page ?? PER_PAGE,
      notices,
    };
  }

  async getPermit(id: string): Promise<Permit | null> {
    if (!isPermitStackId(id)) return null;
    try {
      return mapPermit(await this.request(`/v1/permits/${id}`));
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return null;
      throw e;
    }
  }
}
