import { HeroSkeleton, ListingCardSkeleton, Skeleton } from "@/components/Skeleton";

/** Prefetchable fallback for /following — company chips then listing cards. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading followed openings">
      <HeroSkeleton />
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-28 rounded-full" delay={i * 120} />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <ListingCardSkeleton key={i} delay={i * 120} />
        ))}
      </div>
    </div>
  );
}
