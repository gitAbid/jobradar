"use client";

import { X } from "lucide-react";
import { toggleFollowCompanyAction } from "@/app/actions";
import { useToastedAction } from "@/components/use-toasted-action";

export function UnfollowButton({ name, className }: { name: string; className: string }) {
  const [, action, pending] = useToastedAction(toggleFollowCompanyAction);
  return (
    <form action={action}>
      <input type="hidden" name="company" value={name} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        title={`Unfollow ${name}`}
        aria-label={`Unfollow ${name}`}
        className={`${className} disabled:opacity-50`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}
