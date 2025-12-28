type ApiErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, payload?: ApiErrorPayload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload?.code;
    this.details = payload?.details;
  }
}

type SessionClient = {
  request: (path: string, options?: RequestInit) => Promise<ApiResponse>;
  getCsrf: () => Promise<string>;
};

type ApiResponse = {
  status: number;
  body: any;
  text: string;
  headers: Headers;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const addUnique = (items: string[], value: string | null) => {
  if (!value) {
    return;
  }
  if (!items.includes(value)) {
    items.push(value);
  }
};

const addVariant = (items: string[], base: URL, host: string, port?: string) => {
  const next = new URL(base.toString());
  next.hostname = host;
  if (port !== undefined) {
    next.port = port;
  }
  addUnique(items, normalizeBaseUrl(next.toString()));
};

const buildFallbackUrls = (value: string) => {
  const normalized = normalizeBaseUrl(value);
  const urls: string[] = [normalized];
  try {
    const url = new URL(normalized);
    const isLocal =
      url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    if (isLocal) {
      addVariant(urls, url, "localhost", url.port || undefined);
      addVariant(urls, url, "127.0.0.1", url.port || undefined);
      addVariant(urls, url, "::1", url.port || undefined);
    }
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const portNum = Number(port);
    if (isLocal && Number.isFinite(portNum)) {
      const start = portNum >= 3000 && portNum <= 3009 ? 3000 : portNum;
      for (let candidate = start; candidate < start + 10; candidate += 1) {
        const candidatePort = String(candidate);
        addVariant(urls, url, "localhost", candidatePort);
        addVariant(urls, url, "127.0.0.1", candidatePort);
        addVariant(urls, url, "::1", candidatePort);
      }
    }
  } catch (error) {
    return urls;
  }
  return urls;
};

const fetchWithFallback = async (
  baseUrls: string[],
  path: string,
  options: RequestInit
) => {
  let lastError: unknown = null;
  for (const baseUrl of baseUrls) {
    try {
      return await fetch(`${baseUrl}${path}`, options);
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Request ${path} failed after trying ${baseUrls.join(", ")}: ${message}`);
};

const parseJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

const extractSessionCookie = (setCookie: string | null) => {
  if (!setCookie) {
    return null;
  }
  const match = setCookie.match(/dashboard_session=[^;]+/i);
  return match ? match[0] : null;
};

const createSessionClient = (apiBaseUrl: string): SessionClient => {
  let cookie: string | null = null;

  const baseUrls = buildFallbackUrls(apiBaseUrl);

  const request = async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (cookie) {
      headers.set("Cookie", cookie);
    }

    let res: Response;
    try {
      res = await fetchWithFallback(baseUrls, path, {
        ...options,
        headers,
      });
    } catch (error) {
      throw new Error(`Request ${path} failed: ${(error as Error).message}`);
    }

    const setCookie = res.headers.get("set-cookie");
    const nextCookie = extractSessionCookie(setCookie);
    if (nextCookie) {
      cookie = nextCookie;
    }

    const text = await res.text();
    const body = parseJson(text);
    return { status: res.status, body, text, headers: res.headers };
  };

  const getCsrf = async () => {
    const res = await request("/api/v1/auth/csrf", { method: "GET" });
    if (!res.body || !res.body.token) {
      throw new Error(`CSRF token missing: ${res.text}`);
    }
    return res.body.token as string;
  };

  return { request, getCsrf };
};

const ensureOk = (res: ApiResponse, context: string) => {
  if (res.status >= 200 && res.status < 300) {
    return;
  }
  const payload = res.body as ApiErrorPayload | null;
  const message = payload?.message || `${context} failed with status ${res.status}.`;
  throw new ApiError(message, res.status, payload || undefined);
};

type RegisterAgentInput = {
  apiBaseUrl: string;
  userEmail: string;
  userPassword: string;
  hostname: string;
  os: string;
  version: string;
  agentName?: string;
  networkInterfaces?: NetworkInterfaceSummary[];
};

export type AgentRegistration = {
  agentId: string;
  agentToken: string;
  wsUrl: string;
};

export type HeartbeatInput = {
  apiBaseUrl: string;
  agentToken: string;
  hostname?: string;
  os?: string;
  version?: string;
  agentName?: string;
  networkInterfaces?: NetworkInterfaceSummary[];
};

export type DeviceReport = {
  device_id: string;
  fw_build?: string;
  udp_port?: number;
  capabilities?: number;
  proto_ver?: number;
  lan_ip?: string;
  pairing_state?: number;
  pairing_nonce?: string;
};

export type NetworkInterfaceSummary = {
  name: string;
  addresses: {
    address: string;
    family: string;
    netmask?: string;
  }[];
};

export type ReportDevicesInput = {
  apiBaseUrl: string;
  agentToken: string;
  devices: DeviceReport[];
};

export type ReportedDeviceRecord = {
  id: string;
  device_id: string;
  ownership_state?: string;
  owner_user_id?: string | null;
};

export type ReportDevicesResponse = {
  devices: ReportedDeviceRecord[];
};

export const registerAgent = async (input: RegisterAgentInput): Promise<AgentRegistration> => {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  const session = createSessionClient(apiBaseUrl);

  const csrf = await session.getCsrf();
  const login = await session.request("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({
      email: input.userEmail,
      password: input.userPassword,
    }),
  });
  ensureOk(login, "Login");

  const csrfRegister = await session.getCsrf();
  const register = await session.request("/api/v1/agents/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfRegister,
    },
    body: JSON.stringify({
      agent_name: input.agentName,
      hostname: input.hostname,
      os: input.os,
      version: input.version,
      network_interfaces: input.networkInterfaces,
    }),
  });
  ensureOk(register, "Agent register");

  const agentId = register.body?.agent_id as string | undefined;
  const agentToken = register.body?.agent_token as string | undefined;
  const wsUrl = register.body?.ws_url as string | undefined;

  if (!agentId || !agentToken || !wsUrl) {
    throw new Error("Agent registration response missing required fields.");
  }

  return { agentId, agentToken, wsUrl };
};

export const sendHeartbeat = async (input: HeartbeatInput) => {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  const res = await fetchWithFallback(
    buildFallbackUrls(apiBaseUrl),
    "/api/v1/agents/heartbeat",
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.agentToken}`,
    },
    body: JSON.stringify({
      agent_name: input.agentName,
      hostname: input.hostname,
      os: input.os,
      version: input.version,
      network_interfaces: input.networkInterfaces,
    }),
    }
  );

  const text = await res.text();
  const body = parseJson(text);
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(
      body?.message || "Heartbeat failed.",
      res.status,
      body || undefined
    );
  }

  return body;
};

export const reportDevices = async (
  input: ReportDevicesInput
): Promise<ReportDevicesResponse> => {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  const res = await fetchWithFallback(
    buildFallbackUrls(apiBaseUrl),
    "/api/v1/agents/devices/report",
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.agentToken}`,
    },
    body: JSON.stringify({
      devices: input.devices,
    }),
    }
  );

  const text = await res.text();
  const body = parseJson(text);
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(body?.message || "Device report failed.", res.status, body || undefined);
  }

  return (body || { devices: [] }) as ReportDevicesResponse;
};

export const isAuthError = (error: unknown) => {
  if (!(error instanceof ApiError)) {
    return false;
  }
  return error.status === 401 || error.status === 403;
};
