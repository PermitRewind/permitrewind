"use client";
import type { Permit } from "@/lib/types";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ResultsActions({ permits, filename }: { permits: Permit[]; filename: string }) {
  function exportCsv() {
    const cols: [string, (p: Permit) => unknown][] = [
      ["Permit Number", (p) => p.permitNumber], ["Date Filed", (p) => p.dateFiled], ["Date Issued", (p) => p.dateIssued],
      ["Date Completed", (p) => p.dateCompleted], ["Category", (p) => p.category], ["Status", (p) => p.status],
      ["Description", (p) => p.description], ["Address", (p) => p.address], ["City", (p) => p.city], ["Zip", (p) => p.zip],
      ["Parcel", (p) => p.parcelId], ["Jurisdiction", (p) => p.jurisdiction], ["Contractor", (p) => p.contractorName],
      ["Estimated Value", (p) => p.estimatedValue],
    ];
    const rows = [cols.map((c) => c[0]), ...permits.map((p) => cols.map((c) => c[1](p)))];
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50";
  return (
    <div className="no-print flex gap-2">
      <button className={btn} onClick={() => window.print()}>Print</button>
      <button className={btn} onClick={exportCsv} disabled={!permits.length}>Export CSV</button>
    </div>
  );
}
