"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import { healthSaysDbDown, isDbUnavailableError } from "@/lib/error-state";

/** Shared body of every route-level error boundary. */
export function ErrorState({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [dbDown, setDbDown] = useState(() => isDbUnavailableError(error));

  useEffect(() => {
    console.error(error);
    if (dbDown) return;
    // Production redacts server errors; ask the health endpoint whether the DB is the cause.
    const ctrl = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => healthSaysDbDown(res.status, await res.json().catch(() => null)))
      .then((down) => down && setDbDown(true))
      .catch(() => {});
    return () => ctrl.abort();
  }, [error, dbDown]);

  return (
    <div role="alert" className="mx-auto max-w-xl py-6">
      <EmptyState
        title={dbDown ? "Service temporarily unavailable" : "Something went wrong"}
        description={
          dbDown
            ? "We can't reach the database right now. This is usually brief — please try again in a moment."
            : "An unexpected error occurred while loading this page. You can try again."
        }
        action={<Button onClick={() => retry()}>Retry</Button>}
      />
      {error.digest && <p className="mt-3 text-center text-xs text-muted">Reference: {error.digest}</p>}
    </div>
  );
}
