// ── Shared domain types ────────────────────────────────────────────────────

export type BoardType = "api" | "rss";

export interface Board {
  id: number;
  name: string;
  type: BoardType;
  url: string;
  enabled: boolean;
  /** extra per-board keywords, e.g. ["visa sponsorship"] */
  filterKeywords: string[];
  lastFetchedAt: string | null;
  lastStatus: string | null;
  fetchIntervalHours: number;
}

export type ListingStatus = "new" | "favorite" | "applied" | "hidden";

/** Where a remote job may be performed from. null = not remote. */
export type RemoteScope = "anywhere" | "restricted" | null;

export interface Listing {
  id: number;
  boardId: number;
  boardName: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  visaSponsorship: boolean;
  remoteScope: RemoteScope;
  tags: string[];
  /** tech skills detected from title/tags/description via vocabulary */
  skills: string[];
  url: string;
  postedAt: string | null;
  fetchedAt: string;
  status: ListingStatus;
  userTags: string[];
}

/** A listing row joined with its board's keywords — used by the filter engine. */
export interface FilterableListing extends Listing {
  boardFilterKeywords: string[];
  /** lowercased title+company+location+tags+description blob */
  searchText: string;
}

/** Normalized shape every adapter must produce before insertion. */
export interface NormalizedListing {
  externalId: string;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  visaSponsorship: boolean;
  remoteScope?: RemoteScope | null;
  tags: string[];
  url: string;
  postedAt: string | null;
  description: string;
}

export interface FetchResult {
  listings: NormalizedListing[];
}
