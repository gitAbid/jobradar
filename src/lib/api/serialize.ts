import { countryFacetValue } from "@/lib/facets";
import type { FilterableListing, RemoteScope } from "@/lib/types";

/** The consumer-facing job shape — personal/workflow fields excluded. */
export interface PublicJob {
  id: number;
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  country: string;
  isRemote: boolean;
  remoteScope: RemoteScope;
  visaSponsorship: boolean;
  tags: string[];
  skills: string[];
  url: string;
  postedAt: string | null;
  deadline: string | null;
  fetchedAt: string;
  description: string;
}

export function toPublicJob(l: FilterableListing): PublicJob {
  return {
    id: l.id,
    source: l.boardName,
    externalId: l.externalId,
    title: l.title,
    company: l.company,
    location: l.location,
    country: countryFacetValue(l),
    isRemote: l.isRemote,
    remoteScope: l.remoteScope,
    visaSponsorship: l.visaSponsorship,
    tags: l.tags,
    skills: l.skills,
    url: l.url,
    postedAt: l.postedAt,
    deadline: l.deadline,
    fetchedAt: l.fetchedAt,
    description: l.description,
  };
}
