// API client — same-origin in production (/api/v1), configurable for dev.
const BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) || "/api/v1";

export interface ToolOption {
  name: string;
  kind: "text" | "number" | "boolean" | "select" | "pages";
  label: string;
  required: boolean;
  default: unknown;
  choices: string[] | null;
  help: string;
}

export interface ToolSpec {
  key: string;
  name: string;
  tagline: string;
  description: string;
  input_kinds: string[];
  min_files: number;
  max_files: number;
  options: ToolOption[];
  output_kind: string;
  output_ext: string;
  activity: "processing" | "converting" | "optimizing";
}

export interface UploadedFile {
  id: string;
  filename: string;
  size_bytes: number;
  mime: string;
  sha256: string;
  kind: string;
  upload_status: string;
  page_count: number | null;
  created_at: string;
}

export interface Job {
  id: string;
  tool: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  file_ids: string[];
  options: Record<string, unknown>;
  output_file_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  tools: (): Promise<ToolSpec[]> => req("/tools"),
  tool: (key: string): Promise<ToolSpec> => req(`/tools/${key}`),
  upload: async (file: File): Promise<UploadedFile> => {
    const form = new FormData();
    form.append("file", file);
    return req("/uploads", { method: "POST", body: form });
  },
  createJob: (tool_key: string, file_ids: string[], config: Record<string, unknown>): Promise<Job> =>
    req("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_key, file_ids, config }),
    }),
  job: (id: string): Promise<Job> => req(`/jobs/${id}`),
  cancelJob: (id: string): Promise<Job> =>
    req(`/jobs/${id}/cancel`, { method: "POST" }),
  retryJob: (id: string): Promise<Job> =>
    req(`/jobs/${id}/retry`, { method: "POST" }),
  quota: (tool: string): Promise<{ used: number; limit: number; remaining: number }> =>
    req(`/quota/${tool}`),
  limits: (): Promise<{ max_upload_mb: number; max_download_mb: number }> =>
    req("/limits"),
  downloadUrl: (fileId: string) => `${BASE}/downloads/${fileId}`,

  adminLogin: (username: string, password: string): Promise<{ username: string }> =>
    req("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    }),
  adminLogout: (): Promise<{ logged_out: boolean }> =>
    req("/admin/logout", { method: "POST", credentials: "same-origin" }),
  // Admin auth travels in an httpOnly cookie; no token handling needed.
  adminDashboard: () =>
    req("/admin/dashboard", { credentials: "same-origin" }),
  adminJobs: () =>
    req("/admin/jobs", { credentials: "same-origin" }),
  adminLoginAttempts: (): Promise<
    Array<{ username: string; ip: string; success: boolean; created_at: string }>
  > => req("/admin/login-attempts", { credentials: "same-origin" }),
  adminAnalytics: (): Promise<{
    total_visits: number;
    unique_visitors: number;
    days: number;
    retention_days: number;
    geo_available: boolean;
    by_country: Array<{ name: string; count: number }>;
    by_city: Array<{ name: string; count: number }>;
    by_device: Array<{ name: string; count: number }>;
    by_browser: Array<{ name: string; count: number }>;
    by_source: Array<{ name: string; count: number }>;
    by_day: Array<{ date: string; count: number }>;
    bots: {
      total: number;
      by_name: Array<{ name: string; count: number }>;
      by_country: Array<{ name: string; count: number }>;
    };
    recent: Array<{
      created_at: string;
      ip: string;
      country: string;
      city: string;
      device: string;
      browser: string;
      source: string;
      path: string;
    }>;
  }> => req("/admin/analytics", { credentials: "same-origin" }),
};
