import Link from "next/link";
import { BellRing, Filter, Globe2, KanbanSquare } from "lucide-react";

const FEATURES = [
  { icon: Globe2, title: "Many boards, one feed", body: "Remote and regional job boards gathered and de-duplicated in a single place." },
  { icon: Filter, title: "Ranked by your skills", body: "Pick the keywords and locations you care about; the newest matches float to the top." },
  { icon: KanbanSquare, title: "Save and track", body: "Favorite promising roles, mark what you applied to, and follow companies." },
  { icon: BellRing, title: "Always fresh", body: "Boards refresh on a schedule so you see new openings first." },
];

/** Inline illustration of the feed (no external images). */
function FeedIllustration() {
  const rows = [
    { w: "w-40", tag: "Java", c: "bg-primary" },
    { w: "w-32", tag: "Remote", c: "bg-accent" },
    { w: "w-48", tag: "Spring", c: "bg-primary" },
  ];
  return (
    <div role="img" aria-label="Illustration of a filtered job feed" className="w-full max-w-md rounded-2xl border border-border bg-surface-raised p-4 shadow-lg">
      <div className="mb-3 flex gap-2">
        {["Java", "Kotlin", "Berlin"].map((t) => (
          <span key={t} className="rounded-full border border-border-strong px-2.5 py-0.5 text-xs-plus font-semibold text-muted">{t}</span>
        ))}
      </div>
      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-border-strong" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className={`h-2.5 ${r.w} max-w-full rounded bg-foreground/70`} />
              <div className="h-2 w-24 max-w-full rounded bg-border-strong" />
            </div>
            <span className={`rounded-full px-2 py-0.5 text-2xs font-bold text-primary-foreground ${r.c}`}>{r.tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="flex flex-col gap-14 py-4 sm:gap-20 sm:py-10">
      <section className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <p className="text-xs-plus font-bold uppercase tracking-caps text-primary">Live job radar</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Find your next move, faster.</h1>
          <p className="mt-4 max-w-xl text-base-plus text-muted">
            JobRadar gathers openings from many boards, ranks them by the skills and places you care about, and helps you track every application.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/signin"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Sign in to get started
            </Link>
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <FeedIllustration />
        </div>
      </section>

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="text-2xl font-bold tracking-tight text-foreground">Everything in one radar</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-xl border border-border bg-surface-raised p-5 shadow-sm">
              <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              <h3 className="mt-3 font-semibold text-foreground">{title}</h3>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
