/** Prefetchable fallback for /applied — makes nav instant for this dynamic route. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading pipeline">
      <div>
        <div className="h-6 w-28 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-slate-200" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((col) => (
          <section key={col} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-100/60 p-3">
            <div className="h-5 w-24 animate-pulse rounded bg-slate-200" />
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3"
                style={{ animationDelay: `${(col * 3 + i) * 120}ms` }}
              >
                <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="mt-1 h-6 w-full animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
