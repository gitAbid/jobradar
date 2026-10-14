import { HeroSkeleton, Skeleton } from "@/components/Skeleton";

/** Prefetchable fallback for /saved — two pipeline columns of cards. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading pipeline">
      <HeroSkeleton />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((col) => (
          <section key={col} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
            <Skeleton className="h-5 w-24" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3">
                <Skeleton className="h-4 w-full" delay={(col * 3 + i) * 120} />
                <Skeleton className="h-3 w-2/3" delay={(col * 3 + i) * 120} />
                <Skeleton className="mt-1 h-6 w-full" delay={(col * 3 + i) * 120} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
