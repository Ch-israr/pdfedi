"use client";

import { useState } from "react";
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

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("pdfedi_admin_token") : null
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(t: string) {
    try {
      setDash(await api.adminDashboard(t));
    } catch {
      setToken(null);
      localStorage.removeItem("pdfedi_admin_token");
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.adminLogin(username, password);
      localStorage.setItem("pdfedi_admin_token", r.token);
      setToken(r.token);
      await load(r.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    localStorage.removeItem("pdfedi_admin_token");
    setToken(null);
    setDash(null);
  }

  if (!token) {
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
    load(token);
    return <p className="text-slate-500">Loading dashboard…</p>;
  }

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
    </div>
  );
}
