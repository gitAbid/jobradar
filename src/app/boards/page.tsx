import { getDb, rowToBoard } from "@/db";
import { getGlobalKeywords, getRefreshIntervalHours, isSoundEnabled } from "@/lib/settings";
import {
  addBoardAction,
  deleteBoardAction,
  saveSettingsAction,
  toggleBoardEnabledAction,
  updateBoardKeywordsAction,
} from "@/app/actions";
import { TestBoardButton } from "@/components/TestBoardButton";
import { Plus, Trash2, Power } from "lucide-react";
import { connection } from "next/server";

export default async function BoardsPage() {
  await connection(); // request-time rendering
  const db = getDb();
  const boards = (
    db.prepare("SELECT * FROM boards ORDER BY name").all() as Record<string, unknown>[]
  ).map((r) => rowToBoard(r as never));

  const intervalHours = getRefreshIntervalHours();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Boards</h1>
        <p className="text-sm text-slate-500">
          Manage where JobRadar pulls listings from. API boards return JSON; RSS boards take any
          RSS/Atom feed URL.
        </p>
      </div>

      {/* ── Add board ─────────────────────────────────────────────── */}
      <form
        action={addBoardAction}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Name
          <input name="name" required maxLength={80} placeholder="My board" className="w-40 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Type
          <select name="type" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="api">API (JSON)</option>
            <option value="rss">RSS / Atom</option>
          </select>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
          URL
          <input name="url" type="url" required placeholder="https://example.com/api" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Extra keywords (comma-sep)
          <input name="keywords" placeholder="visa sponsorship, bangladesh" className="w-56 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" /> Add board
        </button>
      </form>

      {/* ── Board list ────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Board</th>
              <th className="px-4 py-2">Health</th>
              <th className="px-4 py-2">Extra keywords</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {boards.map((b) => (
              <tr key={b.id} className={b.enabled ? "" : "opacity-50"}>
                <td className="px-4 py-3">
                  <div className="font-medium">{b.name}</div>
                  <div className="max-w-md truncate text-xs text-slate-400" title={b.url}>
                    {b.type.toUpperCase()} · {b.url}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">
                  {b.lastStatus ? (
                    <span className={b.lastStatus.startsWith("ok") ? "text-emerald-600" : "text-red-600"}>
                      {b.lastStatus.startsWith("ok") ? "●" : "⚠"}{" "}
                      {b.lastStatus.startsWith("ok") ? b.lastStatus : b.lastStatus.replace("error · ", "")}
                    </span>
                  ) : (
                    <span className="text-slate-400">never fetched</span>
                  )}
                  {b.lastFetchedAt && (
                    <div className="text-[11px] text-slate-400">
                      {new Date(b.lastFetchedAt).toLocaleString()}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <form action={updateBoardKeywordsAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="id" value={b.id} />
                    <input
                      name="keywords"
                      defaultValue={b.filterKeywords.join(", ")}
                      placeholder="none"
                      className="w-44 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    />
                    <button className="rounded-lg border border-slate-200 px-2 py-1 text-xs hover:border-slate-400">
                      Save
                    </button>
                  </form>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <TestBoardButton boardId={b.id} />
                    <form action={toggleBoardEnabledAction}>
                      <input type="hidden" name="id" value={b.id} />
                      <button
                        title={b.enabled ? "Disable" : "Enable"}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-slate-400"
                      >
                        <Power className="h-3.5 w-3.5" /> {b.enabled ? "On" : "Off"}
                      </button>
                    </form>
                    <form action={deleteBoardAction}>
                      <input type="hidden" name="id" value={b.id} />
                      <button
                        title="Delete board and its listings"
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:border-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Settings ──────────────────────────────────────────────── */}
      <SettingsForm intervalHours={intervalHours} />
    </div>
  );
}

function SettingsForm({ intervalHours }: { intervalHours: number }) {
  const keywords = getGlobalKeywords();
  const sound = isSoundEnabled();
  return (
    <form
      action={saveSettingsAction}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <label className="flex min-w-72 flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
        Global skill keywords (comma-separated)
        <input
          name="global_keywords"
          defaultValue={keywords.join(", ")}
          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Auto-refresh every (hours)
        <input
          name="interval_hours"
          type="number"
          min={1}
          max={48}
          defaultValue={intervalHours}
          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-sm" title="Ping when new matches arrive on manual refresh">
        <input type="checkbox" name="sound_enabled" defaultChecked={sound} />
        Sound ping
      </label>
      <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
        Save settings
      </button>
    </form>
  );
}
