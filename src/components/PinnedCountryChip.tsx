"use client";

import { startTransition, useOptimistic } from "react";
import { MapPin, X } from "lucide-react";
import Link from "next/link";
import { togglePinCountryAction } from "@/app/actions";
import { useToast } from "@/components/ui";

/** Nav chip for a pinned country; unpinning hides it optimistically. */
export function PinnedCountryChip({ country }: { country: string }) {
  const toast = useToast();
  const [visible, setVisible] = useOptimistic(true);

  function unpin() {
    startTransition(async () => {
      setVisible(false);
      const fd = new FormData();
      fd.set("country", country);
      const res = await togglePinCountryAction(fd);
      if (!res.ok) toast({ message: res.error, tone: "danger" });
    });
  }

  if (!visible) return null;
  return (
    <span className="group inline-flex shrink-0 items-center overflow-hidden rounded-full border border-teal-line bg-teal-soft text-xs font-medium text-teal-ink">
      <Link
        href={`/?country=${encodeURIComponent(country)}`}
        title={`Show ${country} jobs`}
        className="inline-flex min-h-8 pointer-coarse:min-h-11 items-center gap-1 py-1 pl-2.5 pr-1 hover:text-teal-ink"
      >
        <MapPin className="h-3.5 w-3.5 text-primary" />
        {country}
      </Link>
      <button
        type="button"
        onClick={unpin}
        title={`Unpin ${country}`}
        aria-label={`Unpin ${country}`}
        className="inline-flex min-h-8 min-w-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11 items-center justify-center p-1.5 text-teal-400 transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-500"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
