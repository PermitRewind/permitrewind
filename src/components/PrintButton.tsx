"use client";
export default function PrintButton() {
  return <button onClick={() => window.print()} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-100">Print</button>;
}
