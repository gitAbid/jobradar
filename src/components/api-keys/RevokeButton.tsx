"use client";

import { useState, useTransition } from "react";
import { revokeApiKeyAction } from "@/app/api-keys/actions";
import { ConfirmDialog, useToast } from "@/components/ui";

export function RevokeButton({ id, revoked }: { id: number; revoked: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (revoked) {
    return (
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Revoked
      </span>
    );
  }

  function revoke() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", String(id));
      const res = await revokeApiKeyAction(fd);
      if (res.ok) {
        toast({ message: "API key revoked", tone: "success" });
      } else {
        toast({ message: res.error, tone: "danger" });
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-red-600 transition-colors hover:text-red-700 hover:underline"
      >
        Revoke
      </button>
      <ConfirmDialog
        open={open}
        title="Revoke this key?"
        description="Apps using it lose access immediately."
        confirmLabel="Revoke"
        tone="danger"
        pending={pending}
        onConfirm={revoke}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
