/** Pulsing placeholder block; size/shape via className. */
export function Skeleton({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={`animate-pulse rounded bg-border ${className}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}

const CARD = "flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-4 shadow-sm";

/** Placeholder matching a ListingCard row. */
export function ListingCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className={CARD}>
      <Skeleton className="h-4 w-2/3" delay={delay} />
      <Skeleton className="h-3 w-1/2" delay={delay} />
      <div className="mt-1 flex gap-1.5">
        <Skeleton className="h-6 w-20 rounded-lg" delay={delay} />
        <Skeleton className="h-6 w-20 rounded-lg" delay={delay} />
      </div>
    </div>
  );
}

/** Placeholder matching PageHero. */
export function HeroSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-5 shadow-sm">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}
