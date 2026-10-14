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
  try {
    await requireUser();
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: err.status === 401 ? "Sign in to create API keys." : "Not allowed." };
    }
    throw err;
  }
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Give the key a name — which app uses it?" };

  try {
    const { key, plaintext } = await createApiKey(apiKeys(), name);
    revalidatePath("/api-keys");
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

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  try {
    await requireUser();
  } catch (err) {
    if (err instanceof AuthError) return;
    throw err;
  }
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  try {
    await revokeApiKey(apiKeys(), id);
  } catch (err) {
    console.error("[jobradar] revoke API key failed:", err);
  }
  revalidatePath("/api-keys");
}
