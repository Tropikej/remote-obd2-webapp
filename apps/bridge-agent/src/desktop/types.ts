import type { AgentStatus } from "../agent-core";

export type AgentLoginPayload = {
  email: string;
  password: string;
};

export type AgentLoginResponse = {
  ok: boolean;
  error?: string;
};

export type AgentSettingsPayload = {
  apiBaseUrl: string;
  dashboardWebUrl?: string;
};

export type AgentSettingsResponse = {
  ok: boolean;
  status?: AgentStatusPayload;
  error?: string;
};

export type AgentStatusPayload = AgentStatus;
