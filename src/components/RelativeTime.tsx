"use client";

import { useSyncExternalStore } from "react";
import { isoDate, timeAgo } from "@/lib/time";

const noopSubscribe = () => () => {};

/**
 * Server and first client render show the absolute ISO date (identical, so no
 * hydration drift); after mount the text becomes relative ("3d ago").
 */
export function RelativeTime({ iso, prefix }: { iso: string; prefix?: string }) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <>
      {prefix}
      <time dateTime={iso} title={mounted ? iso : undefined}>
        {mounted ? timeAgo(iso) : isoDate(iso)}
      </time>
    </>
  );
}
