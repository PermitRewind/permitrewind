import "server-only";
import type { PermitProvider } from "./types";
import { PermitStackProvider } from "./permitstack";
import { PolkAccelaProvider } from "./polk-accela";
import { CompositeProvider } from "./composite";
import { PolkPAProvider } from "./polk-pa";

let provider: PermitProvider | null = null;

/** PermitStack (statewide Florida) is primary. Polk portals merge in for Polk searches. Set POLK_ACCELA_ENABLED=false to disable. */
export function getProvider(): PermitProvider {
  if (!provider) {
    const extras: PermitProvider[] = [];
    if (process.env.POLK_ACCELA_ENABLED !== "false") extras.push(new PolkAccelaProvider());
    if (process.env.POLK_PA_ENABLED !== "false") extras.push(new PolkPAProvider());
    provider = new CompositeProvider(new PermitStackProvider(process.env.PERMITSTACK_API_KEY), extras);
  }
  return provider;
}
