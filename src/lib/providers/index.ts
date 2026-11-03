import "server-only";
import type { PermitProvider } from "./types";
import { PermitStackProvider } from "./permitstack";

let provider: PermitProvider | null = null;

export function getProvider(): PermitProvider {
  if (!provider) provider = new PermitStackProvider(process.env.PERMITSTACK_API_KEY);
  return provider;
}
