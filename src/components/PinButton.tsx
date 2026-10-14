"use client";

import { startTransition, useOptimistic } from "react";
import { Pin } from "lucide-react";
import { togglePinCountryAction } from "@/app/actions";
import { useToast } from "@/components/ui";

/** Pin/unpin a country for the nav bar; flips optimistically. */
export function PinButton({ name, pinned }: { name: string; pinned: boolean }) {
  const toast = useToast();
  const [on, setOn] = useOptimistic(pinned);

  function toggle() {
    startTransition(async () => {
      setOn(!on);
      const fd = new FormData();
      fd.set("country", name);
      const res = await togglePinCountryAction(fd);
      if (!res.ok) toast({ message: res.error, tone: "danger" });
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={`Pin ${name} to nav bar`}
      title={on ? `Unpin ${name} from nav` : `Pin ${name} to nav bar`}
      className={`inline-flex items-center justify-center rounded p-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 transition ${
        on
          ? "text-emerald-600 hover:text-emerald-700"
          : "text-slate-400 hover:bg-slate-100 hover:text-slate-500 focus-visible:ring-2 focus-visible:ring-teal-500 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus:opacity-100 [@media(hover:hover)]:group-hover/row:opacity-100"
      }`}
    >
      <Pin aria-hidden="true" className={`h-3 w-3 ${on ? "fill-current" : ""}`} />
    </button>
  );
}
