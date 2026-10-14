"use client";

import { useState, useTransition } from "react";
import { deleteAccountAction } from "./actions";
import { Button, ConfirmDialog, useToast } from "@/components/ui";

/** Sign out, export and delete controls for /settings. */
export function AccountSection({ email, signOutAction }: { email: string; signOutAction: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const res = await deleteAccountAction(); // redirects on success
      if (res && !res.ok) {
        toast({ message: res.error, tone: "danger" });
        setOpen(false);
      }
    });
  }

  return (
    <section id="account" className="flex scroll-mt-24 flex-col gap-4">
      <h2 className="text-lg font-bold tracking-tight text-foreground">Account</h2>
      <p className="text-sm text-muted">
        Signed in as <span className="font-medium text-foreground">{email}</span>.
      </p>
      <div className="flex flex-wrap gap-3">
        <form action={signOutAction}>
          <Button type="submit" variant="secondary">Sign out</Button>
        </form>
        <a
          href="/api/account/export"
          download="jobradar-export.json"
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Export my data
        </a>
        <Button type="button" variant="danger" onClick={() => setOpen(true)}>Delete account</Button>
      </div>
      <ConfirmDialog
        open={open}
        title="Delete your account?"
        description="This permanently removes your profile, saved listings, settings and API keys. It can’t be undone."
        confirmLabel="Delete account"
        tone="danger"
        pending={pending}
        onConfirm={remove}
        onCancel={() => setOpen(false)}
      />
    </section>
  );
}
