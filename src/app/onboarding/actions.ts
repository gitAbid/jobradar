"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { run } from "@/db";
import { markOnboardingComplete, setGlobalKeywords } from "@/lib/settings";
import { AuthError, requireUser, type SessionUser } from "@/lib/authz";

export type OnboardingResult = { ok: false; error: string } | null;

async function gate(): Promise<SessionUser | null> {
  try {
    return await requireUser();
  } catch (err) {
    if (err instanceof AuthError) return null;
    throw err;
  }
}

function list(raw: FormDataEntryValue | null, max: number, maxLen: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? "").split(",")) {
    const v = part.trim().slice(0, maxLen);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.slice(0, max);
}

/** Save keywords + pinned countries, mark onboarding done, then open the pre-filtered feed. */
export async function completeOnboardingAction(_prev: OnboardingResult, formData: FormData): Promise<OnboardingResult> {
  const user = await gate();
  if (!user) return { ok: false, error: "Sign in required" };
  const keywords = list(formData.get("keywords"), 20, 60);
  const countries = [...list(formData.getAll("country").join(","), 10, 60)];
  if (keywords.length === 0 && countries.length === 0) {
    return { ok: false, error: "Add at least one skill or location, or skip for now." };
  }
  if (keywords.length > 0) await setGlobalKeywords(user.id, keywords);
  for (const name of countries) {
    await run(
      `insert into pinned_countries (user_id, name, created_at) values ($1::uuid, $2, now())
       on conflict (user_id, lower(name)) do nothing`,
      [user.id, name],
    );
  }
  await markOnboardingComplete(user.id);
  revalidatePath("/", "layout");
  const params = new URLSearchParams();
  for (const c of countries) params.append("country", c);
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : "/");
}

/** Skip: record completion without changing any preferences. */
export async function skipOnboardingAction(): Promise<void> {
  const user = await gate();
  if (!user) return;
  await markOnboardingComplete(user.id);
  revalidatePath("/", "layout");
  redirect("/");
}
