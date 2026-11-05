import { createHmac, timingSafeEqual } from "node:crypto";
import { parseAddressQuery } from "./address";

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
  exp: number;
}

function secret(): string {
  return process.env.ADDRESS_SELECTION_SECRET || process.env.PERMITSTACK_API_KEY || "permitrewind-dev-selection";
}

function signBody(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
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

/** Accept only a signed suggestion for this street. City, ZIP, and county may be edited after the pick. */
export function evaluateAddressSubmission(q: string, token: string | null | undefined, now = Date.now()): AddressSubmission | AddressRejection {
  const streetText = q.trim();
  const parsed = parseAddressQuery(streetText);
  const selection = readAddressSelection(token, now);
  if (!selection || selection.street !== streetText || !parsed.number || !parsed.streetName) {
    return { ok: false, message: ADDRESS_SELECTION_MESSAGE };
  }
  const street = parseAddressQuery(selection.street);
  if (!street.number || !street.streetName) return { ok: false, message: ADDRESS_SELECTION_MESSAGE };
  return { ok: true, selection };
}

