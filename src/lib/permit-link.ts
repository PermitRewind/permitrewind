/** PermitStack ids are 36-character ids. County-only records use prefixed ids and link out. */
const PERMITSTACK_ID = /^[0-9a-f-]{36}$/i;

export function isPermitStackId(id: string): boolean {
  return PERMITSTACK_ID.test(id);
}

export type PermitLinkTarget =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string }
  | { kind: "none" };

/** Internal detail routes are for PermitStack records, including cities outside Polk. */
export function permitLinkTarget(p: { id: string; sourceUrl?: string | null }): PermitLinkTarget {
  if (isPermitStackId(p.id)) return { kind: "internal", href: `/permit/${p.id}` };
  if (p.sourceUrl) return { kind: "external", href: p.sourceUrl };
  return { kind: "none" };
}
