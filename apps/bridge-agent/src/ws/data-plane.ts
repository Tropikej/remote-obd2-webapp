import WebSocket from "ws";
import { DataPlaneCanMessage, CanRelayFrame } from "@dashboard/shared";

export type DataPlaneClient = {
  sendFrame: (payload: { groupId?: string; dongleId: string; frame: CanRelayFrame }) => void;
  onFrame: (handler: (payload: DataPlaneCanMessage) => void) => () => void;
  close: () => void;
  isOpen: () => boolean;
};

type Listener = (payload: DataPlaneCanMessage) => void;

const toWsUrl = (apiBaseUrl: string) => {
  return apiBaseUrl.replace(/^http/, "ws") + "/ws/data";
};

export const connectDataPlaneWs = (opts: {
  apiBaseUrl: string;
  agentId: string;
  agentToken: string;
}): DataPlaneClient => {
  const debug = process.env.BRIDGE_AGENT_DEBUG_DATA_PLANE === "1";
  const logDebug = (message: string) => {
    if (debug) {
      console.log(`[bridge-agent] data-plane ${message}`);
    }
  };
  const listeners: Listener[] = [];
  const wsUrl = toWsUrl(opts.apiBaseUrl);
  let socket: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectDelayMs = 1000;
  let stopped = false;

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) {
      return;
    }
    clearReconnect();
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(reconnectDelayMs, 30000) + jitter;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
    reconnectTimer = setTimeout(connect, delay);
  };

  const attachHandlers = (ws: WebSocket) => {
    ws.on("open", () => {
      logDebug(`connected to ${wsUrl}`);
    });

    ws.on("message", (raw) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const parsed = JSON.parse(text);
        if (parsed && parsed.type === "can_frame") {
          logDebug("received can_frame from server");
          listeners.forEach((l) => l(parsed as DataPlaneCanMessage));
        }
      } catch {
        // ignore malformed
      }
    });

    ws.on("close", () => {
      logDebug("connection closed");
      scheduleReconnect();
    });

    ws.on("error", () => {
      logDebug("connection error");
      scheduleReconnect();
    });
  };

  const connect = () => {
    if (stopped) {
      return;
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
      return;
    }
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${opts.agentToken}` },
    });
    socket = ws;
    reconnectDelayMs = 1000;
    attachHandlers(ws);
  };

  connect();

  const sendFrame = (payload: { groupId?: string; dongleId: string; frame: CanRelayFrame }) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      logDebug("send skipped (socket closed)");
      return;
    }
    const message: DataPlaneCanMessage = {
      type: "can_frame",
      dongle_id: payload.dongleId,
      ...(payload.groupId ? { group_id: payload.groupId } : {}),
      frame: payload.frame,
    };
    socket.send(JSON.stringify(message));
    logDebug("sent can_frame to server");
  };

  const onFrame = (handler: Listener) => {
    listeners.push(handler);
    return () => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) {
        listeners.splice(idx, 1);
      }
    };
  };

  const close = () => {
    stopped = true;
    clearReconnect();
    socket?.close();
    socket = null;
  };

  const isOpen = () => Boolean(socket && socket.readyState === WebSocket.OPEN);

  return {
    sendFrame,
    onFrame,
    close,
    isOpen,
  };
};
