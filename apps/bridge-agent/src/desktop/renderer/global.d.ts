import type {
  AgentLoginPayload,
  AgentLoginResponse,
  AgentSettingsPayload,
  AgentSettingsResponse,
  AgentStatusPayload,
} from "../types";

declare global {
  interface Window {
    agentApi: {
      login: (payload: AgentLoginPayload) => Promise<AgentLoginResponse>;
      logout: () => Promise<void>;
      updateSettings: (payload: AgentSettingsPayload) => Promise<AgentSettingsResponse>;
      getStatus: () => Promise<AgentStatusPayload>;
      toggleDiscovery: (enabled: boolean) => Promise<void>;
      onStatus: (handler: (status: AgentStatusPayload) => void) => () => void;
    };
  }
}
