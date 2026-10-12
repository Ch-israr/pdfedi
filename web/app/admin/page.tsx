"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Dashboard {
  totals: { files: number; jobs: number };
  jobs_by_status: Record<string, number>;
  jobs_by_tool: Record<string, number>;
  recent_jobs: Array<{
    id: string;
    tool: string;
    status: string;
    error: string | null;
    created_at: string;
  }>;
}

interface LoginAttempt {
  username: string;
  ip: string;
  success: boolean;
  created_at: string;
}

export default function AdminPage() {
  // Auth travels in an httpOnly cookie — nothing is stored in localStorage.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [attempts, setAttempts] = useState<LoginAttempt[] | null>(null);
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof api.adminAnalytics>> | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [d, a, an] = await Promise.all([
        api.adminDashboard(),
        api.adminLoginAttempts(),
        api.adminAnalytics(),
      ]);
      setDash(d);
      setAttempts(a);
      setAnalytics(an);
      setAuthed(true);
    } catch {
      setAuthed(false);
      setDash(null);
      setAttempts(null);
      setAnalytics(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.adminLogin(username, password);
      setPassword("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api.adminLogout();
    } finally {
      setAuthed(false);
      setDash(null);
      setAttempts(null);
      setAnalytics(null);
    }
  }

  if (authed === null) {
    return <p className="text-slate-500">Checking session…</p>;
  }

  if (!authed) {
    return (
      <div className="mx-auto max-w-sm">
        <h1 className="text-2xl font-extrabold">Admin sign in</h1>
        <form onSubmit={login} className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div>
            <label className="mb-1 block text-sm font-medium">Username</label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button
            disabled={busy}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  if (!dash) {
    return <p className="text-slate-500">Loading dashboard…</p>;
  }

  const failedRecent = (attempts || []).filter((a) => !a.success).length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Dashboard</h1>
        <button onClick={logout} className="text-sm text-slate-500 hover:text-brand-600">
          Sign out
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-3xl font-extrabold">{dash.totals.files}</div>
          <div className="text-sm text-slate-500">Files</div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-3xl font-extrabold">{dash.totals.jobs}</div>
          <div className="text-sm text-slate-500">Jobs</div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-3xl font-extrabold text-green-700">
            {dash.jobs_by_status["succeeded"] || 0}
          </div>
          <div className="text-sm text-slate-500">Succeeded</div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-3xl font-extrabold text-red-700">
            {dash.jobs_by_status["failed"] || 0}
          </div>
          <div className="text-sm text-slate-500">Failed</div>
        </div>
      </div>

      <h2 className="mt-10 text-lg font-bold">Recent jobs</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="px-4 py-3">Tool</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Error</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {dash.recent_jobs.map((j) => (
              <tr key={j.id} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium">{j.tool}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      j.status === "succeeded"
                        ? "bg-green-100 text-green-800"
                        : j.status === "failed"
                        ? "bg-red-100 text-red-800"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {j.status}
                  </span>
                </td>
                <td className="max-w-xs truncate px-4 py-2.5 text-slate-500">{j.error || "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{j.created_at.slice(0, 19).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-lg font-bold">Jobs by tool</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(dash.jobs_by_tool).map(([tool, n]) => (
          <div key={tool} className="rounded-xl bg-white px-4 py-3 shadow-sm">
            <div className="font-semibold">{tool}</div>
            <div className="text-sm text-slate-500">{n} jobs</div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-bold">Traffic analytics</h2>
      {analytics ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="text-3xl font-extrabold">{analytics.total_visits}</div>
              <div className="text-sm text-slate-500">Visits (7d)</div>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="text-3xl font-extrabold">{analytics.unique_visitors}</div>
              <div className="text-sm text-slate-500">Unique visitors</div>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="text-3xl font-extrabold">
                {analytics.by_country.length > 0 ? analytics.by_country[0].name : "—"}
              </div>
              <div className="text-sm text-slate-500">Top country</div>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="text-3xl font-extrabold">
                {analytics.by_device.length > 0
                  ? `${Math.round(
                      (analytics.by_device.find((d) => d.name === "mobile")?.count || 0) /
                        Math.max(analytics.total_visits, 1) * 100
                    )}%`
                  : "—"}
              </div>
              <div className="text-sm text-slate-500">Mobile share</div>
            </div>
          </div>
          {!analytics.geo_available && (
            <p className="mt-3 text-sm text-amber-700">
              GeoIP database not installed — country/city show as Unknown.
            </p>
          )}
          {analytics.by_day.length > 0 && (
            <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
              <h3 className="font-bold">Visits per day</h3>
              <div className="mt-3 flex h-28 items-end gap-1.5">
                {analytics.by_day.map((d) => {
                  const max = Math.max(...analytics.by_day.map((x) => x.count), 1);
                  return (
                    <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.count}`}>
                      <div
                        className="w-full rounded-t bg-brand-500"
                        style={{ height: `${Math.max((d.count / max) * 100, 4)}%` }}
                      />
                      <span className="text-[10px] text-slate-400">{d.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                { title: "By country", rows: analytics.by_country },
                { title: "By city", rows: analytics.by_city },
                { title: "By device", rows: analytics.by_device },
                { title: "By browser", rows: analytics.by_browser },
                { title: "By traffic source", rows: analytics.by_source },
                { title: "Top pages", rows: analytics.by_path },
              ]
            ).map((section) => (
              <div key={section.title} className="rounded-2xl bg-white p-5 shadow-sm">
                <h3 className="font-bold">{section.title}</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {section.rows.map((r) => (
                    <li key={r.name} className="flex justify-between">
                      <span className="text-slate-700">{r.name}</span>
                      <span className="font-semibold">{r.count}</span>
                    </li>
                  ))}
                  {section.rows.length === 0 && (
                    <li className="text-slate-500">No data yet.</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            IPs are truncated (never stored in full); bots excluded; data auto-deleted after{" "}
            {analytics.retention_days} days. Geolocation by DB-IP (db-ip.com), CC BY 4.0.
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Loading analytics…</p>
      )}

      <h2 className="mt-10 text-lg font-bold">
        Bot traffic{" "}
        {analytics && analytics.bots.total > 0 && (
          <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
            {analytics.bots.total} hits
          </span>
        )}
      </h2>
      {analytics ? (
        <>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h3 className="font-bold">By bot name</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {analytics.bots.by_name.map((r) => (
                  <li key={r.name} className="flex justify-between">
                    <span className="text-slate-700">{r.name}</span>
                    <span className="font-semibold">{r.count}</span>
                  </li>
                ))}
                {analytics.bots.by_name.length === 0 && (
                  <li className="text-slate-500">No bot visits yet.</li>
                )}
              </ul>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h3 className="font-bold">By country</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {analytics.bots.by_country.map((r) => (
                  <li key={r.name} className="flex justify-between">
                    <span className="text-slate-700">{r.name}</span>
                    <span className="font-semibold">{r.count}</span>
                  </li>
                ))}
                {analytics.bots.by_country.length === 0 && (
                  <li className="text-slate-500">No data yet.</li>
                )}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Bots are tracked separately (name + country only) and never counted as visitors.
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Loading bot stats…</p>
      )}

      <h2 className="mt-10 text-lg font-bold">
        Recent login attempts{" "}
        {failedRecent > 0 && (
          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
            {failedRecent} failed
          </span>
        )}
      </h2>
      <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">Result</th>
            </tr>
          </thead>
          <tbody>
            {(attempts || []).map((a, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-4 py-2.5 text-slate-500">
                  {a.created_at.slice(0, 19).replace("T", " ")}
                </td>
                <td className="px-4 py-2.5 font-medium">{a.username}</td>
                <td className="px-4 py-2.5 text-slate-500">{a.ip}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      a.success ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {a.success ? "Success" : "Failed"}
                  </span>
                </td>
              </tr>
            ))}
            {(attempts || []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-slate-500">
                  No login attempts recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
