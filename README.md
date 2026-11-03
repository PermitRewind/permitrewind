# PermitRewind

Fast building-permit history lookups for **Polk County, FL** and its cities, built for home inspectors.
By Agner Building & Solutions (https://theagner.com).

Stack: Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · PermitStack API (server-side only).

## Setup

```bash
npm install
cp .env.example .env.local   # then set PERMITSTACK_API_KEY
npm run dev                  # http://localhost:3000
npm run build && npm start   # production
```

### Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `PERMITSTACK_API_KEY` | yes | PermitStack key (`X-API-Key`). Server-only — never prefix with `NEXT_PUBLIC_`. |
| `PERMITSTACK_BASE_URL` | no | Defaults to `https://api.permit-stack.com`. |

## Features

- Search by street address (primary), parcel ID, or permit number (`/search?mode=address|parcel|permit&q=...`)
- Filters: city, permit type, status, date range (passed to the API)
- Results table (desktop) / cards (mobile), permit detail page (`/permit/[id]`)
- Print-friendly CSS (Print button) and CSV export of current results
- Loading, empty, and error states (incl. API quota / plan-limit messages)
- About & Contact page; JSON proxy at `/api/search`

## Code map

- `src/lib/jurisdictions.ts` — region + jurisdiction config (Polk County and 15 cities). Add a `Region` to expand.
- `src/lib/providers/types.ts` — `PermitProvider` interface; `permitstack.ts` implements it; `index.ts` selects it.
- `src/lib/types.ts` — normalized `Permit` / `SearchQuery` / `SearchResult`.
- `src/app/search/page.tsx`, `src/app/permit/[id]/page.tsx` — server components that call the provider.

## PermitStack notes

- Search uses `GET /v1/permits/search` with `state=FL` plus `address` / `parcel` / `permit_number`; results are filtered to the configured Polk jurisdictions.
- Current key is on the **Indie** plan (1,000 requests/day, full history). The **free tier** allows 100 requests/day and only the last 30 days; Date filters older than that return HTTP 403 `feature_locked`
  on free keys older date filters return HTTP 403 `feature_locked` (shown to the user as a clear message). The 30-day notice in results only appears when the API reports a tier window. Responses are not cached (each search is one API request).
- Polk County records currently have `parcel_id: null`, so parcel search will usually return nothing until the source publishes parcels.

## Deploying to Vercel

1. Import the GitHub repo in Vercel (framework preset: Next.js; defaults are fine).
2. Project Settings → Environment Variables: add `PERMITSTACK_API_KEY` (Production + Preview), marked Sensitive.
3. Deploy; preview URLs are created per branch/PR.
4. Custom domain: add `permitrewind.com` in Vercel → Domains, then at GoDaddy set an `A` record `@ → 76.76.21.21` and `CNAME www → cname.vercel-dns.com` (or follow the values Vercel shows).

## Second source: Polk County Accela

`src/lib/providers/polk-accela.ts` searches Polk County BOCC's public Accela Citizen Access portal
(https://aca-prod.accela.com/POLKCO; unincorporated Polk building permits, 2010+) the way a browser does
(anonymous GET + form postback, no login or captcha) by street number + street name, parcel number, or
permit number, parses the results grid (up to 5 pages), and links each record to its county detail page.
`composite.ts` runs PermitStack and Accela in parallel, dedupes by permit number, labels each row's source,
and shows a notice instead of failing if the county portal is slow (12 s timeout) or down.
Disable with `POLK_ACCELA_ENABLED=false`. City-issued permits (Lakeland, Bartow, etc.) and pre-2010 scanned
county records (ERecords) are not in Accela.
