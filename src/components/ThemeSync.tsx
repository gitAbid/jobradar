"use client";

import { useEffect } from "react";
import { applyTheme, type Theme } from "@/lib/theme";

/** Reconciles this device's theme with the signed-in user's saved one (cross-device). */
export function ThemeSync({ theme }: { theme: Theme }) {
  useEffect(() => applyTheme(theme), [theme]);
  return null;
}
