import { prisma } from "../db";

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

const createSessionClient = (baseUrl: string) => {
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
  const email = `agent+${Date.now()}@example.com`;
  const password = "Password123";
  const client = createSessionClient(baseUrl);

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

  const csrfLogin = await client.getCsrf();
  const login = await client.request("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfLogin,
    },
    body: JSON.stringify({ email, password }),
  });
  assert(login.status === 200, `Login failed: ${login.text}`);

  const csrfRegister = await client.getCsrf();
  const register = await client.request("/api/v1/agents/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfRegister,
    },
    body: JSON.stringify({
      hostname: "test-host",
      os: "test-os",
      version: "0.0.0",
      agent_name: "Heartbeat Test Agent",
    }),
  });
  assert(register.status === 200, `Agent register failed: ${register.text}`);

  const agentId = register.body?.agent_id as string | undefined;
  const agentToken = register.body?.agent_token as string | undefined;
  assert(Boolean(agentId), "Agent ID missing.");
  assert(Boolean(agentToken), "Agent token missing.");

  const before = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { lastSeenAt: true },
  });
  assert(Boolean(before?.lastSeenAt), "Agent lastSeenAt missing before heartbeat.");

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const heartbeat = await fetch(`${baseUrl}/api/v1/agents/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agentToken}`,
    },
    body: JSON.stringify({
      hostname: "test-host",
      os: "test-os",
      version: "0.0.1",
      agent_name: "Heartbeat Test Agent",
    }),
  });
  const heartbeatText = await heartbeat.text();
  assert(heartbeat.status === 200, `Heartbeat failed: ${heartbeatText}`);

  const after = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { lastSeenAt: true },
  });
  assert(Boolean(after?.lastSeenAt), "Agent lastSeenAt missing after heartbeat.");
  assert(
    after!.lastSeenAt!.getTime() > before!.lastSeenAt!.getTime(),
    "Heartbeat did not update lastSeenAt."
  );

  console.log("Agent heartbeat validation passed.");
};

run()
  .catch((error) => {
    console.error("Agent heartbeat validation failed.");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
