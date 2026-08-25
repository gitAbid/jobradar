"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

function beep() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio not available — ignore */
  }
}

export function RefreshButton({ soundEnabled }: { soundEnabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = (await res.json()) as { totalInserted?: number };
      if (soundEnabled && (data.totalInserted ?? 0) > 0) beep();
      setNote(
        (data.totalInserted ?? 0) > 0
          ? `+${data.totalInserted} new`
          : "up to date",
      );
    } catch {
      setNote("refresh failed");
    } finally {
      setBusy(false);
      startTransition(() => router.refresh());
      setTimeout(() => setNote(null), 4000);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {note && (
        <span aria-live="polite" className={`rounded-full px-2.5 py-1 text-xs font-semibold ${note === "refresh failed" ? "bg-rose-100 text-rose-800" : "bg-teal-100 text-teal-800"}`}>
          {note}
        </span>
      )}
      <button
        type="button"
        onClick={refresh}
        disabled={busy || pending}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3.5 text-sm font-semibold text-slate-900 shadow-sm transition-colors hover:bg-teal-50 hover:text-teal-900 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
      >
        <RefreshCw className={`h-4 w-4 ${busy || pending ? "animate-spin" : ""}`} />
        {busy || pending ? "Refreshing..." : "Refresh now"}
      </button>
    </div>
  );
}
