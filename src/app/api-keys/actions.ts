"use server";

import { revalidatePath } from "next/cache";
import { apiKeys } from "@/lib/api/keys-store";
import { createApiKey, revokeApiKey } from "@/lib/api/keys";

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

  const { key, plaintext } = await createApiKey(apiKeys(), name);
  revalidatePath("/api-keys");
  return { name, plaintext, prefix: key.prefix };
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await revokeApiKey(apiKeys(), id);
  revalidatePath("/api-keys");
}
