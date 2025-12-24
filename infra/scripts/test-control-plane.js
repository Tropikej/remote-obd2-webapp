const { createClient } = require("./rate-limit-utils");
const WebSocket = require("ws");
const { PrismaClient } = require("@prisma/client");

const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const waitFor = (predicate, timeoutMs) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        if (await predicate()) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error("Timeout waiting for condition."));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 50);
  });

const run = async () => {
  const client = createClient(baseUrl);
  const prisma = new PrismaClient();
  const email = `control+${Date.now()}@example.com`;
  const password = "Password123";
  let ws;

  try {
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
    const userId = signup.body?.user?.id;
    assert(userId, "Signup response missing user id.");

    const csrfRegister = await client.getCsrf();
    const register = await client.request("/api/v1/agents/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfRegister,
      },
      body: JSON.stringify({
        agent_name: "Test Agent",
        hostname: "test-host",
        os: "windows",
        version: "0.0.0",
      }),
    });

    assert(register.status === 200, `Agent register failed: ${register.text}`);
    const agentToken = register.body?.agent_token;
    const agentId = register.body?.agent_id;
    const wsUrl = register.body?.ws_url;
    assert(agentToken && agentId, "Agent token/id missing in register response.");
    assert(wsUrl, "Agent register response missing ws_url.");

    let wsOpen = false;
    let sawCanConfig = false;
    let pendingRequestId = null;
    ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    ws.on("open", () => {
      wsOpen = true;
    });
    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      try {
        const payload = JSON.parse(text);
        if (payload?.type === "can_config_apply") {
          sawCanConfig = true;
          pendingRequestId = payload.request_id || null;
          ws.send(
            JSON.stringify({
              type: "can_config_ack",
              request_id: payload.request_id,
              dongle_id: payload.dongle_id || payload.dongleId || "",
              effective: payload.config,
              applied_at: new Date().toISOString(),
            })
          );
        }
      } catch (error) {
        // Ignore non-JSON payloads.
      }
    });

    await waitFor(() => wsOpen, 2000);

    const before = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { lastSeenAt: true },
    });
    assert(before?.lastSeenAt, "Agent lastSeenAt missing before WS heartbeat.");

    ws.send(
      JSON.stringify({
        type: "heartbeat",
        agent_id: agentId,
        ts: new Date().toISOString(),
      })
    );

    await waitFor(async () => {
      const after = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { lastSeenAt: true },
      });
      return Boolean(after?.lastSeenAt && after.lastSeenAt > before.lastSeenAt);
    }, 3000);

    const heartbeat = await client.request("/api/v1/agents/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ hostname: "test-host", os: "windows", version: "0.0.1" }),
    });
    assert(heartbeat.status === 200, `Heartbeat failed: ${heartbeat.text}`);

    const deviceId = Math.random().toString(16).slice(2, 18).padEnd(16, "0").slice(0, 16);
    const report = await client.request("/api/v1/agents/devices/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({
        devices: [
          {
            device_id: deviceId,
            fw_build: "1.2.3",
            udp_port: 50000,
            capabilities: 3,
            proto_ver: 1,
            lan_ip: "192.168.1.50",
            pairing_state: 0,
            owner_user_id: userId,
          },
        ],
      }),
    });

    assert(report.status === 200, `Device report failed: ${report.text}`);
    const dongleId = report.body?.devices?.[0]?.id;
    assert(dongleId, "Device report did not return dongle id.");

    const dongles = await client.request("/api/v1/dongles", { method: "GET" });
    assert(dongles.status === 200, `Dongle list failed: ${dongles.text}`);
    const listed = dongles.body?.dongles?.some((dongle) => dongle.id === dongleId);
    assert(listed, "Dongle list missing reported dongle.");

    const csrfConfig = await client.getCsrf();
    const config = await client.request(`/api/v1/dongles/${dongleId}/can-config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfConfig,
      },
      body: JSON.stringify({
        bitrate: 500000,
        sample_point_permille: 875,
        mode: "normal",
        use_raw: false,
        prescaler: 16,
        sjw: 1,
        tseg1: 13,
        tseg2: 2,
        auto_retx: true,
        tx_pause: false,
        protocol_exc: false,
      }),
    });

    assert(config.status === 200, `CAN config apply failed: ${config.text}`);
    assert(config.body?.applied === true, "CAN config not applied.");

    await waitFor(() => sawCanConfig, 2000);
    assert(Boolean(pendingRequestId), "Agent did not receive can_config request.");

    const detail = await client.request(`/api/v1/dongles/${dongleId}`, { method: "GET" });
    assert(detail.status === 200, `Dongle detail failed: ${detail.text}`);
    assert(detail.body?.can_config, "CAN config missing in dongle detail.");

    console.log("Control plane test passed.");
  } finally {
    if (ws) {
      ws.close();
    }
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error("Control plane test failed.");
  console.error(error);
  process.exit(1);
});
