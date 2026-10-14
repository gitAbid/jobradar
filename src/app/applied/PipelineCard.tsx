"use client";

import { ArrowRight, Trash2, X } from "lucide-react";
import { addUserTagAction, removeUserTagAction } from "@/app/actions";
import { CompanyBadge } from "@/components/CompanyBadge";
import { StatusButton, useListingStatus } from "@/components/StatusActions";
import { useToastedAction } from "@/components/use-toasted-action";
import { Button } from "@/components/ui";
import type { FilterableListing, ListingStatus } from "@/lib/types";

function RemoveTagForm({ id, tag }: { id: number; tag: string }) {
  const [, action, pending] = useToastedAction(removeUserTagAction);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tag" value={tag} />
      <button
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex min-h-8 items-center gap-0.5 rounded-lg border border-violet-100 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60"
      >
        #{tag} <X className="h-2.5 w-2.5" />
      </button>
    </form>
  );
}

function AddTagForm({ id, title }: { id: number; title: string }) {
  const [, action, pending] = useToastedAction(addUserTagAction);
  return (
    <form action={action} className="inline-flex items-center">
      <input type="hidden" name="id" value={id} />
      <input
        name="tag"
        placeholder="+ tag"
        aria-label={`Add tag to ${title}`}
        maxLength={40}
        readOnly={pending}
        className="min-h-8 w-20 rounded-lg border border-dashed border-slate-300 bg-white px-2 py-0.5 text-[11px] placeholder:text-slate-400 focus:w-28 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
      />
    </form>
  );
}

export function PipelineCard({ listing, followed }: { listing: FilterableListing; followed: boolean }) {
  const { status, set, busy, target } = useListingStatus(listing.id, listing.status);
  // removed or moved to the other column: drop it from this one immediately
  if (status !== listing.status) return null;
  const otherStatus: ListingStatus = status === "favorite" ? "applied" : "favorite";

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_6px_18px_rgb(15_42_67/0.05)] transition-shadow hover:shadow-[0_10px_24px_rgb(15_42_67/0.09)] sm:p-4">
      <a
        href={listing.url}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-bold leading-snug text-slate-950 hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        {listing.title}
      </a>
      {listing.company ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <CompanyBadge company={listing.company} followed={followed} />
          <span className="rounded-full bg-slate-100 px-2 py-1 font-medium">{listing.boardName}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {listing.userTags.map((t) => (
          <RemoveTagForm key={t} id={listing.id} tag={t} />
        ))}
        <AddTagForm id={listing.id} title={listing.title} />
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-3">
        <StatusButton
          status={otherStatus}
          active={false}
          title={`Move to ${otherStatus === "favorite" ? "Favorite" : "Applied"}`}
          busy={busy}
          pending={target === otherStatus}
          onClick={() => set(otherStatus)}
        >
          Move to {otherStatus === "favorite" ? "Favorite" : "Applied"}
          <ArrowRight className="h-3 w-3" />
        </StatusButton>
        <Button
          size="sm"
          variant="secondary"
          title="Remove from board"
          aria-label={`Remove ${listing.title} from pipeline`}
          disabled={busy}
          pending={target === "new"}
          onClick={() => set("new", "Removed from pipeline")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  );
}
