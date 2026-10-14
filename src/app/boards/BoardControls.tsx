"use client";

import { useState, useTransition } from "react";
import { CirclePower, Trash2 } from "lucide-react";
import { deleteBoardAction, toggleBoardEnabledAction, updateBoardKeywordsAction } from "@/app/actions";
import { useToastedAction } from "@/components/use-toasted-action";
import { Button, ConfirmDialog, useToast } from "@/components/ui";

export function KeywordsForm({ id, keywords }: { id: number; keywords: string[] }) {
  const [, action, pending] = useToastedAction(updateBoardKeywordsAction, { success: "Keywords saved" });
  return (
    <form action={action} className="flex min-w-0 flex-col gap-1.5">
      <input type="hidden" name="id" value={id} />
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Extra keywords</span>
      <div className="flex items-center gap-2">
        <input name="keywords" defaultValue={keywords.join(", ")} placeholder="none" className="field-input min-w-0 flex-1" />
        <Button type="submit" size="sm" variant="secondary" pending={pending}>Save</Button>
      </div>
    </form>
  );
}

export function ToggleEnabledForm({ id, enabled }: { id: number; enabled: boolean }) {
  const [, action, pending] = useToastedAction(toggleBoardEnabledAction);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" pending={pending} title={enabled ? "Disable" : "Enable"}>
        <CirclePower className="h-3.5 w-3.5" /> {enabled ? "On" : "Off"}
      </Button>
    </form>
  );
}

export function DeleteBoardButton({ id, name }: { id: number; name: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", String(id));
      const res = await deleteBoardAction(fd);
      toast(res.ok ? { message: `Deleted ${name}`, tone: "success" } : { message: res.error, tone: "danger" });
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        title="Delete board and its listings"
        aria-label={`Delete ${name} board`}
        onClick={() => setOpen(true)}
        className="text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <ConfirmDialog
        open={open}
        title={`Delete ${name}?`}
        description="This removes the board and all of its listings. This can’t be undone."
        confirmLabel="Delete"
        tone="danger"
        pending={pending}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
