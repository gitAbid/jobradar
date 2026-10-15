import { Skeleton } from "@/components/Skeleton";

/** Settings fallback: header plus a few stacked sections. */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8" aria-busy="true" aria-label="Loading settings">
      <div>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-2 h-8 w-40" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <Skeleton className="h-5 w-32" delay={i * 120} />
          <Skeleton className="mt-3 h-20 w-full rounded-2xl" delay={i * 120} />
        </div>
      ))}
    </div>
  );
}
