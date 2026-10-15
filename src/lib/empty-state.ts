const FILTER_KEYS = ["q", "status", "remote", "visa", "skill", "country", "company", "source"] as const;

/** True when the dashboard URL narrows results (vs. simply having no data yet). */
export function hasActiveFilters(sp: object): boolean {
  return FILTER_KEYS.some((k) => {
    const v = (sp as Record<string, string | string[] | undefined>)[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });
}
