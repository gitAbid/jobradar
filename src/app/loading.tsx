import { HeroSkeleton, ListingCardSkeleton, Skeleton } from "@/components/Skeleton";

/** Dashboard fallback: hero, facet sidebar + listing list. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading jobs">
      <HeroSkeleton />
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        <div className="hidden w-64 shrink-0 flex-col gap-3 lg:flex">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" delay={i * 120} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton className="h-11 w-full rounded-xl" />
          {[0, 1, 2, 3, 4].map((i) => (
            <ListingCardSkeleton key={i} delay={i * 120} />
          ))}
        </div>
      </div>
    </div>
  );
}
