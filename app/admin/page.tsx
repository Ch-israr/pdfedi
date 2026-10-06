"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import { useAuth } from "@/context/AuthContext";
import { adminApi, ApiError, type User, type Job } from "@/lib/api";

type Tab = "overview" | "users" | "jobs" | "audit";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    pending_verification: "bg-amber-100 text-amber-700",
    suspended: "bg-orange-100 text-orange-700",
    locked: "bg-red-100 text-red-700",
    banned: "bg-red-200 text-red-800",
    deleted: "bg-slate-200 text-slate-600",
  };
  const label = status.replace(/_/g, " ");
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] || "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

function UserActions({ user, onRefresh }: { user: User; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const status = user.account_status || "active";

  const run = async (fn: () => Promise<unknown>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await fn();
      onRefresh();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "suspended" ? (
        <button disabled={busy} onClick={() => run(() => adminApi.reactivateUser(user.id))}
          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Reactivate</button>
      ) : status === "active" ? (
        <button disabled={busy} onClick={() => run(() => adminApi.suspendUser(user.id), `Suspend ${user.email}?`)}
          className="rounded-md bg-orange-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">Suspend</button>
      ) : null}
      {status === "banned" ? (
        <button disabled={busy} onClick={() => run(() => adminApi.unblockUser(user.id), `Unblock ${user.email}?`)}
          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Unblock</button>
      ) : (status === "active" || status === "suspended") ? (
        <button disabled={busy}
          onClick={() => {
            const reason = window.prompt(`Reason for permanently blocking ${user.email}:`, "") || "";
            run(() => adminApi.blockUser(user.id, reason), `PERMANENTLY BLOCK ${user.email}? This cannot be undone except by unblocking.`);
          }}
          className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Block</button>
      ) : null}
      {(status === "active" || status === "suspended" || status === "banned") && (
        <>
          <button disabled={busy} onClick={() => run(() => adminApi.cancelSubscription(user.id), `Cancel subscription for ${user.email}?`)}
            className="rounded-md bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50">Cancel sub</button>
          <button disabled={busy} onClick={() => run(() => adminApi.deleteUser(user.id), `PERMANENTLY REMOVE ${user.email}? This is destructive.`)}
            className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50">Remove</button>
        </>
      )}
    </div>
  );
}

function AdminInner() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const refreshUsers = async () => {
    try {
      const u = await adminApi.users(userSearch.trim() || undefined).catch(() => ({ items: [] }));
      setUsers(u.items);
    } catch (e) {
      // keep existing list on refresh failure
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/dashboard");
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const [d, u, j, a] = await Promise.all([
          adminApi.dashboard().catch(() => null),
          adminApi.users().catch(() => ({ items: [] })),
          adminApi.jobs().catch(() => ({ items: [] })),
          adminApi.auditLogs().catch(() => ({ items: [] })),
        ]);
        setStats(d);
        setUsers(u.items);
        setJobs(j.items);
        setLogs(a.items);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to load admin data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin, router]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "users", label: "Users" },
    { key: "jobs", label: "Jobs" },
    { key: "audit", label: "Audit log" },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl font-bold text-slate-900">Admin</h1>
      <p className="mt-1 text-slate-500">Platform management and monitoring.</p>

      <div className="mt-6 flex gap-2 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mt-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <div className="mt-6">
          {tab === "overview" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {stats
                ? Object.entries(stats).slice(0, 8).map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs uppercase tracking-wide text-slate-400">{k.replace(/_/g, " ")}</p>
                      <p className="mt-1 text-2xl font-bold text-slate-900">{String(v)}</p>
                    </div>
                  ))
                : <p className="text-sm text-slate-400 col-span-4">No dashboard data available.</p>}
            </div>
          )}

          {tab === "users" && (
            <>
            <div className="mb-4">
              <input
                type="search"
                placeholder="Search users by email…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") refreshUsers(); }}
                className="w-full max-w-md rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium text-slate-500">Email</th>
                    <th className="px-4 py-3 font-medium text-slate-500">Status</th>
                    <th className="px-4 py-3 font-medium text-slate-500">Roles</th>
                    <th className="px-4 py-3 font-medium text-slate-500">Verified</th>
                    <th className="px-4 py-3 font-medium text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={u.account_status || "active"} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{u.roles?.join(", ") || "—"}</td>
                      <td className="px-4 py-3">{u.email_verified ? "✓" : "—"}</td>
                      <td className="px-4 py-3">
                        <UserActions user={u} onRefresh={refreshUsers} />
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No users found.</td></tr>}
                </tbody>
              </table>
            </div>
            </>
          )}

          {tab === "jobs" && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium text-slate-500">Job</th>
                    <th className="px-4 py-3 font-medium text-slate-500">Tool</th>
                    <th className="px-4 py-3 font-medium text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs">{j.id.slice(0, 8)}…</td>
                      <td className="px-4 py-3">{j.tool_key}</td>
                      <td className="px-4 py-3">{j.status}</td>
                    </tr>
                  ))}
                  {jobs.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">No jobs found.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "audit" && (
            <div className="space-y-2">
              {logs.map((l, i) => (
                <div key={i} className="rounded-lg border border-slate-200 px-4 py-3 text-sm">
                  <p className="font-medium text-slate-800">{String(l.action || l.event || "event")}</p>
                  <p className="text-xs text-slate-400">
                    {String(l.created_at || l.timestamp || "")} · {String(l.actor || l.user || "")}
                  </p>
                </div>
              ))}
              {logs.length === 0 && <p className="text-sm text-slate-400">No audit entries.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <RequireAuth>
      <AdminInner />
    </RequireAuth>
  );
}
