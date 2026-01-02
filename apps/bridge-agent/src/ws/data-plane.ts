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
  const listeners: Listener[] = [];
  const wsUrl = toWsUrl(opts.apiBaseUrl);
  const socket = new WebSocket(wsUrl, {
    headers: { Authorization: `Bearer ${opts.agentToken}` },
  });

  socket.on("message", (raw) => {
    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      const parsed = JSON.parse(text);
      if (parsed && parsed.type === "can_frame") {
        listeners.forEach((l) => l(parsed as DataPlaneCanMessage));
      }
    } catch {
      // ignore malformed
    }
  });

  const sendFrame = (payload: { groupId?: string; dongleId: string; frame: CanRelayFrame }) => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const message: DataPlaneCanMessage = {
      type: "can_frame",
      dongle_id: payload.dongleId,
      ...(payload.groupId ? { group_id: payload.groupId } : {}),
      frame: payload.frame,
    };
    socket.send(JSON.stringify(message));
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
    socket.close();
  };

  const isOpen = () => socket.readyState === WebSocket.OPEN;

  return {
    sendFrame,
    onFrame,
    close,
    isOpen,
  };
};
