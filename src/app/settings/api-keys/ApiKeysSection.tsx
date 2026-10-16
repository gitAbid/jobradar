import { KeyRound } from "lucide-react";
import type { listApiKeys } from "@/lib/api/keys";
import { CreateKeyForm } from "@/components/api-keys/CreateKeyForm";
import { RelativeTime } from "@/components/RelativeTime";
import { EmptyState } from "@/components/ui";
import { RevokeButton } from "@/components/api-keys/RevokeButton";

/** API keys section of /settings (the page loads the caller's keys alongside its other reads). */
export function ApiKeysSection({ keys }: { keys: Awaited<ReturnType<typeof listApiKeys>> }) {

  return (
    <section id="api-keys" className="flex scroll-mt-24 flex-col gap-4">
      <header>
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
          <KeyRound className="h-5 w-5 text-primary" /> API keys
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Let other apps read your job list from{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 text-xs">/api/v1/jobs</code> with{" "}
          <code className="rounded bg-subtle px-1.5 py-0.5 text-xs">
            Authorization: Bearer &lt;key&gt;
          </code>
          . Keys are stored hashed and shown only once, at creation.
        </p>
      </header>

      <CreateKeyForm />

      <section className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-sm">
        {keys.length === 0 ? (
          <EmptyState
            title="No API keys yet"
            description="Create one above to let another app consume your feed."
          />
        ) : (
          <ul className="divide-y divide-border">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{k.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-faint">{k.prefix}…</p>
                </div>
                <div className="text-right text-xs text-muted">
                  <p><RelativeTime prefix="Created " iso={k.createdAt} /></p>
                  <p className="mt-0.5">
                    {k.lastUsedAt ? (
                      <>
                        <RelativeTime prefix="Used " iso={k.lastUsedAt} /> · {k.requestCount} reqs
                      </>
                    ) : (
                      "Never used"
                    )}
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
