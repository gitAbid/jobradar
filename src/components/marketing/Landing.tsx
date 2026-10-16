import Link from "next/link";
import { ArrowRight, BellRing, Bookmark, Building2, Check, Filter, Globe2, KanbanSquare, MapPin, Sparkles, Star } from "lucide-react";

const FEATURES = [
  { icon: Globe2, title: "Many boards, one feed", body: "Remote and regional job boards gathered and de-duplicated in a single place." },
  { icon: Filter, title: "Ranked by your skills", body: "Pick the keywords and locations you care about; the newest matches float to the top." },
  { icon: KanbanSquare, title: "Save and track", body: "Favorite promising roles, mark what you applied to, and follow companies." },
  { icon: BellRing, title: "Always fresh", body: "Boards refresh on a schedule so you see new openings first." },
];

const STEPS = [
  { title: "Sign in", body: "Use your Google account. No passwords to remember." },
  { title: "Tell us what fits", body: "Choose your skills and the locations you would work from." },
  { title: "Track your pipeline", body: "Save roles, mark applications, and watch new matches arrive." },
];

const SAMPLE_JOBS = [
  { title: "Senior Backend Engineer", company: "Northwind", place: "Remote · EU", tags: ["Java", "Spring"], fresh: "2h" },
  { title: "Platform Engineer", company: "Lumen Labs", place: "Berlin, Germany", tags: ["Kotlin", "Kubernetes"], fresh: "5h" },
  { title: "Full-stack Developer", company: "Harbor & Co", place: "Dhaka, Bangladesh", tags: ["React", "AWS"], fresh: "1d" },
];

const CTA =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/** Decorative preview of the feed built from markup (no external images). */
function FeedPreview() {
  return (
    <div className="relative w-full max-w-md" aria-hidden="true">
      <div className="rounded-2xl border border-border bg-surface-raised/95 p-4 shadow-lg backdrop-blur sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">Matched to you</p>
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-xs-plus font-semibold text-teal-ink">
            <Sparkles className="h-3 w-3" /> 24 new today
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["Java", "Kotlin", "Remote", "Berlin"].map((t) => (
            <span key={t} className="rounded-full border border-border-strong px-2.5 py-0.5 text-xs-plus font-medium text-muted">{t}</span>
          ))}
        </div>
        <ul className="mt-4 space-y-2.5">
          {SAMPLE_JOBS.map((job, i) => (
            <li key={job.title} className="rounded-xl border border-border bg-surface p-3.5 transition-colors">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-sm font-bold text-foreground">
                  {job.company[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{job.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
                    <Building2 className="h-3 w-3 shrink-0" /> {job.company}
                    <span className="text-faint">·</span>
                    <MapPin className="h-3 w-3 shrink-0" /> {job.place}
                  </p>
                </div>
                {i === 0 ? (
                  <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />
                ) : (
                  <Bookmark className="h-4 w-4 shrink-0 text-faint" />
                )}
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                {job.tags.map((t) => (
                  <span key={t} className="rounded-md bg-teal-soft px-1.5 py-0.5 text-2xs font-semibold text-teal-ink">{t}</span>
                ))}
                <span className="ml-auto text-2xs font-medium text-faint">{job.fresh} ago</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div data-signed-out-page className="flex flex-col gap-20 pb-8 sm:gap-28">
      <section className="relative grid items-center gap-12 pt-6 sm:pt-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pt-16">
        {/* Full-bleed backdrop: spans the viewport and fades out, so no glow ends on a hard edge. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -top-32 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
        >
          <div className="absolute -top-24 left-[20%] h-96 w-[40rem] max-w-[90vw] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute right-[10%] top-1/3 h-96 w-[36rem] max-w-[80vw] rounded-full bg-primary/10 blur-3xl" />
        </div>
        <div className="animate-fade-up text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-teal-line bg-teal-soft px-3 py-1 text-xs-plus font-semibold text-teal-ink">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Live job radar
          </span>
          <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Find your next move, <span className="text-primary">faster.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted sm:text-lg lg:mx-0">
            JobRadar gathers openings from many boards, ranks them by the skills and places you care about, and helps you track every application.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link href="/signin" className={`${CTA} w-full sm:w-auto`}>
              Get started free <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-6 text-sm font-semibold text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
            >
              How it works
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted lg:justify-start">
            {["Free to use", "No spam, ever", "Delete your data anytime"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check className="h-4 w-4 text-primary" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="animate-fade-up flex justify-center [animation-delay:120ms] lg:justify-end">
          <FeedPreview />
        </div>
      </section>

      <section aria-labelledby="features-heading">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs-plus font-bold uppercase tracking-caps text-primary">Features</p>
          <h2 id="features-heading" className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Everything in one radar</h2>
          <p className="mt-3 text-muted">Stop juggling tabs. One feed, tuned to you.</p>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="group rounded-2xl border border-border bg-surface-raised p-6 shadow-xs transition-all duration-200 hover:-translate-y-1 hover:border-teal-line hover:shadow-md"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-soft text-teal-ink transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs-plus font-bold uppercase tracking-caps text-primary">How it works</p>
          <h2 id="how-heading" className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Up and running in a minute</h2>
        </div>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative rounded-2xl border border-border bg-surface-raised p-6 shadow-xs">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{i + 1}</span>
              <h3 className="mt-4 font-semibold text-foreground">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="relative overflow-hidden rounded-3xl bg-ink px-6 py-12 text-center shadow-lg sm:px-12 sm:py-16">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/30 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
        <h2 className="relative text-2xl font-bold tracking-tight text-white sm:text-4xl">Your next role is already out there.</h2>
        <p className="relative mx-auto mt-3 max-w-lg text-sm text-white/75 sm:text-base">Let JobRadar find it while you focus on the interviews.</p>
        <Link href="/signin" className={`${CTA} relative mt-8`}>
          Start for free <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
