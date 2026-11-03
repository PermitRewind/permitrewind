import "server-only";
import type { PermitProvider } from "./types";
import { PermitStackProvider } from "./permitstack";
import { PolkAccelaProvider } from "./polk-accela";
import { CompositeProvider } from "./composite";

let provider: PermitProvider | null = null;

/** PermitStack is primary; county portals are merged in. Set POLK_ACCELA_ENABLED=false to disable. */
export function getProvider(): PermitProvider {
  if (!provider) {
    const extras: PermitProvider[] = [];
    if (process.env.POLK_ACCELA_ENABLED !== "false") extras.push(new PolkAccelaProvider());
    provider = new CompositeProvider(new PermitStackProvider(process.env.PERMITSTACK_API_KEY), extras);
  }
  return provider;
}
