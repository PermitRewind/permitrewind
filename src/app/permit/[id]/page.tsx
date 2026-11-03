import { notFound } from "next/navigation";
import Link from "next/link";
import { getProvider } from "@/lib/providers";
import { bestDate, fmtDate, fmtLabel, fmtMoney, statusColor } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export default async function PermitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProvider().getPermit(id);
  if (!p) notFound();

  const rows: [string, React.ReactNode][] = [
    ["Permit number", p.permitNumber],
    ["Type / category", fmtLabel(p.category)],
    ["Tags", p.tags.length ? p.tags.map(fmtLabel).join(", ") : null],
    ["Status", fmtLabel(p.status)],
    ["Date filed", fmtDate(p.dateFiled)],
    ["Date issued", fmtDate(p.dateIssued)],
    ["Date completed", fmtDate(p.dateCompleted)],
    ["Date expired", p.dateExpired ? fmtDate(p.dateExpired) : null],
    ["Address", [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ")],
    ["Parcel ID", p.parcelId],
    ["Jurisdiction", p.jurisdiction],
    ["Property type", fmtLabel(p.propertyType)],
    ["Estimated value", p.estimatedValue != null ? fmtMoney(p.estimatedValue) : null],
    ["Fees", p.feeAmount != null ? fmtMoney(p.feeAmount) : null],
    ["Contractor", p.contractorName],
    ["Contractor license", p.contractorLicense],
    ["Applicant", p.applicantName],
    ["Owner", p.ownerName],
    ["Square footage", p.squareFootage],
    ["Stories / units", p.stories || p.units ? `${p.stories ?? "—"} / ${p.units ?? "—"}` : null],
    ["Record kind", p.recordKind ? fmtLabel(p.recordKind) : null],
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="no-print flex justify-between mb-4 text-sm">
        <Link href={p.address ? `/search?mode=address&q=${encodeURIComponent(p.address)}` : "/"} className="text-navy-600 hover:underline">← All permits at this address</Link>
        <PrintButton />
      </div>
      <article className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 p-5">
          <p className="text-sm text-slate-500">{fmtDate(bestDate(p))} · {p.jurisdiction}</p>
          <h1 className="mt-1 text-2xl font-bold text-navy-900">Permit {p.permitNumber}</h1>
          <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(p.status)}`}>{fmtLabel(p.status)}</span>
          {p.description && <p className="mt-3 text-slate-700">{p.description}</p>}
        </header>
        <dl className="divide-y divide-slate-100">
          {rows.filter(([, v]) => v != null && v !== "" && v !== "—").map(([k, v]) => (
            <div key={k} className="grid grid-cols-3 gap-4 px-5 py-2.5 text-sm">
              <dt className="text-slate-500">{k}</dt><dd className="col-span-2 text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
      </article>
      <p className="mt-4 text-xs text-slate-500">Data from public records aggregated by a third-party provider. Always confirm with the issuing building department.</p>
    </div>
  );
}
