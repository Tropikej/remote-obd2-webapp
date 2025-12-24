import fs from "fs/promises";
import os from "os";
import path from "path";

export type AgentConfig = {
  agentId?: string;
  agentToken?: string;
  wsUrl?: string;
  apiBaseUrl?: string;
  agentName?: string;
};

const CONFIG_FILE = "config.json";

const resolveConfigDir = () => {
  const override = process.env.BRIDGE_AGENT_CONFIG_DIR;
  if (override) {
    return override;
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      return path.join(appData, "obd2-dashboard-agent");
    }
  }

  return path.join(os.homedir(), ".config", "obd2-dashboard-agent");
};

const getConfigPath = () => path.join(resolveConfigDir(), CONFIG_FILE);

export const loadConfig = async (): Promise<AgentConfig> => {
  const filePath = getConfigPath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as AgentConfig;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {};
    }
    throw error;
  }
};

export const saveConfig = async (config: AgentConfig) => {
  const dir = resolveConfigDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = getConfigPath();
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
  return filePath;
};
