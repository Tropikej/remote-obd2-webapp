import { contextBridge, ipcRenderer } from "electron";
import type { AgentLoginPayload, AgentLoginResponse, AgentStatusPayload } from "./types";

const api = {
  login: (payload: AgentLoginPayload): Promise<AgentLoginResponse> =>
    ipcRenderer.invoke("agent:login", payload),
  logout: (): Promise<void> => ipcRenderer.invoke("agent:logout"),
  getStatus: (): Promise<AgentStatusPayload> => ipcRenderer.invoke("agent:getStatus"),
  toggleDiscovery: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("agent:toggleDiscovery", enabled),
  onStatus: (handler: (status: AgentStatusPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AgentStatusPayload) => {
      handler(status);
    };
    ipcRenderer.on("agent:status", listener);
    return () => {
      ipcRenderer.removeListener("agent:status", listener);
    };
  },
};

contextBridge.exposeInMainWorld("agentApi", api);
