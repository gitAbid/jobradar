"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

/** Params that make up the "quick filters" (everything except facets and page). */
export const QUICK_FILTER_KEYS = ["q", "status", "remote", "visa", "showAll"];

/**
 * Shared URL-param plumbing for FacetSidebar, FilterBar and Pagination.
 * Every mutation resets pagination (filters changed → back to first page).
 */
export function useFacetParams() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const push = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      next.delete("page");
      mutate(next);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, router, pathname],
  );

  const setParam = useCallback(
    (key: string, value: string) =>
      push((next) => {
        if (value) next.set(key, value);
        else next.delete(key);
      }),
    [push],
  );

  const toggleValue = useCallback(
    (param: string, name: string) =>
      push((next) => {
        const current = next.getAll(param);
        next.delete(param);
        const updated = current.includes(name)
          ? current.filter((s) => s !== name)
          : [...current, name];
        updated.forEach((s) => next.append(param, s));
      }),
    [push],
  );

  const clearParams = useCallback(
    (keys: string[]) =>
      push((next) => {
        keys.forEach((key) => next.delete(key));
      }),
    [push],
  );

  /** Link target for a given page, preserving all other params. */
  const hrefForPage = useCallback(
    (page: number): string => {
      const next = new URLSearchParams(params.toString());
      next.set("page", String(page));
      return `${pathname}?${next.toString()}`;
    },
    [params, pathname],
  );

  return { params, push, setParam, toggleValue, clearParams, hrefForPage };
}
