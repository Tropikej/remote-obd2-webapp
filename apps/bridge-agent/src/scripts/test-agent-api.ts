import { randomBytes } from "crypto";
import { registerAgent, reportDevices, sendHeartbeat } from "../api/client";

const ensureFetch = () => {
  if (typeof fetch !== "function") {
    throw new Error("This script requires Node 18+ with global fetch.");
  }
};

const parseJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

const createClient = (baseUrl: string) => {
  ensureFetch();
  let cookie: string | null = null;

  const request = async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (cookie) {
      headers.set("Cookie", cookie);
    }
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      cookie = setCookie.split(";")[0];
    }
    const text = await res.text();
    return { status: res.status, body: parseJson(text), text };
  };

  const getCsrf = async () => {
    const res = await request("/api/v1/auth/csrf", { method: "GET" });
    if (!res.body?.token) {
      throw new Error(`CSRF token missing: ${res.text}`);
    }
    return res.body.token as string;
  };

  return { request, getCsrf };
};

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const client = createClient(baseUrl);
  const email = `agent+${Date.now()}@example.com`;
  const password = "Password123";

  const csrfSignup = await client.getCsrf();
  const signup = await client.request("/api/v1/auth/signup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfSignup,
    },
    body: JSON.stringify({ email, password }),
  });

  assert(signup.status === 200, `Signup failed: ${signup.text}`);

  const registration = await registerAgent({
    apiBaseUrl: baseUrl,
    userEmail: email,
    userPassword: password,
    hostname: "test-host",
    os: "test-os",
    version: "0.0.0",
    agentName: "Bridge Agent Test",
  });

  assert(Boolean(registration.agentId), "Agent ID missing.");
  assert(Boolean(registration.agentToken), "Agent token missing.");
  assert(Boolean(registration.wsUrl), "WS URL missing.");

  await sendHeartbeat({
    apiBaseUrl: baseUrl,
    agentToken: registration.agentToken,
    hostname: "test-host",
    os: "test-os",
    version: "0.0.1",
    agentName: "Bridge Agent Test",
  });

  const deviceId = randomBytes(8).toString("hex");
  const report = await reportDevices({
    apiBaseUrl: baseUrl,
    agentToken: registration.agentToken,
    devices: [
      {
        device_id: deviceId,
        fw_build: "1.2.3",
        udp_port: 50000,
        capabilities: 3,
        proto_ver: 1,
        lan_ip: "192.168.1.50",
        pairing_state: 0,
      },
    ],
  });

  assert(report?.devices?.[0]?.device_id === deviceId, "Device report failed.");

  console.log("Bridge agent API test passed.");
};

run().catch((error) => {
  console.error("Bridge agent API test failed.");
  console.error(error);
  process.exit(1);
});
