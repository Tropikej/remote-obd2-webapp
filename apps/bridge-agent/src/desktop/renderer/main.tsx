import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import type { AgentStatusPayload } from "../types";
import "./style.css";

const ensureDevAgentApi = () => {
  if (!import.meta.env.DEV || window.agentApi) {
    return;
  }

  let status: AgentStatusPayload = {
    apiBaseUrl: "http://localhost:3000",
    dashboardWebUrl: "http://localhost:5173",
    recentApiBaseUrls: ["http://localhost:3000"],
    agentId: null,
    wsStatus: "closed",
    lastHeartbeatAt: null,
    discoveryEnabled: true,
    discoveryActive: false,
    discoveredDevices: [],
    needsLogin: true,
    lastError: null,
  };

  const listeners = new Set<(next: AgentStatusPayload) => void>();
  const emit = () => listeners.forEach((handler) => handler(status));
  const heartbeatIntervalMs = 30000;

  window.setInterval(() => {
    if (status.needsLogin) {
      return;
    }
    status = {
      ...status,
      lastHeartbeatAt: new Date().toISOString(),
    };
    emit();
  }, heartbeatIntervalMs);

  window.agentApi = {
    login: async ({ email, password }) => {
      if (!email || !password) {
        return { ok: false, error: "Missing credentials." };
      }
      status = {
        ...status,
        needsLogin: false,
        agentId: "dev-agent-001",
        wsStatus: "open",
        lastHeartbeatAt: new Date().toISOString(),
      };
      emit();
      return { ok: true };
    },
    logout: async () => {
      status = {
        ...status,
        needsLogin: true,
        agentId: null,
        wsStatus: "closed",
      };
      emit();
    },
    updateSettings: async ({ apiBaseUrl, dashboardWebUrl }) => {
      if (!apiBaseUrl) {
        return { ok: false, error: "API base URL is required." };
      }
      const nextDashboard = dashboardWebUrl?.trim() ? dashboardWebUrl : status.dashboardWebUrl;
      const apiChanged = apiBaseUrl !== status.apiBaseUrl;
      status = {
        ...status,
        apiBaseUrl,
        dashboardWebUrl: nextDashboard,
        recentApiBaseUrls: [
          apiBaseUrl,
          ...status.recentApiBaseUrls.filter((entry) => entry !== apiBaseUrl),
        ].slice(0, 5),
        ...(apiChanged
          ? {
              needsLogin: true,
              wsStatus: "closed",
              agentId: null,
              lastHeartbeatAt: null,
            }
          : {}),
      };
      emit();
      return { ok: true, status };
    },
    getStatus: async () => status,
    toggleDiscovery: async (enabled: boolean) => {
      status = {
        ...status,
        discoveryEnabled: enabled,
        discoveryActive: enabled,
      };
      emit();
    },
    onStatus: (handler) => {
      listeners.add(handler);
      handler(status);
      return () => listeners.delete(handler);
    },
  };
};

const root = document.getElementById("root");

if (root) {
  ensureDevAgentApi();
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
