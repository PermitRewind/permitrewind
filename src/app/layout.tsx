import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { default: `${SITE.name} | Polk County Permit History`, template: `%s | ${SITE.name}` },
  description: "Search building permit history by address, parcel, or permit number across Polk County, Florida.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="no-print bg-navy-900 text-white">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-semibold text-lg tracking-tight">
              <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-navy-900 font-bold">⟲</span>
              Permit<span className="text-sky-300">Rewind</span>
            </Link>
            <nav className="flex gap-5 text-sm text-slate-200">
              <Link href="/" className="hover:text-white">Search</Link>
              <Link href="/about" className="hover:text-white">About &amp; Contact</Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="no-print border-t border-slate-200 bg-white text-sm text-slate-500">
          <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col sm:flex-row gap-2 justify-between">
            <p>© {new Date().getFullYear()} {SITE.company}. Permit data provided by third-party public records sources; verify with the issuing jurisdiction.</p>
            <p><a className="hover:text-navy-700" href={`tel:${SITE.phone}`}>{SITE.phone}</a> · <a className="hover:text-navy-700" href={`mailto:${SITE.email}`}>{SITE.email}</a></p>
          </div>
        </footer>
      </body>
    </html>
  );
}
