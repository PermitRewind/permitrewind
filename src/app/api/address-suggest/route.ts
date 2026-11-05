import { NextRequest, NextResponse } from "next/server";
import { suggestFloridaAddresses } from "@/lib/address-suggest";

/**
 * GET /api/address-suggest?q=3533%20Sam%20Allen
 *
 * JSON body:
 * {
 *   "query": "3533 Sam Allen",
 *   "suggestions": [
 *     {
 *       "label": "3533 Sam Allen Oaks Circle, Plant City, FL 33563",
 *       "street": "3533 Sam Allen Oaks Circle",
 *       "city": "Plant City",
 *       "state": "FL",
 *       "zip": "33563"
 *     }
 *   ],
 *   "attribution": "© OpenStreetMap contributors",
 *   "status": "ok" | "empty" | "throttled" | "unavailable"
 * }
 *
 * No PermitStack key or other secret is read or returned. Suggestions come from
 * OpenStreetMap Nominatim, paced to one upstream request per second.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const body = await suggestFloridaAddresses(q, { signal: req.signal });
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
