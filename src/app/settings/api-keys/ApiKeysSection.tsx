import { KeyRound } from "lucide-react";
import { listApiKeys } from "@/lib/api/keys";
import { apiKeys } from "@/lib/api/keys-store";
import { CreateKeyForm } from "@/components/api-keys/CreateKeyForm";
import { EmptyState } from "@/components/ui";
import { RevokeButton } from "@/components/api-keys/RevokeButton";

/** API keys section of /settings (the caller has already resolved the user). */
export async function ApiKeysSection({ userId }: { userId: string }) {
  const keys = await listApiKeys(apiKeys(), userId);

  return (
    <section id="api-keys" className="flex scroll-mt-24 flex-col gap-4">
      <header>
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-950">
          <KeyRound className="h-5 w-5 text-teal-600" /> API keys
        </h2>
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
          <EmptyState
            title="No API keys yet"
            description="Create one above to let another app consume your feed."
          />
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
    </section>
  );
}
