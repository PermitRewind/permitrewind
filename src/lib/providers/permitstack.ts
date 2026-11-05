import "server-only";
import type { PermitProvider } from "./types";
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
    address: r.address_street ?? null,
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
    const params: Record<string, string | undefined> = {
      state: region.state,
      city: query.city?.trim() || undefined,
      category: query.category || undefined,
      status: query.status || undefined,
      date_after: query.dateFrom || undefined,
      date_before: query.dateTo || undefined,
      page: String(query.page ?? 1),
      per_page: String(PER_PAGE),
    };
    if (query.mode === "address") params.address = q;
    else if (query.mode === "parcel") params.parcel = q;
    else params.permit_number = q;

    const body = await this.request("/v1/permits/search", params);
    const all: Permit[] = (body.results ?? []).map(mapPermit);
    // Default region is statewide Florida. Do not drop Tampa or other non-Polk rows.
    const permits = all.filter((p) => permitInCoverage(region, p));

    const notices: string[] = [];
    if (body.tier_window_days) {
      notices.push(
        `Current data plan covers permits from ${body.tier_window_from} onward (last ${body.tier_window_days} days). Older history requires a paid PermitStack plan.`
      );
    }
    if (all.length !== permits.length) {
      notices.push(`${all.length - permits.length} matching permit(s) outside ${region.label} were hidden.`);
    }
    return {
      permits,
      total: all.length === permits.length ? body.total ?? null : permits.length,
      page: body.page ?? 1,
      perPage: body.per_page ?? PER_PAGE,
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
