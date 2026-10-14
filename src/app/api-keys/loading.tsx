import { Skeleton } from "@/components/Skeleton";

/** API keys fallback: header, create form, key list. */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" aria-busy="true" aria-label="Loading API keys">
      <div>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-2 h-7 w-40" />
        <Skeleton className="mt-3 h-4 w-full" />
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface-raised">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="flex-1">
              <Skeleton className="h-4 w-1/3" delay={i * 120} />
              <Skeleton className="mt-2 h-3 w-24" delay={i * 120} />
            </div>
            <Skeleton className="h-8 w-16 rounded-lg" delay={i * 120} />
          </div>
        ))}
      </div>
    </div>
  );
}
