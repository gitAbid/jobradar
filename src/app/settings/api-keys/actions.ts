"use server";

import { revalidatePath } from "next/cache";
import { apiKeys } from "@/lib/api/keys-store";
import { createApiKey, revokeApiKey } from "@/lib/api/keys";
import { classifyRemoteError } from "@/db/errors";
import { AuthError, requireUser } from "@/lib/authz";

export interface CreateKeyState {
  error?: string;
  name?: string;
  plaintext?: string;
  prefix?: string;
}

export async function createApiKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: err.status === 401 ? "Sign in to create API keys." : "Not allowed." };
    }
    throw err;
  }
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Give the key a name — which app uses it?" };

  try {
    const { key, plaintext } = await createApiKey(apiKeys(), name, user.id);
    revalidatePath("/settings");
    return { name, plaintext, prefix: key.prefix };
  } catch (err) {
    console.error("[jobradar] create API key failed:", err);
    return {
      error:
        classifyRemoteError(err) !== "query"
          ? "The database is unreachable — the key was not created. Try again shortly."
          : "Couldn’t create the key — try again shortly.",
    };
  }
}

export type RevokeKeyResult = { ok: true } | { ok: false; error: string };

export async function revokeApiKeyAction(formData: FormData): Promise<RevokeKeyResult> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: err.status === 401 ? "Sign in required" : "Not allowed" };
    }
    throw err;
  }
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { ok: false, error: "Invalid key." };
  try {
    await revokeApiKey(apiKeys(), id, user.id);
  } catch (err) {
    console.error("[jobradar] revoke API key failed:", err);
    return { ok: false, error: "Couldn’t revoke the key — try again shortly." };
  }
  revalidatePath("/settings");
  return { ok: true };
}
