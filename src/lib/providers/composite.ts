import "server-only";
import type { PermitProvider } from "./types";
import { Permit, SearchQuery, SearchResult } from "../types";

const norm = (n?: string | null) => (n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

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
    const [main, ...rest] = await Promise.allSettled([
      this.primary.search(query),
      ...this.extras.map((p) => p.search(query)),
    ]);
    const notices: string[] = [];
    const byNum = new Map<string, Permit>();
    const merged: Permit[] = [];
    let total: number | null = 0;

    const add = (p: Permit) => {
      const k = norm(p.permitNumber);
      const existing = k ? byNum.get(k) : undefined;
      if (existing) {
        if (p.source && p.source !== existing.source) existing.alsoIn = [...(existing.alsoIn ?? []), p.source];
        existing.sourceUrl ??= p.sourceUrl;
        existing.contractorName ??= p.contractorName;
        existing.contractorLicense ??= p.contractorLicense;
        existing.estimatedValue ??= p.estimatedValue;
        existing.status = existing.status && existing.status !== "UNKNOWN" ? existing.status : p.status;
        return;
      }
      if (k) byNum.set(k, p);
      merged.push(p);
    };

    if (main.status === "fulfilled") {
      main.value.permits.forEach(add);
      notices.push(...main.value.notices);
      total = main.value.total;
    }
    rest.forEach((r, i) => {
      const name = this.extras[i].name;
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
    merged.sort((a, b) => ((b.dateIssued ?? b.dateFiled ?? "") > (a.dateIssued ?? a.dateFiled ?? "") ? 1 : -1));
    return { permits: merged, total: Math.max(total ?? 0, merged.length), page: 1, perPage: merged.length, notices };
  }

  getPermit(id: string): Promise<Permit | null> {
    return this.primary.getPermit(id);
  }
}
