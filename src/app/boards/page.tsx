import { q, rowToBoard } from "@/db";
import { getGlobalKeywords, getRefreshIntervalHours, isSoundEnabled } from "@/lib/settings";
import {
  addBoardAction,
  deleteBoardAction,
  saveSettingsAction,
  toggleBoardEnabledAction,
  updateBoardKeywordsAction,
} from "@/app/actions";
import { TestBoardButton } from "@/components/TestBoardButton";
import { CheckCircle2, CirclePower, Clock3, Plus, RadioTower, Settings2, Trash2, TriangleAlert } from "lucide-react";
import { connection } from "next/server";

export default async function BoardsPage() {
  await connection(); // request-time rendering
  const [boards, intervalHours, keywords, sound] = await Promise.all([
    q<Record<string, unknown>>("select * from boards order by name").then((rows) =>
      rows.map((r) => rowToBoard(r as never)),
    ),
    getRefreshIntervalHours(),
    getGlobalKeywords(),
    isSoundEnabled(),
  ]);
  const activeBoards = boards.filter((board) => board.enabled).length;
  const healthyBoards = boards.filter((board) => board.lastStatus?.startsWith("ok")).length;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl bg-sky-50 px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-800">
              <RadioTower className="h-3.5 w-3.5" /> Radar sources
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-4xl">Boards</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-[15px]">
              Connect the places JobRadar watches. Keep sources healthy, add focused keywords, and let the feed do the gathering.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Metric label="Connected" value={activeBoards} />
            <Metric label="Healthy" value={healthyBoards} />
          </div>
        </div>
      </section>

      <form
        action={addBoardAction}
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgb(15_42_67/0.05)] sm:p-5"
      >
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Plus className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Add a job board</h2>
            <p className="mt-0.5 text-xs text-slate-500">API boards return JSON; RSS boards accept any RSS or Atom feed URL.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_0.8fr_1.5fr_1.2fr_auto] lg:items-end">
          <Field label="Name">
            <input name="name" required maxLength={80} placeholder="My board" className="field-input" />
          </Field>
          <Field label="Type">
            <select name="type" className="field-input">
              <option value="api">API (JSON)</option>
              <option value="rss">RSS / Atom</option>
            </select>
          </Field>
          <Field label="URL">
            <input name="url" type="url" required placeholder="https://example.com/api" className="field-input" />
          </Field>
          <Field label="Extra keywords">
            <input name="keywords" placeholder="visa sponsorship, bangladesh" className="field-input" />
          </Field>
          <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
            <Plus className="h-4 w-4" /> Add board
          </button>
        </div>
      </form>

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">Connected sources</p>
            <p className="mt-1 text-sm text-slate-500">Test, tune, or pause each source without losing its listings.</p>
          </div>
          <span className="text-xs font-semibold text-slate-400">{boards.length} total</span>
        </div>

        <div className="flex flex-col gap-3">
          {boards.map((b) => (
            <BoardCard key={b.id} board={b} />
          ))}
        </div>
      </section>

      <SettingsForm intervalHours={intervalHours} keywords={keywords} sound={sound} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-24 rounded-2xl bg-white px-3.5 py-3 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-slate-600">
      {label}
      {children}
    </label>
  );
}

function BoardCard({ board: b }: { board: ReturnType<typeof rowToBoard> }) {
  const isHealthy = b.lastStatus?.startsWith("ok") ?? false;
  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-[0_6px_20px_rgb(15_42_67/0.045)] sm:p-5 ${b.enabled ? "border-slate-200" : "border-slate-200 opacity-65"}`}>
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr_1.25fr_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${b.enabled ? isHealthy ? "bg-teal-500" : "bg-amber-400" : "bg-slate-300"}`} />
            <h2 className="truncate text-sm font-bold text-slate-950">{b.name}</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">{b.type}</span>
          </div>
          <p className="mt-2 truncate text-xs text-slate-400" title={b.url}>{b.url}</p>
        </div>

        <div className="flex items-start gap-2 text-xs">
          {isHealthy ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
          <div className="min-w-0">
            <p className={isHealthy ? "font-semibold text-teal-800" : "font-semibold text-amber-800"}>
              {b.lastStatus ? (isHealthy ? b.lastStatus : b.lastStatus.replace("error · ", "")) : "Not fetched yet"}
            </p>
            {b.lastFetchedAt && <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><Clock3 className="h-3 w-3" />{new Date(b.lastFetchedAt).toLocaleString()}</p>}
          </div>
        </div>

        <form action={updateBoardKeywordsAction} className="flex min-w-0 flex-col gap-1.5">
          <input type="hidden" name="id" value={b.id} />
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Extra keywords</span>
          <div className="flex items-center gap-2">
            <input name="keywords" defaultValue={b.filterKeywords.join(", ")} placeholder="none" className="field-input min-w-0 flex-1" />
            <button type="submit" className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-teal-300 hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">Save</button>
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <TestBoardButton boardId={b.id} />
          <form action={toggleBoardEnabledAction}>
            <input type="hidden" name="id" value={b.id} />
            <button type="submit" title={b.enabled ? "Disable" : "Enable"} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
              <CirclePower className="h-3.5 w-3.5" /> {b.enabled ? "On" : "Off"}
            </button>
          </form>
          <form action={deleteBoardAction}>
            <input type="hidden" name="id" value={b.id} />
            <button type="submit" title="Delete board and its listings" aria-label={`Delete ${b.name} board`} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-600 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}

function SettingsForm({
  intervalHours,
  keywords,
  sound,
}: {
  intervalHours: number;
  keywords: string[];
  sound: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgb(15_42_67/0.05)] sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Settings2 className="h-5 w-5" /></span>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Radar preferences</h2>
          <p className="mt-0.5 text-xs text-slate-500">Set the matching vocabulary and how often your sources refresh.</p>
        </div>
      </div>
      <form action={saveSettingsAction} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <Field label="Global skill keywords">
          <input name="global_keywords" defaultValue={keywords.join(", ")} className="field-input" />
        </Field>
        <Field label="Refresh interval (hours)">
          <input name="interval_hours" type="number" min={1} max={48} defaultValue={intervalHours} className="field-input w-full sm:w-28" />
        </Field>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:border-violet-300">
          <input type="checkbox" name="sound_enabled" defaultChecked={sound} className="h-4 w-4 accent-violet-600" />
          Sound ping
        </label>
        <button type="submit" className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">Save settings</button>
      </form>
    </section>
  );
}
