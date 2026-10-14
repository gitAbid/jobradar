"use client";

import { startTransition, useOptimistic, useState, type ReactNode } from "react";
import { setListingStatusAction } from "@/app/actions";
import { Button, useToast } from "@/components/ui";
import type { ListingStatus } from "@/lib/types";

/**
 * Optimistic listing-status state shared by every control for one listing.
 * `set` applies the status immediately, rolls back (via useOptimistic) and
 * toasts on failure, and offers Undo when `undo` names the toast text.
 */
export function useListingStatus(id: number, status: ListingStatus) {
  const toast = useToast();
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [target, setTarget] = useState<ListingStatus | null>(null);
  const [busy, setBusy] = useState(false);

  function set(next: ListingStatus, undoMessage?: string) {
    const prev = optimistic;
    if (busy) return; // double-submit guard
    setBusy(true);
    setTarget(next);
    startTransition(async () => {
      setOptimistic(next);
      const res = await setStatus(id, next);
      if (!res.ok) {
        toast({ message: res.error, tone: "danger" });
      } else if (undoMessage) {
        toast({
          message: undoMessage,
          action: {
            label: "Undo",
            // the card may be unmounted by then, so no optimistic setters here
            onClick: () => {
              void setStatus(id, prev).then((r) => {
                if (!r.ok) toast({ message: r.error, tone: "danger" });
              });
            },
          },
        });
      }
      setBusy(false);
      setTarget(null);
    });
  }
  return { status: optimistic, set, busy, target };
}

function setStatus(id: number, status: ListingStatus) {
  const fd = new FormData();
  fd.set("id", String(id));
  fd.set("status", status);
  return setListingStatusAction(fd);
}

export function StatusButton({
  status,
  active,
  title,
  busy,
  pending,
  onClick,
  children,
}: {
  status: ListingStatus;
  active: boolean;
  title: string;
  busy: boolean;
  pending: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "primary" : "secondary"}
      title={title}
      data-status={status}
      aria-pressed={active}
      disabled={busy}
      pending={pending}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
