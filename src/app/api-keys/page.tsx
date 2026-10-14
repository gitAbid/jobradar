import { connection } from "next/server";
import { KeyRound } from "lucide-react";
import { dbStatus } from "@/db";
import { listApiKeys } from "@/lib/api/keys";
import { apiKeys } from "@/lib/api/keys-store";
import { CreateKeyForm } from "@/components/api-keys/CreateKeyForm";
import { RevokeButton } from "@/components/api-keys/RevokeButton";

export const metadata = { title: "API Keys · JobRadar" };

export default async function ApiKeysPage() {
  await connection(); // DB reads must not be prerendered
  // Sequential on purpose: listing first lets a remote failure trip the
  // circuit breaker, so dbStatus below reports the outage on this instance
  // and the warning banner renders on the first load, not just warm ones.
  const keys = await listApiKeys(apiKeys());
  const status = await dbStatus().catch(() => null);

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
          . Keys are stored hashed and shown only once, at creation. If the
          database itself is unreachable, the API temporarily allows
          unauthenticated reads until it recovers.
        </p>
      </header>

      <CreateKeyForm />

      {status && !status.remoteConfigured && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
          <strong>DATABASE_URL is not set</strong> — keys are kept only on this
          machine&apos;s on-device store and will not persist on Vercel. Point
          DATABASE_URL at Neon to make keys durable.
        </p>
      )}

      {status && status.remoteConfigured && status.remote === "down" && (
        <div className="rounded-2xl border border-red-300 bg-red-50 px-5 py-4 text-sm leading-6 text-red-900">
          <p>
            <strong>
              The database is unreachable
              {status.breaker.lastErrorClass ? ` (${status.breaker.lastErrorClass})` : ""}
            </strong>{" "}
            — new keys can&apos;t be saved and existing keys may not authenticate
            until it recovers. Nothing is lost silently: creations fail with an
            error instead of vanishing.
          </p>
          {status.breaker.lastError && (
            <p className="mt-1 truncate font-mono text-xs text-red-700" title={status.breaker.lastError}>
              {status.breaker.lastError.slice(0, 160)}
            </p>
          )}
        </div>
      )}

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
