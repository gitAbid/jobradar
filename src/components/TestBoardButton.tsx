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
        className="inline-flex items-center gap-1 min-h-8 pointer-coarse:min-h-11 rounded-lg border border-border px-2 py-1 text-xs text-muted hover:border-border-strong disabled:opacity-50"
      >
        <FlaskConical aria-hidden="true" className="h-3.5 w-3.5" /> Test
      </button>
      <span role="status" aria-live="polite">
      {result && (
        <span className={`text-xs ${result.startsWith("OK") ? "text-emerald-ink" : result.startsWith("Failed") ? "text-danger" : "text-muted"}`}>
          {result}
        </span>
      )}
      </span>
    </span>
  );
}
