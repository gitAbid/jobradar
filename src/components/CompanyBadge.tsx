"use client";

import { startTransition, useOptimistic } from "react";
import { Building2, Star } from "lucide-react";
import { toggleFollowCompanyAction } from "@/app/actions";
import { useToast } from "@/components/ui";

/** Company badge with integrated follow toggle — click to follow/unfollow. */
export function CompanyBadge({ company, followed }: { company: string; followed: boolean }) {
  const toast = useToast();
  const [optimisticFollowed, setOptimistic] = useOptimistic(followed);

  function toggle() {
    startTransition(async () => {
      setOptimistic(!optimisticFollowed);
      const fd = new FormData();
      fd.set("company", company);
      const res = await toggleFollowCompanyAction(fd);
      if (!res.ok) toast({ message: res.error, tone: "danger" });
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={optimisticFollowed}
      title={optimisticFollowed ? `Unfollow ${company}` : `Follow ${company} for new openings`}
      className={`inline-flex min-h-9 max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
        optimisticFollowed
          ? "border-amber-line bg-amber-soft text-amber-ink hover:bg-amber-soft2"
          : "border-border bg-surface text-muted hover:border-amber-line hover:bg-amber-soft hover:text-amber-ink"
      }`}
    >
      <Building2 className="h-3 w-3 shrink-0" />
      <span className="truncate">{company}</span>
      <Star className={`h-3 w-3 shrink-0 ${optimisticFollowed ? "fill-current text-amber-500" : "opacity-40"}`} />
    </button>
  );
}
