import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: { default: `${SITE.name} | Florida Permit History`, template: `%s | ${SITE.name}` },
  description: "Search building permit history by address, parcel, or permit number across Florida. Polk County searches also include county records.",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "32x32" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="no-print border-b border-neutral-200 bg-white">
          <div className="h-1 bg-brand-600" aria-hidden="true" />
          <div className="mx-auto max-w-6xl px-4 py-2.5 flex items-center justify-between gap-3">
            <Link href="/" className="flex min-w-0 shrink items-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
              {/* Supplied raster mark. next/image would recompress the transparent PNG. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="PermitRewind" width={1204} height={360} className="h-10 w-auto max-h-10 max-w-[42vw] sm:h-14 sm:max-h-14 sm:max-w-none" />
            </Link>
            <nav className="flex shrink-0 gap-3 sm:gap-5 text-sm font-medium text-neutral-800">
              <Link href="/" className="whitespace-nowrap hover:text-brand-600">Search</Link>
              <Link href="/about" className="whitespace-nowrap hover:text-brand-600">About &amp; Contact</Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="no-print border-t border-slate-200 bg-white text-sm text-slate-500">
          <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col sm:flex-row gap-2 justify-between">
            <p>© {new Date().getFullYear()} {SITE.company}. Statewide Florida permits via PermitStack. Polk County results may also include county Accela and Property Appraiser records. Verify with the issuing jurisdiction.</p>
            <p><a className="hover:text-brand-700" href={`tel:${SITE.phone}`}>{SITE.phone}</a> · <a className="hover:text-brand-700" href={`mailto:${SITE.email}`}>{SITE.email}</a></p>
          </div>
        </footer>
      </body>
    </html>
  );
}
