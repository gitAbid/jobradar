import { Skeleton } from "@/components/Skeleton";

/** Onboarding fallback: the card with heading and form fields. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-surface-raised p-6 shadow-sm" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-6 h-11 w-full rounded-xl" />
      <Skeleton className="mt-6 h-24 w-full rounded-xl" delay={120} />
    </div>
  );
}
