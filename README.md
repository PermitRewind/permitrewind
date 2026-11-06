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
| `DAVENPORT_IWORQ_ENABLED` | no | Set to `false` to skip the City of Davenport iWorQ harvest and portal. |
| `DAVENPORT_CAPTCHA_API_KEY` | no | Solver key for Davenport addresses that are not in the harvest cache. Server-only. Not required once the address is cached. |
| `DAVENPORT_CAPTCHA_PROVIDER` | no | `2captcha` (default) or `anticaptcha`. |

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

`status` is `ok`, `empty`, `throttled`, or `unavailable`. `zip` and `city` are `null` when Nominatim does not have them. Choosing a suggestion fills the separate fields and enables Search. Typing a matching address without choosing it does not. A full street-and-city query that Nominatim misses (the Plant City house has no city tag, so `3533 Sam Allen Oaks Cir Plant City` is empty until the street is tried alone) is retried without the city, and a parsed suggestion is still offered when both lookups miss.

The address form is separate fields: street, city, state, ZIP, and county (Polk by default, any Florida county). Apt/Unit/Suite fields appear only when the chosen suggestion includes a unit. City stays editable after a pick. If Nominatim names a different city than the one in the typed query, the typed city is kept (so `3749 Feather Dr Lakeland` is not rewritten to Highland City).

When a permitting city is set, that city is the rank and other cities are left out while it still matches. `605 South Central Avenue` with city Bartow returns the Bartow permit and does not return a Winter Haven permit. “Include other cities” keeps the other cities after the selected one. An unofficial place name (a census place such as Highland City, or any label that is not a permitting city) is not a hard filter. The street is searched, Polk County sources still run when the county is Polk, and ZIP or county keeps the overlapping city — so `3938 WhiteDove Dr` in Highland City returns the same Lakeland permits as a Lakeland search. If a real city filter would drop every row, the search retries with ZIP or county instead of returning nothing. PermitStack is sent `state` plus an abbreviated `address` (`605 S Central Ave`, not the spelled-out Nominatim line) and `city` only when that city issues permits. `zip_code` is not sent: filters are AND, and a Nominatim ZIP or a blank permit ZIP would hide the row. If that query is empty, the search retries with the core street name (`Central`) and then without city. A compound street is queried with and without the space (`WhiteDove` and `White Dove`, `OakRidge` and `Oak Ridge`). County and unit stay on the selection token and on the result when the record has them.

Address search runs only after a suggestion is chosen. The Search button stays off until then, and editing the text clears the choice. Each suggestion includes an opaque `token`. `GET /api/search` and the results page require that token in `sel` and check that the address has a street number and street name before calling PermitStack. A pasted or bookmarked address without `sel` is not searched; the page asks the visitor to check the spelling or try a nearby cross street and pick from the list. Parcel and permit search do not use `sel`.

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

`npm test` runs `src/lib/coverage.test.ts`, `src/lib/address.test.ts`, `src/lib/providers/search-coverage.test.ts`, `src/lib/providers/davenport-iworq.test.ts`, and `src/lib/providers/davenport-harvest.test.ts`. The suite mocks PermitStack, so it does not need `PERMITSTACK_API_KEY`. It checks that:

- `19156 Dove Creek Dr` keeps three Tampa / Hillsborough PermitStack rows and does not add a "hidden" notice
- `3749 Feather Dr, Lakeland, FL` still merges Polk County Accela and Property Appraiser rows onto PermitStack
- a Tampa city filter does not call the Polk portals
- PermitStack ids route to `/permit/[id]`
- user-facing copy describes Florida coverage
- `1832 Buckeye Rd, Davenport, FL` resolves permit 210405 from the Davenport harvest cache, an empty address returns nothing, and ingesting the same HTML twice does not duplicate the row

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

## City of Davenport iWorQ

`src/lib/providers/davenport-iworq.ts` runs only when the city or the address says Davenport. Lakeland, Tampa, and a street with no city do not call it. It merges beside PermitStack and the Polk county sources. Rows are labeled `City of Davenport · city only`.

Address search reads `data/davenport-harvest.json` first (version 1, permits plus an address index). Street, city, and ZIP match loosely, so `1832 Buckeye Rd, Davenport, FL` hits `1832 BUCKEYE RD` and returns permit 210405 (issued 2021-06-25, completed 2022-04-18, Finaled) with captcha disabled. `DAVENPORT_CAPTCHA_*` is optional once the address is in that cache.

The portal is https://portal.iworq.net/DAVENPORT/permits/600. A live address search is `searchField=text6&search=1832%20Buckeye` (house number plus street name, suffix dropped). That request is invisible reCAPTCHA v2 (site key `6Les_AYkAAAAACw9NzcxkcDVfvExxeyw2KS1cao_`). A request with no token is HTTP 302 back to the form, and a 2captcha token often fails the same way because the portal binds the challenge to the solver IP. Detail pages are public: https://portal.iworq.net/DAVENPORT/permit/600/15350875 is permit 210405 at 1832 BUCKEYE RD.

Addresses that are not in the harvest cache:

1. Reuse the `iworq_api_session` cookie from a search that already passed, for about 90 minutes on that server instance.
2. Otherwise, if `DAVENPORT_CAPTCHA_API_KEY` is set, solve the invisible challenge with 2captcha (`DAVENPORT_CAPTCHA_PROVIDER=2captcha`, the default) or anti-captcha (`DAVENPORT_CAPTCHA_PROVIDER=anticaptcha`). The key is an environment variable. It is not in the repo.
3. Parse the results table, keep the house, then open the detail page with no captcha.

A cache miss with no solver key adds a notice and does not call the portal. Statewide and Polk results still return. Disable the source with `DAVENPORT_IWORQ_ENABLED=false`. A live test for an uncached address runs only when `DAVENPORT_CAPTCHA_API_KEY` is set.

Refresh the cache: solve the captcha in a real browser, save the search results HTML and any permit detail HTML, then:

```bash
npx tsx scripts/ingest-davenport-harvest.ts path/to/search.html path/to/detail.html
# writes data/davenport-harvest.json; running it again is idempotent
```

Commit that JSON (and the HTML under `fixtures/davenport-iworq/` if you want the capture in git) and deploy.
