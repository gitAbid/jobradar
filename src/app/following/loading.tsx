/** Prefetchable fallback for /following — makes nav instant for this dynamic route. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading followed openings">
      <div>
        <div className="h-6 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded bg-slate-200" />
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-6 w-28 animate-pulse rounded-full bg-slate-200"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          style={{ animationDelay: `${i * 120}ms` }}
        >
          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200" />
          <div className="mt-1 flex gap-1.5">
            <div className="h-6 w-20 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-6 w-20 animate-pulse rounded-lg bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
