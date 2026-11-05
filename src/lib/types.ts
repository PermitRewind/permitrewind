export type SearchMode = "address" | "parcel" | "permit";

export interface Permit {
  id: string;
  permitNumber: string | null;
  status: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  parcelId: string | null;
  jurisdiction: string | null;
  dateFiled: string | null;
  dateIssued: string | null;
  dateCompleted: string | null;
  dateExpired?: string | null;
  estimatedValue: number | null;
  feeAmount?: number | null;
  contractorName: string | null;
  contractorLicense?: string | null;
  applicantName?: string | null;
  ownerName: string | null;
  propertyType: string | null;
  squareFootage?: number | null;
  stories?: number | null;
  units?: number | null;
  latitude: number | null;
  longitude: number | null;
  recordKind?: string | null;
  /** Data source label, e.g. "PermitStack" or "Polk County Accela". Display copies add statewide vs Polk-only scope. */
  source?: string;
  /** Link to the record on the source's own site, when available. */
  sourceUrl?: string | null;
  /** Other sources that also returned this permit (after merge). */
  alsoIn?: string[];
  /** Which source supplied dateCompleted after a merge. */
  finalFrom?: string;
}

export interface SearchQuery {
  mode: SearchMode;
  q: string;
  regionId?: string;
  city?: string;
  category?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
}

export interface SearchResult {
  permits: Permit[];
  total: number | null;
  page: number;
  perPage: number;
  /** Human-readable notes about data limits (e.g. free-tier window). */
  notices: string[];
}

export class ProviderError extends Error {
  constructor(message: string, public status = 500, public code?: string) {
    super(message);
  }
}
