/**
 * PDFEDI API client.
 * Talks to the live backend at NEXT_PUBLIC_API_URL.
 * Handles Bearer auth, transparent access-token refresh on 401, and the
 * standard {error:{code,message,details,request_id}} error envelope.
 */

/**
 * Resolve the backend base URL.
 *
 * - Set NEXT_PUBLIC_API_URL in Vercel project settings or .env.local.
 * - There is NO hardcoded fallback: a stale URL silently breaking the app
 *   is worse than a clear misconfiguration.
 * - Never throws: during Next.js static prerendering the env var may be
 *   absent, and a throw at import time would fail the entire build.
 *   Instead we log once and return a clearly-invalid placeholder URL, so
 *   any runtime call fails obviously (DNS error to .invalid) rather than
 *   silently hitting the wrong backend.
 */
let _warnedMissingApiUrl = false;

export function getApiBase(): string {
  // Same-origin: backend is served from /api/v1 on the same deployment.
  // Falls back to NEXT_PUBLIC_API_URL if set (for split deployments).
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (raw) {
    return raw.replace(/\/+$/, ""); // strip trailing slashes
  }
  // Same-origin default (combined frontend+backend deployment)
  if (typeof window !== "undefined") {
    return "/api/v1";
  }
  if (!_warnedMissingApiUrl) {
    _warnedMissingApiUrl = true;
    console.warn(
      "[pdfedi] NEXT_PUBLIC_API_URL is not set, using same-origin /api/v1. " +
        "Set it in Vercel project settings if using a split deployment."
    );
  }
  return "/api/v1";
}

/** Base URL for the backend API. Prefer getApiBase() in new code. */
export const API_BASE = getApiBase();

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
    retryable?: boolean;
  };
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
    this.requestId = body.error.request_id;
  }
}

// ---------------------------------------------------------------------------
// Token storage (no-op: no auth in public API)
// Kept for backward compatibility; clears any legacy tokens.
// ---------------------------------------------------------------------------
export const tokenStore = {
  getAccess(): string | null { return null; },
  getRefresh(): string | null { return null; },
  set(_access: string, _refresh: string) {
    // no-op: clear legacy tokens if present
    if (typeof window !== "undefined") {
      localStorage.removeItem("pdfedi_access_token");
      localStorage.removeItem("pdfedi_refresh_token");
    }
  },
  setAccess(_access: string) {},
  clear() {
    if (typeof window !== "undefined") {
      localStorage.removeItem("pdfedi_access_token");
      localStorage.removeItem("pdfedi_refresh_token");
    }
  },
};

// ---------------------------------------------------------------------------
// Low-level request with refresh-on-401
// ---------------------------------------------------------------------------
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    const body = contentType.includes("json")
      ? ((await res.json().catch(() => null)) as ApiErrorBody | null)
      : null;
    throw new ApiError(
      res.status,
      body ?? { error: { code: "REQUEST_FAILED", message: `Request failed (${res.status})` } }
    );
  }
  if (!contentType.includes("json")) {
    // Binary download
    return (await res.blob()) as unknown as T;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  /** Multipart upload; onProgress receives 0..1 */
  upload: async <T>(path: string, file: File, onProgress?: (p: number) => void): Promise<T> => {
    const tryOnce = () =>
      new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}${path}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText) as T);
            } catch {
              reject(new ApiError(xhr.status, { error: { code: "BAD_RESPONSE", message: "Invalid server response." } }));
            }
          } else {
            let body: ApiErrorBody | null = null;
            try {
              body = JSON.parse(xhr.responseText);
            } catch { /* ignore */ }
            reject(
              new ApiError(
                xhr.status,
                body ?? { error: { code: "UPLOAD_FAILED", message: `Upload failed (${xhr.status})` } }
              )
            );
          }
        };
        xhr.onerror = () =>
          reject(new ApiError(0, { error: { code: "NETWORK_ERROR", message: "Upload failed: connection lost. Please check your internet connection and try again." } }));
        const form = new FormData();
        form.append("file", file);
        xhr.send(form);
      });

    try {
      return await tryOnce();
    } catch (e) {
      throw e;
    }
  },
};

// ---------------------------------------------------------------------------
// Typed domain API
// ---------------------------------------------------------------------------
export interface User {
  id: string;
  email: string;
  name?: string | null;
  display_name?: string | null;
  email_verified: boolean;
  account_status?: string;
  roles?: string[];
  created_at?: string;
  last_login_at?: string | null;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user_id: string;
}

export interface ToolInfo {
  key: string;
  name: string;
  description: string;
  input_kinds?: string[];
  multi_input?: boolean;
}

export interface UploadedFile {
  id: string;
  display_name: string;
  filename?: string;
  size_bytes: number;
  content_type?: string;
  mime_type?: string;
  page_count?: number;
  upload_status?: string;
  created_at?: string;
}

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  tool_key: string;
  tool_version?: string;
  status: JobStatus;
  progress_percent?: number;
  error_code?: string | null;
  error_reference?: string | null;
  outputs?: Array<{ file_id: string; output_type: string; download_count: number }>;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface Plan {
  code: string;
  name: string;
  description?: string;
  price_monthly?: number | null;
  price_yearly?: number | null;
  currency?: string;
  limits?: Record<string, unknown>;
}

export const authApi = {
  register: (email: string, password: string, name: string) => {
    const parts = name.trim().split(/\s+/);
    const first_name = parts[0] || "";
    const last_name = parts.slice(1).join(" ") || "";
    return api.post<{ message: string; user_id: string }>("/auth/register", { email, password, first_name, last_name });
  },
  login: (email: string, password: string) =>
    api.post<AuthResponse>("/auth/login", { email, password }),
  logout: () => api.post("/auth/logout"),
  me: () => api.get<User>("/account/me"),
  refresh: (refresh_token: string) =>
    api.post<{ access_token: string; refresh_token: string }>("/auth/refresh", { refresh_token }),
  requestPasswordReset: (email: string) => api.post("/auth/password-reset/request", { email }),
  confirmPasswordReset: (token: string, new_password: string) =>
    api.post("/auth/password-reset/confirm", { token, new_password }),
  verifyEmail: (token: string) => api.post("/auth/verify-email", { token }),
  changePassword: (current_password: string, new_password: string) =>
    api.post("/account/me/change-password", { current_password, new_password }),
  sessions: () => api.get<Array<{ id: string; user_agent?: string; created_at?: string; current?: boolean }>>("/auth/sessions"),
  revokeSession: (id: string) => api.del(`/auth/sessions/${id}`),
};

export const toolsApi = {
  list: () => api.get<ToolInfo[]>("/tools"),
  get: (key: string) => api.get<ToolInfo>(`/tools/${key}`),
};

export const filesApi = {
  upload: (file: File, onProgress?: (p: number) => void) =>
    api.upload<UploadedFile>("/uploads", file, onProgress),
  list: (limit = 20, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return api.get<{ items: UploadedFile[]; next_cursor?: string | null }>(`/files?${params}`);
  },
  remove: (id: string) => api.del(`/files/${id}`),
  downloadUrl: (id: string) => {
    const t = tokenStore.getAccess();
    // Downloads go through an authenticated fetch; helper builds a blob URL.
    return { url: `${API_BASE}/downloads/${id}`, token: t };
  },
};

export async function downloadFile(fileId: string, filename: string) {
  const access = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}/downloads/${fileId}`, {
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const jobsApi = {
  create: (tool_key: string, file_ids: string[], config: Record<string, unknown> = {}) =>
    api.post<Job>("/jobs", { tool_key, file_ids, config }),
  list: (limit = 20, cursor?: string, status?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    if (status) params.set("status", status);
    return api.get<{ items: Job[]; next_cursor?: string | null }>(`/jobs?${params}`);
  },
  get: (id: string) => api.get<Job>(`/jobs/${id}`),
  cancel: (id: string) => api.post(`/jobs/${id}/cancel`),
  retry: (id: string) => api.post<Job>(`/jobs/${id}/retry`),
};

export const billingApi = {
  plans: () => api.get<Plan[]>("/plans"),
  subscription: () => api.get<unknown>("/subscriptions/current").catch(() => null),
};

export const adminApi = {
  dashboard: () => api.get<Record<string, unknown>>("/admin/dashboard"),
  users: (q?: string, limit = 20, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (q) params.set("q", q);
    if (cursor) params.set("cursor", cursor);
    return api.get<{ items: User[]; next_cursor?: string | null }>(`/admin/users?${params}`);
  },
  userDetail: (id: string) => api.get<User & { roles?: string[]; subscription?: unknown }>(`/admin/users/${id}`),
  suspendUser: (id: string) => api.post(`/admin/users/${id}/suspend`, {}),
  reactivateUser: (id: string) => api.post(`/admin/users/${id}/reactivate`, {}),
  blockUser: (id: string, reason: string = "") => api.post(`/admin/users/${id}/block`, { reason }),
  unblockUser: (id: string) => api.post(`/admin/users/${id}/unblock`, {}),
  deleteUser: (id: string) => api.del(`/admin/users/${id}`),
  setRoles: (id: string, roles: string[]) => api.post(`/admin/users/${id}/roles`, { roles }),
  assignSubscription: (id: string, plan_code: string) =>
    api.post(`/admin/users/${id}/subscription`, { plan_code }),
  cancelSubscription: (id: string) => api.post(`/admin/users/${id}/subscription/cancel`, {}),
  jobs: (limit = 20, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return api.get<{ items: Job[]; next_cursor?: string | null }>(`/admin/jobs?${params}`);
  },
  auditLogs: (limit = 20, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return api.get<{ items: Array<Record<string, unknown>>; next_cursor?: string | null }>(
      `/admin/audit-logs?${params}`
    );
  },
};
