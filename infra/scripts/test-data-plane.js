const { createClient } = require("./rate-limit-utils");
const WebSocket = require("ws");
const { PrismaClient } = require("@prisma/client");
const { randomBytes } = require("crypto");

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://postgres:dashboard@localhost:5434/dashboard";
}

const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const waitFor = (predicate, timeoutMs, intervalMs = 50) =>
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
    }, intervalMs);
  });

const registerAgent = async (client, email, password, agentName) => {
  const csrf = await client.getCsrf();
  const register = await client.request("/api/v1/agents/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({
      agent_name: agentName,
      hostname: "test-host",
      os: "test-os",
      version: "0.0.0",
    }),
  });

  assert(register.status === 200, `Agent register failed: ${register.text}`);
  return {
    agentId: register.body?.agent_id,
    agentToken: register.body?.agent_token,
  };
};

const reportDevice = async (token, deviceId) => {
  const res = await fetch(`${baseUrl}/api/v1/agents/devices/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      devices: [
        {
          device_id: deviceId,
          fw_build: "1.0.0",
          udp_port: 40000,
          capabilities: 3,
          proto_ver: 1,
          lan_ip: "192.168.1.10",
          pairing_state: 0,
        },
      ],
    }),
  });
  const text = await res.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  })();
  assert(res.status === 200, `Device report failed: ${text}`);
  const id = body?.devices?.[0]?.id;
  assert(id, "Device id missing in report response.");
  return id;
};

const toWsUrl = (url) => url.replace(/^http/, "ws") + "/ws/data";

const main = async () => {
  const client = createClient(baseUrl);
  const email = `relay+${Date.now()}@example.com`;
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
  const userId = signup.body?.user?.id;
  assert(userId, "User id missing from signup response.");

  const agentA = await registerAgent(client, email, password, "relay-agent-a");
  const agentB = await registerAgent(client, email, password, "relay-agent-b");
  assert(agentA.agentId && agentA.agentToken, "Agent A registration incomplete.");
  assert(agentB.agentId && agentB.agentToken, "Agent B registration incomplete.");

  const deviceAId = await reportDevice(agentA.agentToken, randomBytes(8).toString("hex"));
  const deviceBId = await reportDevice(agentB.agentToken, randomBytes(8).toString("hex"));

  // Force ownership to the test user to allow grouping without full pairing.
  await prisma.dongle.update({
    where: { id: deviceAId },
    data: { ownerUserId: userId, ownershipState: "CLAIMED_ACTIVE", lastSeenAgentId: agentA.agentId },
  });
  await prisma.dongle.update({
    where: { id: deviceBId },
    data: { ownerUserId: userId, ownershipState: "CLAIMED_ACTIVE", lastSeenAgentId: agentB.agentId },
  });

  const csrfGroup = await client.getCsrf();
  const createGroup = await client.request("/api/v1/groups", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfGroup,
    },
    body: JSON.stringify({ dongle_a_id: deviceAId, dongle_b_id: deviceBId }),
  });
  assert(createGroup.status === 200, `Create group failed: ${createGroup.text}`);
  const groupId = createGroup.body?.id;
  assert(groupId, "Group id missing.");

  const csrfActivate = await client.getCsrf();
  const activate = await client.request(`/api/v1/groups/${groupId}/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfActivate,
    },
  });
  assert(activate.status === 200, `Activate group failed: ${activate.text}`);

  const wsA = new WebSocket(toWsUrl(baseUrl), {
    headers: { Authorization: `Bearer ${agentA.agentToken}` },
  });
  const wsB = new WebSocket(toWsUrl(baseUrl), {
    headers: { Authorization: `Bearer ${agentB.agentToken}` },
  });

  let wsAOpen = false;
  let wsBOpen = false;
  let receivedOnB = [];
  let replayReceived = false;

  wsA.on("open", () => {
    wsAOpen = true;
  });
  wsB.on("open", () => {
    wsBOpen = true;
  });
  wsB.on("close", () => {
    wsBOpen = false;
  });
  wsB.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString("utf8");
    try {
      const parsed = JSON.parse(text);
      if (parsed?.type === "can_frame") {
        receivedOnB.push(parsed);
      }
    } catch {
      // ignore
    }
  });

  await waitFor(() => wsAOpen && wsBOpen, 3000);

  const frame1 = {
    type: "can_frame",
    group_id: groupId,
    dongle_id: deviceAId,
    frame: {
      ts: new Date().toISOString(),
      can_id: "0x123",
      is_extended: false,
      dlc: 8,
      data_hex: "1122334455667788",
    },
  };
  wsA.send(JSON.stringify(frame1));

  await waitFor(() => receivedOnB.length >= 1, 3000);

  // Simulate target offline and buffering
  wsB.close();
  await waitFor(() => !wsBOpen, 2000);
  const frameBuffered = {
    type: "can_frame",
    group_id: groupId,
    dongle_id: deviceAId,
    frame: {
      ts: new Date().toISOString(),
      can_id: "0x456",
      is_extended: false,
      dlc: 8,
      data_hex: "AABBCCDDEEFF0011",
    },
  };
  wsA.send(JSON.stringify(frameBuffered));

  const groupsAfterDegrade = await client.request("/api/v1/groups", { method: "GET" });
  const modeAfterDegrade = groupsAfterDegrade.body?.groups?.find((g) => g.id === groupId)?.mode;
  assert(modeAfterDegrade === "DEGRADED", "Group did not enter DEGRADED mode when target offline.");

  // Reconnect B and expect replay
  const wsB2 = new WebSocket(toWsUrl(baseUrl), {
    headers: { Authorization: `Bearer ${agentB.agentToken}` },
  });
  wsB2.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString("utf8");
    try {
      const parsed = JSON.parse(text);
      if (parsed?.type === "can_frame" && parsed.frame?.can_id === "0x456") {
        replayReceived = true;
      }
    } catch {
      // ignore
    }
  });

  await waitFor(() => wsB2.readyState === WebSocket.OPEN, 3000);
  await waitFor(() => replayReceived, 3000);

  const groupsAfterActive = await client.request("/api/v1/groups", { method: "GET" });
  const modeAfterActive = groupsAfterActive.body?.groups?.find((g) => g.id === groupId)?.mode;
  assert(modeAfterActive === "ACTIVE", "Group did not return to ACTIVE after reconnect.");

  wsA.close();
  wsB2.close();
  await prisma.$disconnect();

  console.log("Data plane relay test passed.");
};

main().catch((error) => {
  console.error("Data plane relay test failed.");
  console.error(error);
  void prisma.$disconnect();
  process.exit(1);
});
