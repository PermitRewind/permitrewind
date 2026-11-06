import { NextRequest, NextResponse } from "next/server";
import { loadStreetView, STREET_VIEW_UNAVAILABLE } from "@/lib/streetview";

export const dynamic = "force-dynamic";

/**
 * GET /api/streetview?address=10%20Main%20Street%2C%20Lakeland%2C%20FL%2033801&lat=&lng=
 *
 * Proxies one Street View photo. The Google key stays in
 * GOOGLE_STREET_VIEW_API_KEY. Metadata is checked first (free). The Static
 * image is fetched only when that status is OK. A miss, a missing key, or an
 * upstream failure is JSON — never an image tag pointed at Google.
 */
function unavailable(reason: string, cacheControl: string) {
  return NextResponse.json(
    { status: "unavailable", message: STREET_VIEW_UNAVAILABLE, reason },
    { status: 404, headers: { "Cache-Control": cacheControl, "Content-Type": "application/json" } },
  );
}

function numberParam(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const lat = numberParam(req.nextUrl.searchParams.get("lat"));
  const lng = numberParam(req.nextUrl.searchParams.get("lng"));
  try {
    const result = await loadStreetView({ address, lat, lng });
    if (!result.ok) {
      const cacheControl = result.reason === "no_imagery" ? "private, max-age=3600" : "no-store";
      return unavailable(result.reason, cacheControl);
    }
    return new NextResponse(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=86400",
        "X-Street-View-Cache": result.cache,
      },
    });
  } catch {
    return unavailable("upstream", "no-store");
  }
}
