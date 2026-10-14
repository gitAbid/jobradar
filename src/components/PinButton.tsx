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
      title={on ? `Unpin ${name} from nav` : `Pin ${name} to nav bar`}
      className={`rounded p-1 transition ${
        on
          ? "text-emerald-600 hover:text-emerald-700"
          : "text-slate-300 opacity-0 hover:bg-slate-100 hover:text-slate-500 focus:opacity-100 group-hover/row:opacity-100"
      }`}
    >
      <Pin className={`h-3 w-3 ${on ? "fill-current" : ""}`} />
    </button>
  );
}
