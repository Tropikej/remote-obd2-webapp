import type { IncomingMessage } from "http";
import { createHash } from "crypto";
import WebSocket, { WebSocketServer } from "ws";
import { prisma } from "../db";
import { getRedis } from "../redis/client";
import { DataPlaneCanMessage } from "@dashboard/shared";
import { markGroupMode } from "../services/groups";
import { streamManager } from "../services/streams";

type AgentConnection = {
  agentId: string;
  socket: WebSocket;
};

const connections = new Map<string, AgentConnection>();
const redis = getRedis();
const STREAM_MAX_LEN = 200000;
const DONGLE_TOUCH_INTERVAL_MS = 30000;
const lastDongleTouch = new Map<string, number>();
const debug = process.env.DASHBOARD_DEBUG_DATA_PLANE === "1";

const logDebug = (message: string) => {
  if (debug) {
    console.log(`[data-plane] ${message}`);
  }
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const extractBearer = (request: IncomingMessage) => {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
};

const isAgentConnected = (agentId?: string | null) => {
  if (!agentId) {
    return false;
  }
  const conn = connections.get(agentId);
  return Boolean(conn && conn.socket.readyState === WebSocket.OPEN);
};

const bufferFrame = async (groupId: string, direction: "a_to_b" | "b_to_a", payload: any) => {
  const key = `group:${groupId}:${direction}`;
  await redis.xadd(key, "MAXLEN", "~", STREAM_MAX_LEN, "*", "payload", JSON.stringify(payload));
};

const loadGroupsForAgent = async (agentId: string) => {
  const groups = await prisma.dongleGroup.findMany({
    where: {
      OR: [
        { dongleA: { lastSeenAgentId: agentId } },
        { dongleB: { lastSeenAgentId: agentId } },
      ],
    },
    include: {
      dongleA: true,
      dongleB: true,
    },
  });
  return groups;
};

const replayBufferedFrames = async (agentId: string, socket: WebSocket) => {
  const groups = await loadGroupsForAgent(agentId);
  for (const group of groups) {
    if (group.mode === "INACTIVE") {
      continue;
    }
    const isA = group.dongleA.lastSeenAgentId === agentId;
    const key = isA ? `group:${group.id}:b_to_a` : `group:${group.id}:a_to_b`;
    const entries = await redis.xrange(key, "-", "+");
    for (const entry of entries) {
      const payloadField = entry[1]?.find((item, idx) => idx % 2 === 0 && item === "payload");
      const valueField = entry[1]?.find((item, idx) => idx % 2 === 1 && entry[1][idx - 1] === "payload");
      if (payloadField && typeof valueField === "string") {
        try {
          const parsed = JSON.parse(valueField);
          socket.send(JSON.stringify(parsed));
        } catch {
          // ignore malformed
        }
      }
    }
    if (entries.length > 0) {
      await redis.del(key);
    }
  }
};

const updateGroupModesForAgent = async (agentId: string) => {
  const groups = await loadGroupsForAgent(agentId);
  for (const group of groups) {
    if (group.mode === "INACTIVE") {
      continue;
    }
    const aConnected = isAgentConnected(group.dongleA.lastSeenAgentId);
    const bConnected = isAgentConnected(group.dongleB.lastSeenAgentId);
    const desired = aConnected && bConnected ? "ACTIVE" : "DEGRADED";
    const offlineSide =
      desired === "DEGRADED"
        ? !aConnected && bConnected
          ? "A"
          : aConnected && !bConnected
            ? "B"
            : null
        : null;
    await markGroupMode(group.id, desired, { offlineSide });
  }
};

const sendToAgent = (agentId: string, payload: any) => {
  const connection = connections.get(agentId);
  if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  connection.socket.send(JSON.stringify(payload));
  return true;
};

const touchDongle = async (dongleId: string, agentId: string) => {
  const now = Date.now();
  const lastTouch = lastDongleTouch.get(dongleId);
  if (lastTouch && now - lastTouch < DONGLE_TOUCH_INTERVAL_MS) {
    return;
  }
  lastDongleTouch.set(dongleId, now);
  await prisma.dongle.updateMany({
    where: { id: dongleId },
    data: { lastSeenAt: new Date(now), lastSeenAgentId: agentId },
  });
};

const handleCanFrame = async (agentId: string, message: DataPlaneCanMessage) => {
  if (!message.dongle_id) {
    return;
  }

  await touchDongle(message.dongle_id, agentId);

  const tsIso = message.frame.ts || new Date().toISOString();
  const group = message.group_id
    ? await prisma.dongleGroup.findUnique({
        where: { id: message.group_id },
        include: { dongleA: true, dongleB: true },
      })
    : null;
  let direction: "a_to_b" | "b_to_a" | null = null;

  if (group && group.mode !== "INACTIVE") {
    direction =
      message.dongle_id === group.dongleAId
        ? "a_to_b"
        : message.dongle_id === group.dongleBId
          ? "b_to_a"
          : null;
    if (
      direction &&
      ((direction === "a_to_b" && group.dongleA.lastSeenAgentId !== agentId) ||
        (direction === "b_to_a" && group.dongleB.lastSeenAgentId !== agentId))
    ) {
      direction = null;
    }
  }

  const dongleDirection =
    direction === "a_to_b"
      ? "tx"
      : direction === "b_to_a"
        ? "rx"
        : message.frame.direction ?? "rx";

  streamManager.publish(`dongle:${message.dongle_id}`, "can_frame", {
    type: "can_frame",
    group_id: message.group_id,
    dongle_id: message.dongle_id,
    direction: dongleDirection,
    bus: message.frame.bus,
    id: message.frame.can_id,
    can_id: message.frame.can_id,
    is_extended: message.frame.is_extended,
    dlc: message.frame.dlc,
    data_hex: message.frame.data_hex,
    ts: tsIso,
  });

  if (!direction || !group || group.mode === "INACTIVE") {
    return;
  }
  const groupId = message.group_id;
  if (!groupId) {
    return;
  }

  const targetDongleId = direction === "a_to_b" ? group.dongleBId : group.dongleAId;
  const targetAgentId =
    direction === "a_to_b" ? group.dongleB.lastSeenAgentId : group.dongleA.lastSeenAgentId;
  const relayPayload: {
    type: "can_frame";
    group_id: string;
    dongle_id: string;
    target_dongle_id: string;
    direction: "a_to_b" | "b_to_a";
    frame: DataPlaneCanMessage["frame"] & { ts: string };
  } = {
    type: "can_frame",
    group_id: groupId,
    dongle_id: message.dongle_id,
    target_dongle_id: targetDongleId,
    direction,
    frame: {
      ...message.frame,
      ts: tsIso,
    },
  };

  streamManager.publish(`group:${relayPayload.group_id}`, "can_frame", {
    type: "can_frame",
    group_id: relayPayload.group_id,
    dongle_id: relayPayload.dongle_id,
    direction: relayPayload.direction,
    bus: relayPayload.frame.bus,
    id: relayPayload.frame.can_id,
    can_id: relayPayload.frame.can_id,
    is_extended: relayPayload.frame.is_extended,
    dlc: relayPayload.frame.dlc,
    data_hex: relayPayload.frame.data_hex,
    ts: tsIso,
  });

  const delivered = targetAgentId ? sendToAgent(targetAgentId, relayPayload) : false;
  if (!delivered) {
    await bufferFrame(groupId, direction, relayPayload);
    await markGroupMode(group.id, "DEGRADED", {
      offlineSide: direction === "a_to_b" ? "B" : "A",
    });
  } else {
    await markGroupMode(group.id, "ACTIVE", { offlineSide: null });
  }
};

const parseMessage = (raw: WebSocket.RawData) => {
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const attachDataPlaneWs = (server: import("http").Server) => {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");
    if (url.pathname !== "/ws/data") {
      return;
    }

    void (async () => {
      try {
        const token = extractBearer(request);
        if (!token) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        const tokenHash = hashToken(token);
        const record = await prisma.agentToken.findFirst({
          where: { tokenHash, revokedAt: null },
          include: { agent: true },
        });
        if (!record) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request, record.agent.id);
        });
      } catch (error) {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      }
    })();
  });

  wss.on("connection", (socket: WebSocket, _request: IncomingMessage, agentId: string) => {
    const existing = connections.get(agentId);
    if (existing && existing.socket.readyState === WebSocket.OPEN) {
      existing.socket.close(1000, "Replaced by new connection");
    }
    connections.set(agentId, { agentId, socket });
    logDebug(`agent connected ${agentId}`);

    void replayBufferedFrames(agentId, socket);
    void updateGroupModesForAgent(agentId);

    socket.on("message", (raw: WebSocket.RawData) => {
      const message = parseMessage(raw);
      if (!message || typeof message.type !== "string") {
        return;
      }
      if (message.type === "can_frame") {
        logDebug(
          `can_frame from agent=${agentId} dongle=${(message as DataPlaneCanMessage).dongle_id}`
        );
        void handleCanFrame(agentId, message as DataPlaneCanMessage);
      }
    });

    socket.on("close", () => {
      const current = connections.get(agentId);
      if (current?.socket === socket) {
        connections.delete(agentId);
      }
      logDebug(`agent disconnected ${agentId}`);
      void updateGroupModesForAgent(agentId);
      void publishAgentOffline(agentId);
    });

    socket.on("error", () => {
      const current = connections.get(agentId);
      if (current?.socket === socket) {
        connections.delete(agentId);
      }
      logDebug(`agent error ${agentId}`);
      void updateGroupModesForAgent(agentId);
      void publishAgentOffline(agentId);
    });
  });
};

const publishAgentOffline = async (agentId: string) => {
  const dongles = await prisma.dongle.findMany({
    where: { lastSeenAgentId: agentId },
    select: { id: true },
  });
  const ts = new Date().toISOString();
  for (const d of dongles) {
    streamManager.publish(`dongle:${d.id}`, "presence", {
      type: "presence",
      dongle_id: d.id,
      online: false,
      agent_id: agentId,
      seen_at: ts,
    });
  }
};
