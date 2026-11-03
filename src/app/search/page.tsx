import Link from "next/link";
import type { Metadata } from "next";
import SearchForm from "@/components/SearchForm";
import ResultsActions from "@/components/ResultsActions";
import { getProvider } from "@/lib/providers";
import { DEFAULT_REGION, PERMIT_CATEGORIES, PERMIT_STATUSES, regionCities } from "@/lib/jurisdictions";
import { Permit, ProviderError, SearchMode, SearchQuery, SearchResult } from "@/lib/types";
import { bestDate, fmtDate, fmtLabel, statusColor } from "@/lib/format";

export const metadata: Metadata = { title: "Search results" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const mode = (["address", "parcel", "permit"].includes(one(sp.mode)) ? one(sp.mode) : "address") as SearchMode;
  const query: SearchQuery = {
    mode,
    q: one(sp.q).slice(0, 120),
    city: one(sp.city),
    category: one(sp.category),
    status: one(sp.status),
    dateFrom: DATE_RE.test(one(sp.from)) ? one(sp.from) : undefined,
    dateTo: DATE_RE.test(one(sp.to)) ? one(sp.to) : undefined,
  };

  let result: SearchResult | null = null;
  let error: string | null = null;
  let otherCount = 0;
  if (query.q.trim().length >= 2) {
    try {
      result = await getProvider().search(query);
    } catch (e) {
      error = e instanceof ProviderError ? e.message : "Unexpected error while searching permits.";
      console.error("search failed", e);
    }
  }

  const showOther = one(sp.other) !== "hide";
  if (result) {
    const isOther = (p: Permit) => p.recordKind === "other";
    otherCount = result.permits.filter(isOther).length;
    if (!showOther) result = { ...result, permits: result.permits.filter((p) => !isOther(p)) };
  }
  const sel = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const modeLabel = { address: "Address", parcel: "Parcel", permit: "Permit #" }[mode];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-sm no-print">
        <SearchForm initialMode={mode} initialQ={query.q} compact />
        <form method="get" className="mt-4 grid grid-cols-2 md:grid-cols-7 gap-2 items-end text-sm">
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="q" value={query.q} />
          <label className="flex flex-col gap-1">City
            <select name="city" defaultValue={query.city} className={sel}>
              <option value="">All of {DEFAULT_REGION.label}</option>
              {regionCities(DEFAULT_REGION).map((c) => <option key={c}>{c}</option>)}
            </select></label>
          <label className="flex flex-col gap-1">Type
            <select name="category" defaultValue={query.category} className={sel}>
              <option value="">All types</option>
              {PERMIT_CATEGORIES.map((c) => <option key={c} value={c}>{fmtLabel(c)}</option>)}
            </select></label>
          <label className="flex flex-col gap-1">Status
            <select name="status" defaultValue={query.status} className={sel}>
              <option value="">Any status</option>
              {PERMIT_STATUSES.map((s) => <option key={s} value={s}>{fmtLabel(s)}</option>)}
            </select></label>
          <label className="flex flex-col gap-1">Other records
            <select name="other" defaultValue={showOther ? "" : "hide"} className={sel}>
              <option value="">Show (lien/permit searches)</option>
              <option value="hide">Hide</option>
            </select></label>
          <label className="flex flex-col gap-1">From
            <input type="date" name="from" defaultValue={query.dateFrom} className={sel} /></label>
          <label className="flex flex-col gap-1">To
            <input type="date" name="to" defaultValue={query.dateTo} className={sel} /></label>
          <div className="flex gap-2">
            <button className="flex-1 rounded-md bg-navy-700 hover:bg-navy-800 text-white px-3 py-1.5 font-medium">Apply</button>
            <Link href={`/search?mode=${mode}&q=${encodeURIComponent(query.q)}`} className="rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100">Reset</Link>
          </div>
        </form>
      </div>

      <div className="print-only mb-4">
        <h1 className="text-xl font-bold">PermitRewind — Permit History Report</h1>
        <p className="text-sm">{modeLabel}: {query.q} · {DEFAULT_REGION.label} · Generated {new Date().toLocaleDateString("en-US")}</p>
      </div>

      {!query.q.trim() ? (
        <State title="Start a search" body="Enter a street address, parcel ID, or permit number above." />
      ) : query.q.trim().length < 2 ? (
        <State title="Search too short" body="Please enter at least 2 characters." />
      ) : error ? (
        <State tone="error" title="We couldn't complete that search" body={error} />
      ) : result && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h1 className="text-lg font-semibold text-navy-900">
              {result.permits.length} permit{result.permits.length === 1 ? "" : "s"} for <span className="text-navy-600">&ldquo;{query.q}&rdquo;</span>
              {result.total != null && result.total > result.permits.length && <span className="text-sm font-normal text-slate-500"> (showing first {result.permits.length} of {result.total})</span>}
            </h1>
            <ResultsActions permits={result.permits} filename={`permits-${query.q.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`} />
          </div>
          {otherCount > 0 && (
            <p className="mb-3 text-sm text-slate-600">{showOther ? `Includes ${otherCount} other record(s) (e.g. lien/permit search requests), labeled "Other record". Use the Other records filter to hide them.` : `${otherCount} other record(s) (lien/permit search requests) hidden by filter.`}</p>
          )}
          {result.notices.map((n) => (
            <p key={n} className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">{n}</p>
          ))}
          {result.permits.length === 0 ? (
            <State title="No permits found" body={`No permits matched in ${DEFAULT_REGION.label}. Try fewer words (e.g. just the house number and street name), remove filters, or search by permit number.`} />
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 text-left text-slate-600">
                    <tr>{["Date", "Permit #", "Type", "Status", "Description", "Address", "Source"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.permits.map((p) => (
                      <tr key={p.id} className="hover:bg-navy-50 align-top">
                        <td className="px-3 py-2 whitespace-nowrap">{fmtDate(bestDate(p))}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><PermitLink p={p} className="text-navy-600 font-medium hover:underline" /></td>
                        <td className="px-3 py-2">{p.recordKind === "other" ? <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">Other record</span> : null} {fmtLabel(p.category)}{p.contractorName ? <div className="text-xs text-slate-500">{p.contractorName}{p.estimatedValue != null ? ` · $${p.estimatedValue.toLocaleString("en-US")}` : ""}</div> : null}</td>
                        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(p.status)}`}>{fmtLabel(p.status)}</span></td>
                        <td className="px-3 py-2 max-w-md">{p.description ?? "—"}</td>
                        <td className="px-3 py-2">{p.address}{p.city ? `, ${p.city}` : ""}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{sourceLabel(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="md:hidden space-y-3">
                {result.permits.map((p) => (
                  <li key={p.id}>
                    <div className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex justify-between text-sm">
                        <PermitLink p={p} className="font-semibold text-navy-700 underline" />
                        <span className="text-slate-500">{fmtDate(bestDate(p))}</span>
                      </div>
                      <div className="mt-1 flex gap-2 items-center text-xs">
                        <span className="font-medium">{fmtLabel(p.category)}</span>
                        <span className={`rounded-full px-2 py-0.5 ${statusColor(p.status)}`}>{fmtLabel(p.status)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-700 line-clamp-2">{p.description}</p>
                      <p className="mt-1 text-xs text-slate-500">{p.address}, {p.city} · {sourceLabel(p)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function sourceLabel(p: Permit) {
  return [p.source, ...(p.alsoIn ?? [])].filter(Boolean).join(" + ");
}

function PermitLink({ p, className }: { p: Permit; className: string }) {
  if (p.id.startsWith("polk-accela:")) {
    return p.sourceUrl ? <a className={className} href={p.sourceUrl} target="_blank" rel="noopener noreferrer">{p.permitNumber} ↗</a> : <span>{p.permitNumber}</span>;
  }
  return <Link className={className} href={`/permit/${p.id}`}>{p.permitNumber ?? "View"}</Link>;
}

function State({ title, body, tone }: { title: string; body: string; tone?: "error" }) {
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`mt-8 rounded-xl border p-8 text-center ${tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-slate-200 bg-white text-slate-700"}`}>
      <h2 className="font-semibold text-lg">{title}</h2>
      <p className="mt-2 text-sm">{body}</p>
    </div>
  );
}
