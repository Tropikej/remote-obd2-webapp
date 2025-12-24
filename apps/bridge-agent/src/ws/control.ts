import { EventEmitter } from "events";
import WebSocket from "ws";

export type ControlConnectionStatus = "connecting" | "open" | "closed";

export type ControlWsOptions = {
  wsUrl: string;
  agentToken: string;
  agentId: string;
  heartbeatIntervalMs?: number;
  reconnectMinDelayMs?: number;
  reconnectMaxDelayMs?: number;
};

export type ControlConnection = EventEmitter & {
  send: (payload: unknown) => void;
  close: () => void;
};

export const connectControlWs = (options: ControlWsOptions): ControlConnection => {
  const emitter = new EventEmitter() as ControlConnection;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
  const reconnectMinDelayMs = options.reconnectMinDelayMs ?? 1000;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30000;

  let socket: WebSocket | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectDelayMs = reconnectMinDelayMs;
  let stopped = false;

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) {
      return;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(reconnectDelayMs, reconnectMaxDelayMs) + jitter;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, reconnectMaxDelayMs);
    reconnectTimer = setTimeout(connect, delay);
  };

  const connect = () => {
    if (stopped) {
      return;
    }
    emitter.emit("status", "connecting" as ControlConnectionStatus);
    socket = new WebSocket(options.wsUrl, {
      headers: {
        Authorization: `Bearer ${options.agentToken}`,
      },
    });

    socket.on("open", () => {
      reconnectDelayMs = reconnectMinDelayMs;
      emitter.emit("status", "open" as ControlConnectionStatus);
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        emitter.send({
          type: "heartbeat",
          agent_id: options.agentId,
          ts: new Date().toISOString(),
        });
      }, heartbeatIntervalMs);
    });

    socket.on("message", (data) => {
      const message = typeof data === "string" ? data : data.toString("utf8");
      emitter.emit("message", message);
    });

    socket.on("close", () => {
      emitter.emit("status", "closed" as ControlConnectionStatus);
      stopHeartbeat();
      scheduleReconnect();
    });

    socket.on("error", (error) => {
      emitter.emit("error", error);
    });
  };

  emitter.send = (payload: unknown) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  };

  emitter.close = () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopHeartbeat();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  };

  connect();
  return emitter;
};
