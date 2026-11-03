import SearchForm from "@/components/SearchForm";
import { DEFAULT_REGION, regionCities } from "@/lib/jurisdictions";

export default function Home() {
  return (
    <>
      <section className="bg-gradient-to-b from-navy-900 to-navy-700 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24 text-center">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">Rewind any property&apos;s permit history</h1>
          <p className="mt-4 text-slate-200 max-w-2xl mx-auto">
            Fast building permit lookups for {DEFAULT_REGION.label} and its cities. Built for home inspectors, buyers, and agents.
          </p>
          <div className="mt-8"><SearchForm /></div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-12 grid gap-6 sm:grid-cols-3">
        {[
          ["Search by address", "Type a street address to see roofing, HVAC, electrical, plumbing and other permits on file."],
          ["Filter & export", "Narrow by date, type and status, then print a clean report or download CSV."],
          ["Polk County coverage", `Unincorporated Polk County plus ${regionCities(DEFAULT_REGION).length} cities including Lakeland, Bartow and Winter Haven.`],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl bg-white p-6 shadow-sm border border-slate-200">
            <h2 className="font-semibold text-navy-800">{t}</h2>
            <p className="mt-2 text-sm text-slate-600">{d}</p>
          </div>
        ))}
      </section>
    </>
  );
}
