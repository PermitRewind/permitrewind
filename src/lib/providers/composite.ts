import "server-only";
import type { PermitProvider } from "./types";
import { cityPreference } from "../address";
import { Permit, SearchQuery, SearchResult } from "../types";

const norm = (n?: string | null) => (n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Dedupe keys: the permit number, plus legacy Hansen digits for "BLD-H-200423"-style numbers (scoped to address). */
function keys(p: Permit): string[] {
  const k = norm(p.permitNumber);
  if (!k) return [];
  const addr = norm(p.address).replace(/^(\d+).*$/, "$1");
  const out = [k];
  const legacy = (p.permitNumber ?? "").toUpperCase().match(/^[A-Z]+-H-(\d+)$/)?.[1];
  if (legacy) out.push(`L${legacy}@${addr}`);
  else if (/^\d+$/.test(k)) out.push(`L${k}@${addr}`);
  return out;
}

function applyFilters(p: Permit, q: SearchQuery): boolean {
  const d = p.dateIssued ?? p.dateFiled;
  if (q.dateFrom && (!d || d < q.dateFrom)) return false;
  if (q.dateTo && (!d || d > q.dateTo)) return false;
  if (q.city && p.city && p.city.toLowerCase() !== q.city.toLowerCase()) return false;
  if (q.status && !(p.status ?? "").toLowerCase().replace(/[\s-]+/g, "_").includes(q.status.toLowerCase())) return false;
  if (q.category && !(p.category ?? "").toUpperCase().replace(/[\s/-]+/g, "_").includes(q.category.toUpperCase().replace("NEW_CONSTRUCTION", "NEW"))) return false;
  return true;
}

/**
 * Queries a primary provider plus supplemental providers in parallel, merges and
 * dedupes by permit number. Supplemental failures become notices, never errors.
 */
export class CompositeProvider implements PermitProvider {
  name = "Composite";
  constructor(private primary: PermitProvider, private extras: PermitProvider[]) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const extras = this.extras.filter((p) => p.appliesTo?.(query) !== false);
    const [main, ...rest] = await Promise.allSettled([
      this.primary.search(query),
      ...extras.map((p) => p.search(query)),
    ]);
    const notices: string[] = [];
    const byNum = new Map<string, Permit>();
    const merged: Permit[] = [];
    let total: number | null = 0;

    const add = (p: Permit) => {
      const ks = keys(p);
      const existing = ks.map((k) => byNum.get(k)).find(Boolean);
      if (existing) {
        if (p.source && p.source !== existing.source) existing.alsoIn = [...(existing.alsoIn ?? []), p.source];
        existing.sourceUrl ??= p.sourceUrl;
        existing.contractorName ??= p.contractorName;
        existing.contractorLicense ??= p.contractorLicense;
        existing.estimatedValue ??= p.estimatedValue;
        existing.dateIssued ??= p.dateIssued;
        // Final date preference: county inspection (Accela) > PermitStack completed > Polk Property Appraiser FINAL_DT.
        const rank = (src?: string) => (src === "Polk County Accela" ? 3 : src === "PermitStack" ? 2 : 1);
        if (p.dateCompleted && (!existing.dateCompleted || rank(p.source) > (existing.finalFrom ? rank(existing.finalFrom) : rank(existing.source)))) {
          existing.dateCompleted = p.dateCompleted;
          existing.finalFrom = p.source;
        }
        existing.parcelId ??= p.parcelId;
        if (p.permitNumber && norm(p.permitNumber) !== norm(existing.permitNumber)) existing.description = [existing.description, `(also recorded as #${p.permitNumber})`].filter(Boolean).join(" ");
        existing.status = existing.status && existing.status !== "UNKNOWN" ? existing.status : p.status;
        return;
      }
      ks.forEach((k) => byNum.set(k, p));
      merged.push(p);
    };

    if (main.status === "fulfilled") {
      main.value.permits.forEach(add);
      notices.push(...main.value.notices);
      total = main.value.total;
    }
    rest.forEach((r, i) => {
      const name = extras[i].name;
      if (r.status === "fulfilled") {
        r.value.permits.filter((p) => applyFilters(p, query)).forEach(add);
        notices.push(...r.value.notices);
      } else {
        console.error(`${name} failed`, r.reason);
        notices.push(`${name} is unavailable right now; showing other sources only.`);
      }
    });
    if (main.status === "rejected") {
      if (rest.every((r) => r.status === "rejected")) throw main.reason;
      notices.unshift(`${this.primary.name} is unavailable right now (${main.reason?.message ?? "error"}).`);
    }
    merged.sort((a, b) => {
      const byCity = cityPreference(query.city, a) - cityPreference(query.city, b);
      if (byCity) return byCity;
      return (b.dateIssued ?? b.dateFiled ?? "") > (a.dateIssued ?? a.dateFiled ?? "") ? 1 : -1;
    });
    return { permits: merged, total: Math.max(total ?? 0, merged.length), page: 1, perPage: merged.length, notices };
  }

  getPermit(id: string): Promise<Permit | null> {
    if (id.startsWith("davenport-iworq:")) {
      const city = this.extras.find((p) => p.name === "City of Davenport");
      if (city) return city.getPermit(id);
    }
    return this.primary.getPermit(id);
  }
}
