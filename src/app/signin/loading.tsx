import { Skeleton } from "@/components/Skeleton";

/** Sign-in fallback: the card with heading and provider buttons. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-sm" aria-busy="true" aria-label="Loading sign-in">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-3 h-4 w-56" />
      <Skeleton className="mt-5 h-11 w-full rounded-xl" />
      <Skeleton className="mt-3 h-11 w-full rounded-xl" delay={120} />
    </div>
  );
}
