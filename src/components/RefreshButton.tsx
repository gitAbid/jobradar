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
      {note && <span className="text-xs text-emerald-600">{note}</span>}
      <button
        onClick={refresh}
        disabled={busy || pending}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${busy || pending ? "animate-spin" : ""}`} />
        Refresh now
      </button>
    </div>
  );
}
