"use server";

import { revalidatePath } from "next/cache";
import { apiKeys } from "@/lib/api/keys-store";
import { createApiKey, revokeApiKey } from "@/lib/api/keys";
import { flushBlobOps } from "@/lib/blob-sync";

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
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Give the key a name — which app uses it?" };

  try {
    const { key, plaintext } = await createApiKey(apiKeys(), name);
    try {
      await flushBlobOps();
    } catch {
      // best-effort durability; the key itself is already stored
    }
    revalidatePath("/api-keys");
    return { name, plaintext, prefix: key.prefix };
  } catch (err) {
    console.error("[jobradar] create API key failed:", err);
    return {
      error:
        err instanceof Error && /unavailable/i.test(err.message)
          ? "The database is unreachable — the key was not created. Try again shortly."
          : "Couldn’t create the key — try again shortly.",
    };
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  try {
    await revokeApiKey(apiKeys(), id);
  } catch (err) {
    console.error("[jobradar] revoke API key failed:", err);
  }
  try {
    await flushBlobOps();
  } catch {
    // best-effort
  }
  revalidatePath("/api-keys");
}
