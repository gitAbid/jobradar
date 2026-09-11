import { connection } from "next/server";
import { KeyRound } from "lucide-react";
import { listApiKeys } from "@/lib/api/keys";
import { apiKeys } from "@/lib/api/keys-store";
import { CreateKeyForm } from "@/components/api-keys/CreateKeyForm";
import { RevokeButton } from "@/components/api-keys/RevokeButton";

export const metadata = { title: "API Keys · JobRadar" };

export default async function ApiKeysPage() {
  await connection(); // DB reads must not be prerendered
  const keys = await listApiKeys(apiKeys());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">
          Developer
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-950">
          <KeyRound className="h-5 w-5 text-teal-600" /> API keys
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Let other apps read your job list from{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">/api/v1/jobs</code> with{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            Authorization: Bearer &lt;key&gt;
          </code>
          . Keys are stored hashed and shown only once, at creation.
        </p>
      </header>

      <CreateKeyForm />

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {keys.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No API keys yet. Create one above to let another app consume your feed.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{k.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-400">{k.prefix}…</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>Created {new Date(k.createdAt).toLocaleDateString()}</p>
                  <p className="mt-0.5">
                    {k.lastUsedAt
                      ? `Used ${new Date(k.lastUsedAt).toLocaleString()} · ${k.requestCount} reqs`
                      : "Never used"}
                  </p>
                </div>
                <RevokeButton id={k.id} revoked={k.revokedAt !== null} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
