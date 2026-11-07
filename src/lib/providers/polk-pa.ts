import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import type { PermitProvider } from "./types";
import { Permit, SearchQuery, SearchResult } from "../types";
import { parseAddress } from "./polk-accela";
import { parseAddressQuery, permitAddressMatches } from "../address";
import { foldAddressCase, sameAddressCase, streetNameForms, streetNamesMatch } from "../address-normalize";
import { shouldMergePolkSources } from "../jurisdictions";

/**
 * Polk County Property Appraiser permit file (ftp_permit.zip), preprocessed by
 * scripts/build-pa-permits.py into gzipped JSON shards under data/pa/.
 * Covers permits from the county AND all cities that can affect taxable value
 * (new homes, additions, pools, etc.), back to the 1990s. No contractor names.
 */
const DIR = path.join(process.cwd(), "data", "pa");
const SOURCE = "Polk County Property Appraiser";
type Rec = [string, string | null, string, string | null, string | null, string | null, string | null, string | null, number | null, string, string, string, string];
const cache = new Map<string, Rec[]>();

async function loadShard(name: string): Promise<Rec[]> {
  const hit = cache.get(name);
  if (hit) return hit;
  let recs: Rec[] = [];
  try {
    recs = JSON.parse(gunzipSync(await fs.readFile(path.join(DIR, `${name}.json.gz`))).toString("utf8"));
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
  if (cache.size > 40) cache.clear();
  cache.set(name, recs);
  return recs;
}

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function toPermit(r: Rec): Permit {
  const [num, agency, type, desc, status, issued, final, co, value, parcel, siteNum, street] = r;
  const isCity = agency && agency !== "POLK COUNTY";
  return {
    id: `polk-pa:${parcel}:${num}`,
    permitNumber: num,
    status: status ?? null,
    category: type,
    tags: [],
    description: desc,
    address: [siteNum, street].filter(Boolean).join(" ") || null,
    city: isCity ? title(agency!) : null,
    state: "FL",
    zip: null,
    parcelId: parcel,
    jurisdiction: agency ? title(agency) : null,
    dateFiled: null,
    dateIssued: issued,
    dateCompleted: final ?? co,
    estimatedValue: value,
    contractorName: null,
    ownerName: null,
    propertyType: type.startsWith("COM") ? "COMMERCIAL" : type.startsWith("RES") ? "RESIDENTIAL" : null,
    latitude: null,
    longitude: null,
    source: SOURCE,
    sourceUrl: `https://www.polkflpa.gov/CamaDisplay.aspx?OutputMode=Display&SearchType=RealEstate&ParcelID=${parcel}`,
  };
}

export class PolkPAProvider implements PermitProvider {
  name = SOURCE;

  appliesTo(query: SearchQuery): boolean {
    return shouldMergePolkSources(query);
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const q = query.q.trim();
    let recs: Rec[] = [];
    if (query.mode === "parcel") {
      const p = q.replace(/[^0-9]/g, "");
      if (p.length >= 2) recs = (await loadShard(`parcel-${p.slice(-2)}`)).filter((r) => r[9] === p);
    } else if (query.mode === "address") {
      const parsed = parseAddressQuery(q);
      const { number, street } = parseAddress(q);
      const key = street.replace(/[^A-Z0-9]/g, "").slice(0, 2).padEnd(2, "_");
      if (street) {
        const forms = streetNameForms(street);
        recs = (await loadShard(`addr-${key}`)).filter((r) => {
          const stored = r[12];
          const sameStreet = forms.some((form) => {
            const left = foldAddressCase(stored);
            const right = foldAddressCase(form);
            return left === right || left.startsWith(`${right} `) || streetNamesMatch(stored, form);
          });
          return sameStreet && (!number || sameAddressCase(r[10], number));
        });
      }
      const matched = recs.map(toPermit).filter((permit) => permitAddressMatches(parsed, permit, query.city));
      const permits = matched.slice(0, 200);
      return { permits, total: matched.length, page: 1, perPage: permits.length, notices: [] };
    } else {
      return { permits: [], total: 0, page: 1, perPage: 0, notices: [] };
    }
    const permits = recs.slice(0, 200).map(toPermit);
    return { permits, total: recs.length, page: 1, perPage: permits.length, notices: [] };
  }

  async getPermit(): Promise<Permit | null> {
    return null;
  }
}
