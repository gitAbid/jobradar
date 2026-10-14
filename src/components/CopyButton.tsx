"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <>
    <button
      type="button"
      aria-label="Copy to clipboard"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      {copied ? <Check className="h-4 w-4 text-teal-600" /> : <Copy className="h-4 w-4" />}
    </button>
    <span role="status" aria-live="polite" className="sr-only">
      {copied ? "Copied to clipboard" : ""}
    </span>
    </>
  );
}
