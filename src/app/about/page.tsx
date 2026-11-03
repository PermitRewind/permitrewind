import type { Metadata } from "next";
import { SITE } from "@/lib/site";
export const metadata: Metadata = { title: "About & Contact" };
export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-navy-900">About PermitRewind</h1>
      <p className="mt-4 text-slate-700">
        PermitRewind was built by {SITE.owner} of {SITE.company}, a home inspection company serving {SITE.location} and all of Polk County.
        Inspectors need a quick way to see what work has been permitted on a property — roof, HVAC, water heater, electrical, additions —
        before and during an inspection. PermitRewind puts that history one search away.
      </p>
      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-navy-800 text-lg">Contact {SITE.company}</h2>
        <ul className="mt-3 space-y-1 text-slate-700">
          <li>Phone: <a className="text-navy-600 hover:underline" href={`tel:${SITE.phone}`}>{SITE.phone}</a></li>
          <li>Email: <a className="text-navy-600 hover:underline" href={`mailto:${SITE.email}`}>{SITE.email}</a></li>
          <li>Website: <a className="text-navy-600 hover:underline" href={SITE.website}>theagner.com</a></li>
          <li>Service area: {SITE.location} · Polk County, FL</li>
        </ul>
      </div>
      <p className="mt-6 text-sm text-slate-500">Permit records come from public sources via a third-party data provider and may be incomplete or delayed. Always verify with the issuing jurisdiction.</p>
    </div>
  );
}
