"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";

export function TestBoardButton({ boardId }: { boardId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  async function test() {
    setResult("testing…");
    const { testBoardAction } = await import("@/app/actions");
    const res = await testBoardAction(boardId);
    setResult(res.message);
    startTransition(() => router.refresh());
    setTimeout(() => setResult(null), 6000);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={test}
        disabled={pending}
        title="Dry-run fetch this board"
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-slate-400 disabled:opacity-50"
      >
        <FlaskConical className="h-3.5 w-3.5" /> Test
      </button>
      {result && (
        <span className={`text-xs ${result.startsWith("✅") ? "text-emerald-600" : result.startsWith("❌") ? "text-red-600" : "text-slate-500"}`}>
          {result}
        </span>
      )}
    </span>
  );
}
