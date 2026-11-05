import type { Metadata } from "next";
import { SITE } from "@/lib/site";
export const metadata: Metadata = { title: "About & Contact" };
export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-neutral-950">About PermitRewind</h1>
      <p className="mt-4 text-slate-700">
        PermitRewind searches building permit history across Florida. PermitStack supplies statewide records
        for Florida cities and counties. Searches in Polk County also merge two local sources: Polk County Accela
        (unincorporated county permits) and the Polk County Property Appraiser permit file.
      </p>
      <p className="mt-4 text-slate-700">
        PermitRewind was built by {SITE.owner} of {SITE.company}, a home inspection company in {SITE.location}.
        Inspectors need a quick way to see what work has been permitted on a property — roof, HVAC, water heater, electrical, additions —
        before and during an inspection. PermitRewind puts that history one search away.
      </p>
      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-neutral-900 text-lg">Contact {SITE.company}</h2>
        <ul className="mt-3 space-y-1 text-slate-700">
          <li>Phone: <a className="text-brand-600 hover:underline" href={`tel:${SITE.phone}`}>{SITE.phone}</a></li>
          <li>Email: <a className="text-brand-600 hover:underline" href={`mailto:${SITE.email}`}>{SITE.email}</a></li>
          <li>Website: <a className="text-brand-600 hover:underline" href={SITE.website}>theagner.com</a></li>
          <li>Inspection company: {SITE.location}</li>
          <li>Permit search coverage: Florida via PermitStack, plus Polk County Accela and Property Appraiser records</li>
        </ul>
      </div>
      <p className="mt-6 text-sm text-slate-500">PermitStack is the statewide source. Polk County Accela and the Polk County Property Appraiser add county records for Polk searches. Records can be incomplete or delayed. Always verify with the issuing jurisdiction.</p>
    </div>
  );
}
