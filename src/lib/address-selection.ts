import { createHmac, timingSafeEqual } from "node:crypto";
import { parseAddressQuery } from "./address";
import { sameAddressCase } from "./address-normalize";

/** Shown when an address was not chosen from the suggestion list. */
export const ADDRESS_SELECTION_MESSAGE =
  "Check the spelling or try a nearby cross street, then choose an address from the list.";

const TTL_MS = 30 * 60 * 1000;

export interface AddressSelection {
  label: string;
  street: string;
  city: string | null;
  state: "FL";
  zip: string | null;
  unitType: string | null;
  unitNumber: string | null;
  county: string | null;
  /** Nominatim point, when that geocoder response included one. Optional Street View fallback. */
  lat?: number;
  /** Nominatim point, when that geocoder response included one. Optional Street View fallback. */
  lng?: number;
  exp: number;
}

function secret(): string {
  return process.env.ADDRESS_SELECTION_SECRET || process.env.PERMITSTACK_API_KEY || "permitrewind-dev-selection";
}

function signBody(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

function coordinatePair(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function applyCoordinates(payload: AddressSelection): void {
  const pair = coordinatePair(payload.lat, payload.lng);
  if (!pair) {
    delete payload.lat;
    delete payload.lng;
    return;
  }
  payload.lat = pair.lat;
  payload.lng = pair.lng;
}

export function signAddressSelection(
  input: Omit<AddressSelection, "exp" | "unitType" | "unitNumber" | "county"> & Partial<Pick<AddressSelection, "unitType" | "unitNumber" | "county" | "exp">>,
  now = Date.now(),
): string {
  const payload: AddressSelection = {
    unitType: null,
    unitNumber: null,
    county: "Polk",
    ...input,
    exp: input.exp ?? now + TTL_MS,
  };
  applyCoordinates(payload);
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signBody(body)}`;
}

export function readAddressSelection(token: string | null | undefined, now = Date.now()): AddressSelection | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = signBody(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AddressSelection;
    if (!payload?.label || !payload.street || payload.state !== "FL" || typeof payload.exp !== "number") return null;
    if (payload.exp < now) return null;
    applyCoordinates(payload);
    return payload;
  } catch {
    return null;
  }
}

export interface AddressSubmission {
  ok: true;
  selection: AddressSelection;
}

export interface AddressRejection {
  ok: false;
  message: string;
}

/** Accept only a signed suggestion for this street. Letter case does not count. City, ZIP, and county may be edited after the pick. */
export function evaluateAddressSubmission(q: string, token: string | null | undefined, now = Date.now()): AddressSubmission | AddressRejection {
  const streetText = q.trim();
  const parsed = parseAddressQuery(streetText);
  const selection = readAddressSelection(token, now);
  if (!selection || !sameAddressCase(selection.street, streetText) || !parsed.number || !parsed.streetName) {
    return { ok: false, message: ADDRESS_SELECTION_MESSAGE };
  }
  const street = parseAddressQuery(selection.street);
  if (!street.number || !street.streetName) return { ok: false, message: ADDRESS_SELECTION_MESSAGE };
  return { ok: true, selection };
}

