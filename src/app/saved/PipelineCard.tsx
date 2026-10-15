"use client";

import { ArrowRight, Trash2 } from "lucide-react";
import { addUserTagAction, removeUserTagAction } from "@/app/actions";
import { CompanyBadge } from "@/components/CompanyBadge";
import { TagChip } from "@/components/TagChip";
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
      <TagChip variant="user" removable removeLabel={`Remove tag #${tag}`} disabled={pending}>
        #{tag}
      </TagChip>
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
        className="min-h-8 pointer-coarse:min-h-11 w-20 rounded-lg border border-dashed border-border-strong bg-surface-raised px-2 py-0.5 text-[11px] placeholder:text-faint focus:w-28 focus:border-violet-line focus:outline-none focus:ring-2 focus:ring-violet-100"
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
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3.5 shadow-[0_6px_18px_rgb(15_42_67/0.05)] transition-shadow hover:shadow-[0_10px_24px_rgb(15_42_67/0.09)] sm:p-4">
      <h3 className="text-sm font-bold leading-snug text-foreground">
        <a
          href={listing.url}
          target="_blank"
          rel="noreferrer"
          className="hover:text-teal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          {listing.title}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </h3>
      {listing.company ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <CompanyBadge company={listing.company} followed={followed} />
          <span className="rounded-full bg-subtle px-2 py-1 font-medium">{listing.boardName}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {listing.userTags.map((t) => (
          <RemoveTagForm key={t} id={listing.id} tag={t} />
        ))}
        <AddTagForm id={listing.id} title={listing.title} />
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
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
          className="pointer-coarse:min-w-11"
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
