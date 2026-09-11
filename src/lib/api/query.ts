import { z } from "zod";
import type { RawParams } from "@/lib/job-view";

/**
 * Query params for GET /api/v1/jobs. Repeatable facet params arrive as
 * multi-value search params; everything else is a plain string.
 * `page`/`pageSize` are returned separately — they drive pagination, not
 * the filter pipeline.
 */

export type ParsedJobsQuery =
  | { ok: true; params: RawParams; page: number; pageSize: number }
  | { ok: false; error: string };

const REPEATABLE = ["skill", "country", "company", "source"] as const;

const facetArray = z.array(z.string().min(1).max(120)).max(30);

const filtersSchema = z.object({
  q: z.string().min(1).max(300).optional(),
  status: z.enum(["new", "favorite", "applied"]).optional(),
  remote: z.enum(["1", "anywhere", "restricted"]).optional(),
  visa: z.literal("1").optional(),
  skill: facetArray.optional(),
  country: facetArray.optional(),
  company: facetArray.optional(),
  source: facetArray.optional(),
});

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export function parseJobsQuery(url: string): ParsedJobsQuery {
  const sp = new URL(url).searchParams;
  const raw: Record<string, string | string[]> = {};
  for (const [key, value] of sp.entries()) {
    if ((REPEATABLE as readonly string[]).includes(key)) {
      const current = raw[key];
      if (current === undefined) raw[key] = [value];
      else if (Array.isArray(current)) current.push(value);
      else raw[key] = [current, value];
    } else {
      raw[key] = value;
    }
  }

  const paging = pagingSchema.safeParse({
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (!paging.success) {
    return { ok: false, error: paging.error.issues[0]?.message ?? "invalid page params" };
  }

  const filters = filtersSchema.safeParse(raw);
  if (!filters.success) {
    return { ok: false, error: filters.error.issues[0]?.message ?? "invalid filter params" };
  }

  return { ok: true, params: filters.data as RawParams, ...paging.data };
}
