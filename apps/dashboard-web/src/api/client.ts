import type {
  ApiErrorResponse,
  CanConfigPayload,
  DongleDetail,
  DongleSummary,
} from "@dashboard/shared";

export type Role = "user" | "super_admin";

export type User = {
  id: string;
  email: string;
  role: Role;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

const parseJson = async (response: Response) => {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
};

const ensureHeaders = (initHeaders: HeadersInit | undefined, body?: BodyInit | null) => {
  const headers = new Headers(initHeaders ?? {});
  const hasBody = body !== undefined && body !== null;
  const isJsonBody = hasBody && typeof body === "string";
  if (hasBody && !headers.has("Content-Type") && isJsonBody) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
};

const ensureCsrf = async () => {
  if (csrfToken) return csrfToken;
  if (csrfTokenPromise) return csrfTokenPromise;
  csrfTokenPromise = (async () => {
    const res = await fetch("/api/v1/auth/csrf", {
      credentials: "include",
    });
    const data = await parseJson(res);
    if (!res.ok || !data?.token) {
      throw new ApiError("CSRF_FETCH_FAILED", "Unable to fetch CSRF token.", res.status || 500);
    }
    csrfToken = data.token as string;
    return csrfToken;
  })();
  try {
    return await csrfTokenPromise;
  } finally {
    csrfTokenPromise = null;
  }
};

type RequestOptions = RequestInit & { skipCsrf?: boolean };

const request = async <T>(path: string, init: RequestOptions = {}, retry = true): Promise<T> => {
  const method = (init.method ?? "GET").toUpperCase();
  const needsCsrf = !SAFE_METHODS.has(method);
  const headers = ensureHeaders(init.headers, init.body);

  if (needsCsrf && !init.skipCsrf) {
    const token = await ensureCsrf();
    headers.set("X-CSRF-Token", token);
  }

  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: "include",
  });

  const data = await parseJson(response);

  if (!response.ok) {
    const err = data as ApiErrorResponse | null;
    if (
      retry &&
      response.status === 403 &&
      err?.code === "CSRF_INVALID" &&
      (!init.body || typeof init.body === "string")
    ) {
      csrfToken = null;
      await ensureCsrf();
      return request<T>(path, init, false);
    }
    throw new ApiError(
      err?.code ?? "UNKNOWN_ERROR",
      err?.message ?? `Request failed with status ${response.status}`,
      response.status,
      err?.details as Record<string, unknown> | undefined
    );
  }

  return data as T;
};

export type AuthResponse = { user: User };
export type ListDonglesResponse = { dongles: DongleSummary[] };
export type GroupResponse = {
  id: string;
  user_id: string;
  dongle_a_id: string;
  dongle_b_id: string;
  mode: string;
  created_at: string;
  updated_at: string;
  offline_side?: "A" | "B" | null;
  buffered_frames_a_to_b?: number;
  buffered_frames_b_to_a?: number;
};

export type ListGroupsResponse = { groups: GroupResponse[] };
export type CommandRequest = {
  command: string;
  args?: string[];
  timeout_ms?: number;
  command_target?: "agent" | "dongle";
  allow_dangerous?: boolean;
};

export type CommandStatus = {
  command_id: string;
  status: "queued" | "running" | "ok" | "error" | "timeout" | "cancelled";
  dongle_id?: string;
  group_id?: string;
  command_target?: "agent" | "dongle";
  command_source?: "web" | "agent" | "system";
  started_at?: string | null;
  completed_at?: string | null;
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
};

export type CanFrameSendRequest = {
  can_id: string;
  is_extended?: boolean;
  data_hex: string;
  bus?: string;
};

export type BenchmarkMode = "ordered" | "fuzz";

export type BenchmarkSendRequest = {
  mode: BenchmarkMode;
  delay_ms: number;
  can_id?: string;
  dlc?: number;
  is_extended?: boolean;
  bus?: string;
};

export type BenchmarkSendResponse = {
  ok: boolean;
  frame: {
    mode: BenchmarkMode;
    delay_ms: number;
    can_id: string;
    is_extended: boolean;
    dlc: number;
    data_hex: string;
    bus?: string;
  };
};

export type AuditLogEntry = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  actor_user_id?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
};

export type AdminUser = User & { status: "active" | "disabled" };

export const api = {
  ensureCsrf,
  getCsrf() {
    return ensureCsrf();
  },
  refreshCsrf() {
    csrfToken = null;
    csrfTokenPromise = null;
    return ensureCsrf();
  },
  async bootstrapSession() {
    const token = await ensureCsrf();
    try {
      const { user } = await this.getMe();
      return { user, token };
    } catch (error) {
      if (error instanceof ApiError && error.code === "AUTH_SESSION_EXPIRED") {
        return { user: null, token };
      }
      if (error instanceof ApiError && error.status === 401) {
        return { user: null, token };
      }
      throw error;
    }
  },
  login(email: string, password: string) {
    return request<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  signup(email: string, password: string) {
    return request<AuthResponse>("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  logout() {
    csrfToken = null;
    return request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST", skipCsrf: true });
  },
  getMe() {
    return request<AuthResponse>("/api/v1/auth/me");
  },
  listDongles() {
    return request<ListDonglesResponse>("/api/v1/dongles");
  },
  getDongle(id: string) {
    return request<DongleDetail>(`/api/v1/dongles/${id}`);
  },
  startPairingMode(id: string) {
    return request<{ pairing_session_id?: string; expires_at?: string; paired?: boolean; hold_until?: string; ownership_state?: string; owner_user_id?: string }>(
      `/api/v1/dongles/${id}/pairing-mode`,
      { method: "POST" }
    );
  },
  submitPairing(id: string, payload: { pairing_session_id: string; pin: string; pairing_nonce?: string }) {
    return request<{ status: string; dongle_id?: string; owner_user_id?: string; hold_until?: string; attempts_remaining?: number }>(
      `/api/v1/dongles/${id}/pairing-submit`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },
  applyCanConfig(id: string, payload: CanConfigPayload) {
    return request<{ applied: boolean; effective: CanConfigPayload; applied_at?: string }>(
      `/api/v1/dongles/${id}/can-config`,
      { method: "PUT", body: JSON.stringify(payload) }
    );
  },
  sendCanFrame(id: string, payload: CanFrameSendRequest) {
    return request<{ ok: boolean }>(`/api/v1/dongles/${id}/can/send`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  benchmarkSend(id: string, payload: BenchmarkSendRequest) {
    return request<BenchmarkSendResponse>(`/api/v1/benchmark/dongles/${id}/send`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  sendCommand(id: string, payload: CommandRequest) {
    return request<{ command_id: string; status: string }>(`/api/v1/dongles/${id}/commands`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getCommandStatus(id: string, commandId: string) {
    return request<CommandStatus>(`/api/v1/dongles/${id}/commands/${commandId}`);
  },
  unpairDongle(id: string) {
    return request<{ ok: boolean }>(`/api/v1/dongles/${id}/unpair`, { method: "POST" });
  },
  listGroups() {
    return request<ListGroupsResponse>("/api/v1/groups");
  },
  getGroup(id: string) {
    return request<GroupResponse>(`/api/v1/groups/${id}`);
  },
  createGroup(input: { dongle_a_id: string; dongle_b_id: string }) {
    return request<GroupResponse>("/api/v1/groups", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  activateGroup(id: string) {
    return request<GroupResponse>(`/api/v1/groups/${id}/activate`, { method: "POST" });
  },
  deactivateGroup(id: string) {
    return request<GroupResponse>(`/api/v1/groups/${id}/deactivate`, { method: "POST" });
  },
  adminPing() {
    return request<{ ok: boolean; role?: string }>(`/api/v1/admin/ping`);
  },
  adminForceUnpair(id: string) {
    return request<{ ok: boolean }>(`/api/v1/admin/dongles/${id}/force-unpair`, { method: "POST" });
  },
  adminListUsers() {
    return request<{ users: AdminUser[] }>(`/api/v1/admin/users`);
  },
  adminDisableUser(id: string) {
    return request<{ user: AdminUser }>(`/api/v1/admin/users/${id}/disable`, { method: "POST" });
  },
  adminListAuditLogs(params?: { action?: string; from?: string; to?: string }) {
    const search = new URLSearchParams();
    if (params?.action) search.set("action", params.action);
    if (params?.from) search.set("from", params.from);
    if (params?.to) search.set("to", params.to);
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return request<{ logs: AuditLogEntry[] }>(`/api/v1/admin/audit-logs${suffix}`);
  },
  streams: {
    dongleConsoleUrl(id: string) {
      return `/api/v1/streams/dongles/${id}/console`;
    },
    groupConsoleUrl(id: string) {
      return `/api/v1/streams/groups/${id}/console`;
    },
    benchmarkDongleUrl(id: string) {
      return `/api/v1/benchmark/dongles/${id}/stream`;
    },
  },
};
