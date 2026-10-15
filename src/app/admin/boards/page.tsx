import { RelativeTime } from "@/components/RelativeTime";
import { q, rowToBoard } from "@/db";
import { getRefreshIntervalHours } from "@/lib/settings";
import { AddBoardForm } from "./AddBoardForm";
import { DeleteBoardButton, KeywordsForm, ToggleEnabledForm } from "./BoardControls";
import { SettingsForm } from "./SettingsForm";
import { TestBoardButton } from "@/components/TestBoardButton";
import { CheckCircle2, Clock3, RadioTower, TriangleAlert } from "lucide-react";
import { connection } from "next/server";
import { requirePageAdmin } from "@/lib/authz";

export const metadata = { title: "Boards · Admin" };

export default async function BoardsPage() {
  await connection(); // request-time rendering
  await requirePageAdmin(); // enforced server-side; the nav link is only a convenience
  const [boards, intervalHours] = await Promise.all([
    q<Record<string, unknown>>("select * from boards order by name").then((rows) =>
      rows.map((r) => rowToBoard(r as never)),
    ),
    getRefreshIntervalHours(),
  ]);
  const activeBoards = boards.filter((board) => board.enabled).length;
  const healthyBoards = boards.filter((board) => board.lastStatus?.startsWith("ok")).length;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl bg-sky-soft px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-line bg-surface-raised/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-ink">
              <RadioTower className="h-3.5 w-3.5" /> Radar sources
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-4xl">Boards</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted sm:text-[15px]">
              Connect the places JobRadar watches. Keep sources healthy, add focused keywords, and let the feed do the gathering.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Metric label="Connected" value={activeBoards} />
            <Metric label="Healthy" value={healthyBoards} />
          </div>
        </div>
      </section>

      <AddBoardForm />

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-ink">Connected sources</p>
            <p className="mt-1 text-sm text-muted">Test, tune, or pause each source without losing its listings.</p>
          </div>
          <span className="text-xs font-semibold text-faint">{boards.length} total</span>
        </div>

        <div className="flex flex-col gap-3">
          {boards.map((b) => (
            <BoardCard key={b.id} board={b} />
          ))}
        </div>
      </section>

      <SettingsForm intervalHours={intervalHours} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-24 rounded-2xl bg-surface-raised px-3.5 py-3 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function BoardCard({ board: b }: { board: ReturnType<typeof rowToBoard> }) {
  const isHealthy = b.lastStatus?.startsWith("ok") ?? false;
  return (
    <article className={`rounded-2xl border bg-surface-raised p-4 shadow-[0_6px_20px_rgb(15_42_67/0.045)] sm:p-5 ${b.enabled ? "border-border" : "border-border opacity-65"}`}>
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr_1.25fr_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${b.enabled ? isHealthy ? "bg-teal-500" : "bg-amber-400" : "bg-subtle-2"}`} />
            <h2 className="truncate text-sm font-bold text-foreground">{b.name}</h2>
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{b.type}</span>
          </div>
          <p className="mt-2 truncate text-xs text-faint" title={b.url}>{b.url}</p>
        </div>

        <div className="flex items-start gap-2 text-xs">
          {isHealthy ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
          <div className="min-w-0">
            <p className={isHealthy ? "font-semibold text-teal-ink" : "font-semibold text-amber-ink"}>
              {b.lastStatus ? (isHealthy ? b.lastStatus : b.lastStatus.replace("error · ", "")) : "Not fetched yet"}
            </p>
            {b.lastFetchedAt && <p className="mt-1 flex items-center gap-1 text-[11px] text-faint"><Clock3 className="h-3 w-3" /><RelativeTime iso={b.lastFetchedAt} /></p>}
          </div>
        </div>

        <KeywordsForm id={b.id} keywords={b.filterKeywords} />

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <TestBoardButton boardId={b.id} />
          <ToggleEnabledForm id={b.id} enabled={b.enabled} />
          <DeleteBoardButton id={b.id} name={b.name} />
        </div>
      </div>
    </article>
  );
}
