import type { Permit, SearchQuery, SearchResult } from "../types";

/** Any permit data source implements this. Swap providers in providers/index.ts. */
export interface PermitProvider {
  name: string;
  search(query: SearchQuery): Promise<SearchResult>;
  getPermit(id: string): Promise<Permit | null>;
}
