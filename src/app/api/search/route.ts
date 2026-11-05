import { NextRequest, NextResponse } from "next/server";
import { evaluateAddressSubmission } from "@/lib/address-selection";
import { getProvider } from "@/lib/providers";
import { ProviderError, SearchMode } from "@/lib/types";

/** JSON search endpoint for statewide Florida. The API key stays on the server. */
export async function GET(req: NextRequest) {
  const s = req.nextUrl.searchParams;
  const q = (s.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ error: "q must be at least 2 characters" }, { status: 400 });
  const mode = (["address", "parcel", "permit"].includes(s.get("mode") ?? "") ? s.get("mode") : "address") as SearchMode;
  if (mode === "address") {
    const gate = evaluateAddressSubmission(q, s.get("sel"));
    if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: 422 });
  }
  try {
    const result = await getProvider().search({
      mode, q,
      city: s.get("city") ?? undefined, category: s.get("category") ?? undefined, status: s.get("status") ?? undefined,
      dateFrom: s.get("from") ?? undefined, dateTo: s.get("to") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status });
  }
}
