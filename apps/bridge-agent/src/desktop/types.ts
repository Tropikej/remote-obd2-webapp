import type { AgentStatus } from "../agent-core";

export type AgentLoginPayload = {
  email: string;
  password: string;
};

export type AgentLoginResponse = {
  ok: boolean;
  error?: string;
};

export type AgentStatusPayload = AgentStatus;
