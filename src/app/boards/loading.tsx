import { HeroSkeleton, Skeleton } from "@/components/Skeleton";

/** Boards fallback: hero, add-board form, board cards, settings. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading boards">
      <HeroSkeleton />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" delay={i * 120} />
        ))}
      </div>
      <Skeleton className="h-36 w-full rounded-2xl" />
    </div>
  );
}
