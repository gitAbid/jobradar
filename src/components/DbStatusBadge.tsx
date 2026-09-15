"use client";

import { useEffect, useState } from "react";
import { CloudOff, Database } from "lucide-react";

interface DbStatusPayload {
  mode: "local-first" | "remote-direct";
  remote: "up" | "down" | "unconfigured";
  queueDepth: number;
  local: { available: boolean; lastHydratedAt: string | null; listings: number };
}

/**
 * Header pill for the data-layer state. Invisible while the remote database
 * is healthy (the normal case); shows an amber "local mode" notice while the
 * app runs on the on-device store because the remote is down or over limits.
 */
export function DbStatusBadge() {
  const [status, setStatus] = useState<DbStatusPayload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/db-status", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as DbStatusPayload;
        if (alive) setStatus(payload);
      } catch {
        // status display must never be noisy
      }
    };
    void load();
    const timer = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!status || status.remote === "up") return null;

  const waiting = status.queueDepth > 0;
  const label = !status.local.available
    ? "DB unreachable"
    : waiting
      ? `Local mode · ${status.queueDepth} change${status.queueDepth === 1 ? "" : "s"} waiting to sync`
      : "Local mode · DB offline";

  return (
    <span
      title={`Remote database ${status.remote}. The app is running on the on-device cache${
        status.local.lastHydratedAt
          ? ` (synced ${new Date(status.local.lastHydratedAt).toLocaleString()})`
          : ""
      }. Changes sync automatically when it recovers.`}
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800"
    >
      {status.local.available ? (
        <Database className="h-3.5 w-3.5" />
      ) : (
        <CloudOff className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">Local</span>
    </span>
  );
}
