import SearchForm from "@/components/SearchForm";
import { DEFAULT_REGION } from "@/lib/jurisdictions";

export default function Home() {
  return (
    <>
      <section className="bg-neutral-800 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24 text-center">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">Rewind any property&apos;s permit history</h1>
          <p className="mt-4 text-slate-200 max-w-2xl mx-auto">
            Fast building permit lookups across {DEFAULT_REGION.label}. Built for home inspectors, buyers, and agents.
          </p>
          <div className="mt-8"><SearchForm /></div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-12 grid gap-6 sm:grid-cols-3">
        {[
          ["Search by address", "Type a street address to see roofing, HVAC, electrical, plumbing and other permits on file."],
          ["Filter & export", "Narrow by date, type and status, then print a clean report or download CSV."],
          ["Florida coverage", "PermitStack covers cities and counties across Florida. Polk County — including Lakeland, Bartow, and Winter Haven — also merges county Accela and Property Appraiser records. Davenport city permits are read from a saved iWorQ harvest."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl bg-white p-6 shadow-sm border border-slate-200">
            <h2 className="font-semibold text-neutral-900">{t}</h2>
            <p className="mt-2 text-sm text-slate-600">{d}</p>
          </div>
        ))}
      </section>
    </>
  );
}
