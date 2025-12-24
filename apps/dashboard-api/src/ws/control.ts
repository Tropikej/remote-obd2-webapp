import type { IncomingMessage } from "http";
import { createHash, randomUUID } from "crypto";
import WebSocket, { WebSocketServer } from "ws";
import { prisma } from "../db";

type AgentConnection = {
  agentId: string;
  socket: WebSocket;
};

type PendingRequest = {
  agentId: string;
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const connections = new Map<string, AgentConnection>();
const pendingRequests = new Map<string, PendingRequest>();
const REQUEST_TIMEOUT_MS = 10000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const extractBearer = (request: IncomingMessage) => {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
};

const parseMessage = (raw: WebSocket.RawData) => {
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

const resolvePending = (requestId: string, payload: unknown) => {
  const pending = pendingRequests.get(requestId);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  pending.resolve(payload);
};

const rejectPending = (requestId: string, error: Error) => {
  const pending = pendingRequests.get(requestId);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  pending.reject(error);
};

const rejectPendingForAgent = (agentId: string, reason: string) => {
  for (const [requestId, pending] of pendingRequests.entries()) {
    if (pending.agentId === agentId) {
      rejectPending(requestId, new Error(reason));
    }
  }
};

const touchAgent = async (agentId: string) => {
  await prisma.agent.update({
    where: { id: agentId },
    data: { lastSeenAt: new Date() },
  });
};

export const attachControlWs = (server: import("http").Server) => {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");
    if (url.pathname !== "/ws/agent") {
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
    void touchAgent(agentId);

    socket.on("message", (raw: WebSocket.RawData) => {
      const message = parseMessage(raw);
      if (!message || typeof message.type !== "string") {
        return;
      }
      if (typeof message.request_id === "string") {
        if (message.type.endsWith("_error")) {
          const errorMessage =
            typeof message.message === "string"
              ? message.message
              : "Agent reported an error.";
          rejectPending(message.request_id, new Error(errorMessage));
          void touchAgent(agentId);
          return;
        }
        resolvePending(message.request_id, message);
        void touchAgent(agentId);
        return;
      }
      if (
        message.type === "heartbeat" ||
        message.type === "ack" ||
        message.type === "command_response"
      ) {
        void touchAgent(agentId);
      }
    });

    socket.on("close", () => {
      const current = connections.get(agentId);
      if (current?.socket === socket) {
        connections.delete(agentId);
      }
      rejectPendingForAgent(agentId, "Agent control channel closed.");
    });

    socket.on("error", () => {
      const current = connections.get(agentId);
      if (current?.socket === socket) {
        connections.delete(agentId);
      }
      rejectPendingForAgent(agentId, "Agent control channel errored.");
    });
  });
};

export const sendControlMessage = (agentId: string, payload: unknown) => {
  const connection = connections.get(agentId);
  if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  connection.socket.send(JSON.stringify(payload));
  return true;
};

export const sendControlRequest = async <TResponse = unknown>(
  agentId: string,
  payload: Record<string, unknown>,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<TResponse> => {
  const connection = connections.get(agentId);
  if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
    throw new Error("Agent control channel is offline.");
  }

  const requestId = randomUUID();
  const message = { ...payload, request_id: requestId };

  return new Promise<TResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      rejectPending(requestId, new Error("Agent response timeout."));
    }, timeoutMs);

    pendingRequests.set(requestId, {
      agentId,
      resolve: resolve as (payload: unknown) => void,
      reject,
      timeout,
    });

    try {
      connection.socket.send(JSON.stringify(message));
    } catch (error) {
      rejectPending(requestId, error as Error);
    }
  });
};
