# PermitRewind

Fast building-permit history lookups for **Florida**, built for home inspectors.
PermitStack supplies statewide records. Polk County searches also merge Polk County Accela and the Polk County Property Appraiser.
By Agner Building & Solutions (https://theagner.com).

Stack: Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · PermitStack API (server-side only).

## Setup

```bash
npm install
cp .env.example .env.local   # then set PERMITSTACK_API_KEY
npm run dev                  # http://localhost:3000
npm test                     # coverage and provider tests (no live API key required)
npm run build && npm start   # production
```

### Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `PERMITSTACK_API_KEY` | yes | PermitStack key (`X-API-Key`). Server-only — never prefix with `NEXT_PUBLIC_`. |
| `PERMITSTACK_BASE_URL` | no | Defaults to `https://api.permit-stack.com`. |
| `POLK_ACCELA_ENABLED` | no | Set to `false` to skip the Polk County Accela portal. |
| `POLK_PA_ENABLED` | no | Set to `false` to skip the Polk County Property Appraiser file. |

## Features

- Search by street address (primary), parcel ID, or permit number (`/search?mode=address|parcel|permit&q=...`)
- Filters: any Florida city (suggestions include Polk and other major cities), permit type, status, date range (passed to the API)
- Results table (desktop) / cards (mobile), permit detail page (`/permit/[id]`)
- Print-friendly CSS (Print button) and CSV export of current results
- Loading, empty, and error states (incl. API quota / plan-limit messages)
- About & Contact page; JSON proxy at `/api/search`
- Address typeahead (`/api/address-suggest`) for the address box. Parcel and permit search are unchanged.

## Address suggestions

PermitStack does not offer an autocomplete endpoint. `GET /api/address-suggest?q=` returns JSON from OpenStreetMap Nominatim, server-side only. The PermitStack key is not used and is not in the response. Requests are debounced in the browser, cached, and limited to one upstream call per second.

```json
{
  "query": "3533 Sam Allen",
  "suggestions": [
    {
      "label": "3533 Sam Allen Oaks Circle, Plant City, FL 33563",
      "street": "3533 Sam Allen Oaks Circle",
      "city": "Plant City",
      "state": "FL",
      "zip": "33563"
    }
  ],
  "attribution": "© OpenStreetMap contributors",
  "status": "ok"
}
```

`status` is `ok`, `empty`, `throttled`, or `unavailable`. `zip` and `city` are `null` when Nominatim does not have them. Choosing a suggestion fills `label` and runs the search. OSM coverage misses some new streets, so a typed address still searches.

Typed addresses are parsed before the PermitStack call. A normal suffix such as Dr is sent as typed, so `19156 Dove Creek Dr` is the same PermitStack query as before normalization and still returns all three Tampa rows (including roofing permit BTR-23-0567345). `3533 Sam Allen Oaks Cir Plant City` is the exception: Cir, Circle, and CR are widened to street `3533 Sam Allen Oaks` and city `Plant City`, then rows outside that suffix family (such as Blvd) are dropped. That keeps historical `SFR40294` with the modern Cir/Circle rows.

## Code map

- `src/lib/jurisdictions.ts` — Florida is the default statewide region. Polk County remains a county allowlist used only to decide when county sources merge.
- `src/lib/providers/types.ts` — `PermitProvider` interface; `permitstack.ts` implements it; `index.ts` selects it. `appliesTo` lets a source skip a query.
- `src/lib/types.ts` — normalized `Permit` / `SearchQuery` / `SearchResult`.
- `src/app/search/page.tsx`, `src/app/permit/[id]/page.tsx` — server components that call the provider.

## PermitStack notes

- Search uses `GET /v1/permits/search` with `state=FL` plus `address` / `parcel` / `permit_number`. The default region is statewide Florida, so a Tampa address such as `19156 Dove Creek Dr` is not discarded for being outside Polk County.
- An explicit `regionId` of `polk-fl` still allowlists Polk jurisdictions. The app does not send that id. Rows whose state is explicitly outside Florida are still hidden.
- Current key is on the **Indie** plan (1,000 requests/day, full history). The **free tier** allows 100 requests/day and only the last 30 days; Date filters older than that return HTTP 403 `feature_locked`
  on free keys older date filters return HTTP 403 `feature_locked` (shown to the user as a clear message). The 30-day notice in results only appears when the API reports a tier window. Responses are not cached (each search is one API request).
- Some Polk County PermitStack rows have `parcel_id: null`, so a parcel search may miss those until the source publishes parcels. Other Florida counties are unaffected.
- Each result is labeled `PermitStack · statewide Florida`. Polk-only rows are labeled `Polk County Accela · Polk County only` or `Polk County Property Appraiser · Polk County only`.
- PermitStack ids (36-character ids) open `/permit/[id]`, including records outside Polk. `polk-accela:` and `polk-pa:` ids link to the county site instead of the PermitStack detail route.

## Tests

`npm test` runs `src/lib/coverage.test.ts` and `src/lib/providers/search-coverage.test.ts`. The suite mocks PermitStack, so it does not need `PERMITSTACK_API_KEY`. It checks that:

- `19156 Dove Creek Dr` keeps three Tampa / Hillsborough PermitStack rows and does not add a "hidden" notice
- `3749 Feather Dr, Lakeland, FL` still merges Polk County Accela and Property Appraiser rows onto PermitStack
- a Tampa city filter does not call the Polk portals
- PermitStack ids route to `/permit/[id]`
- user-facing copy describes Florida coverage

If `PERMITSTACK_API_KEY` is set, one additional test calls the live API for `19156 Dove Creek Dr` and expects three permits at that house in Tampa. The key is read from the environment and is not printed.

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
`composite.ts` runs PermitStack and Accela in parallel when the search is in Polk (a Polk city filter, a city in the query such as `3749 Feather Dr, Lakeland, FL`, or an address with no city). A named city outside Polk, such as Tampa, does not call the county portal. Results are deduped by permit number. If the county portal is slow (12 s timeout) or down, the search shows a notice instead of failing.
Disable with `POLK_ACCELA_ENABLED=false`. City-issued permits (Lakeland, Bartow, etc.) and pre-2010 scanned
county records (ERecords) are not in Accela.

## Third source: Polk County Property Appraiser permit file

The Property Appraiser publishes `ftp_permit.zip` daily (layout:
https://www.polkflpa.gov/PCPA_FTP_DATA_HELP/FTP_PERMITFileLayout.html). It covers permits from the county
and every city that can change taxable value (new homes, additions, pools, etc.), back to the 1990s, but
not re-roofs, most trade work, or contractor names. `src/lib/providers/polk-pa.ts` reads it, labeled
"Polk County Property Appraiser", and dedupes against the others by permit number (legacy `200423` = `BLD-H-200423`
at the same house number). It uses the same Polk-only `appliesTo` gate as Accela.

Refresh (download the zip in a browser from the PA's FTP page; their firewall blocks scripts):

```bash
python3 scripts/build-pa-permits.py /path/to/ftp_permit.zip   # writes data/pa/*.json.gz (~25 MB)
```

`data/pa/` is gitignored (regenerated daily), so it must be present locally when deploying
(it is bundled via `outputFileTracingIncludes` in `next.config.ts`). If it's missing, that source
simply returns nothing. Disable with `POLK_PA_ENABLED=false`.
