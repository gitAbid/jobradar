"use client";

import { Eye, Heart, Send } from "lucide-react";
import Link from "next/link";
import type { ListingStatus } from "@/lib/types";
import { StatusButton, useListingStatus } from "./StatusActions";

/** Favorite / Applied / Hide controls for a dashboard card. */
export function ListingStatusButtons({ id, status }: { id: number; status: ListingStatus }) {
  const { status: current, set, busy, target } = useListingStatus(id, status);
  return (
    <>
      <StatusButton status="favorite" active={current === "favorite"} title="Favorite" busy={busy} pending={target === "favorite"} onClick={() => set("favorite")}>
        <Heart className="h-3.5 w-3.5" /> Favorite
      </StatusButton>
      <StatusButton status="applied" active={current === "applied"} title="Mark applied" busy={busy} pending={target === "applied"} onClick={() => set("applied")}>
        <Send className="h-3.5 w-3.5" /> Applied
      </StatusButton>
      <StatusButton status="hidden" active={false} title="Hide this listing" busy={busy} pending={target === "hidden"} onClick={() => set("hidden", "Listing hidden")}>
        <Eye className="h-3.5 w-3.5" /> Hide
      </StatusButton>
      {current === "favorite" || current === "applied" ? (
        <Link
          href="/saved"
          className="ml-auto inline-flex min-h-10 items-center rounded-lg px-2 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-50 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          Manage saved jobs <span aria-hidden="true" className="ml-1">→</span>
        </Link>
      ) : null}
    </>
  );
}
