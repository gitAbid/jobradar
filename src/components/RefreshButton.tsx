"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import {
  ensurePolling,
  isRunActive,
  startRefresh,
  useRefreshStatus,
} from "@/lib/refresh-client";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const state = useRefreshStatus();
  const busy = isRunActive(state);

  return (
    <button
      type="button"
      onClick={() => {
        void startRefresh();
        startTransition(() => router.refresh());
        ensurePolling();
      }}
      disabled={busy || pending}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3.5 text-sm font-semibold text-slate-900 shadow-sm transition-colors hover:bg-teal-50 hover:text-teal-900 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
    >
      <RefreshCw className={`h-4 w-4 ${busy || pending ? "animate-spin" : ""}`} />
      {busy ? "Refreshing..." : pending ? "Updating..." : "Refresh now"}
    </button>
  );
}
