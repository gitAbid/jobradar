"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { TagChip } from "@/components/TagChip";
import { skillChipHref } from "@/lib/chip-href";

/** Skill chip that keeps the current route and other active filters. */
export function SkillChipLink({ skill }: { skill: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <TagChip variant="skill" href={skillChipHref(pathname, search, skill)} title={`Show ${skill} jobs`}>
      {skill}
    </TagChip>
  );
}
