import type { AgentLoginPayload, AgentLoginResponse, AgentStatusPayload } from "../types";

declare global {
  interface Window {
    agentApi: {
      login: (payload: AgentLoginPayload) => Promise<AgentLoginResponse>;
      logout: () => Promise<void>;
      getStatus: () => Promise<AgentStatusPayload>;
      toggleDiscovery: (enabled: boolean) => Promise<void>;
      onStatus: (handler: (status: AgentStatusPayload) => void) => () => void;
    };
  }
}
