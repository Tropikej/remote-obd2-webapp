import { app, BrowserWindow, Menu, Tray, clipboard, ipcMain, nativeImage, shell } from "electron";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { createAgentController } from "../agent-core";
import type { AgentStatus } from "../agent-core";
import type {
  AgentLoginPayload,
  AgentLoginResponse,
  AgentSettingsPayload,
  AgentSettingsResponse,
} from "./types";
const devServerUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
const logFile = path.join(app.getPath("userData"), "agent-ui.log");

const logLine = (message: string) => {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  } catch (error) {
    // Ignore logging errors to avoid crashing the app.
  }
};

const trayIconBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAKUlEQVR4AWP4z8Dwn4GKgIGB4T8DA8MIM2iYIaQMA4b2DxMikxXwAAAAAElFTkSuQmCC";

const getTrayIcon = () => nativeImage.createFromDataURL(`data:image/png;base64,${trayIconBase64}`);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let currentStatus: AgentStatus | null = null;

const controller = createAgentController({ autoRegisterFromEnv: false });

const createWindow = () => {
  if (mainWindow) {
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 460,
    height: 620,
    show: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const targetUrl = devServerUrl
    ? devServerUrl
    : pathToFileURL(path.resolve(__dirname, "..", "renderer", "index.html")).toString();

  logLine(`loading renderer url=${targetUrl}`);
  void mainWindow.loadURL(targetUrl);

  mainWindow.webContents.on("did-finish-load", () => {
    logLine(`renderer loaded url=${mainWindow?.webContents.getURL()}`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    logLine(`renderer failed code=${code} description=${description} url=${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logLine(`renderer gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
};

const showWindow = () => {
  const win = createWindow();
  win.show();
  win.focus();
};

const updateTrayMenu = () => {
  if (!tray) {
    return;
  }
  const status = currentStatus || controller.getStatus();
  const isVisible = mainWindow?.isVisible() ?? false;
  const connectionLabel = status.wsStatus === "open" ? "Connected" : "Disconnected";
  const menu = Menu.buildFromTemplate([
    { label: `OBD2 Agent (${connectionLabel})`, enabled: false },
    { type: "separator" },
    {
      label: isVisible ? "Hide Agent Window" : "Open Agent Window",
      click: () => (isVisible ? mainWindow?.hide() : showWindow()),
    },
    {
      label: "Open Dashboard",
      click: () => void shell.openExternal(status.dashboardWebUrl || "http://localhost:5173"),
    },
    {
      label: "Copy Agent ID",
      enabled: Boolean(status.agentId),
      click: () => {
        if (status.agentId) {
          clipboard.writeText(status.agentId);
        }
      },
    },
    { type: "separator" },
    {
      label: "Discovery: On",
      type: "checkbox",
      checked: status.discoveryEnabled,
      click: (item) => controller.setDiscoveryEnabled(item.checked),
    },
    {
      label: "Reset Login",
      click: () => void controller.logout(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: async () => {
        isQuitting = true;
        await controller.stop();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip("OBD2 Bridge Agent");
};

const broadcastStatus = (status: AgentStatus) => {
  currentStatus = status;
  updateTrayMenu();
  if (mainWindow) {
    mainWindow.webContents.send("agent:status", status);
    if (status.needsLogin && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }
};

const registerIpcHandlers = () => {
  ipcMain.handle("agent:getStatus", () => controller.getStatus());
  ipcMain.handle(
    "agent:login",
    async (_event, payload: AgentLoginPayload): Promise<AgentLoginResponse> => {
      try {
        await controller.login(payload);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }
  );
  ipcMain.handle(
    "agent:updateSettings",
    async (_event, payload: AgentSettingsPayload): Promise<AgentSettingsResponse> => {
      try {
        await controller.updateSettings(payload);
        return { ok: true, status: controller.getStatus() };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }
  );
  ipcMain.handle("agent:logout", async () => {
    await controller.logout();
  });
  ipcMain.handle("agent:toggleDiscovery", async (_event, enabled: boolean) => {
    controller.setDiscoveryEnabled(Boolean(enabled));
  });
};

app.on("before-quit", () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  controller.on("status", (status) => broadcastStatus(status));
  await controller.start();

  createWindow();
  tray = new Tray(getTrayIcon());
  tray.on("click", () => showWindow());
  updateTrayMenu();
  registerIpcHandlers();
});

app.on("activate", () => {
  showWindow();
});

app.on("window-all-closed", (event: Electron.Event) => {
  event.preventDefault();
});
