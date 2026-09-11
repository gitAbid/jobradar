"use client";

import { revokeApiKeyAction } from "@/app/api-keys/actions";

export function RevokeButton({ id, revoked }: { id: number; revoked: boolean }) {
  if (revoked) {
    return (
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Revoked
      </span>
    );
  }
  return (
    <form
      action={revokeApiKeyAction}
      onSubmit={(e) => {
        if (!window.confirm("Revoke this key? Apps using it lose access immediately.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-xs font-semibold text-red-600 transition-colors hover:text-red-700 hover:underline"
      >
        Revoke
      </button>
    </form>
  );
}
