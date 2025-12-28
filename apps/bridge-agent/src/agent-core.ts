import { EventEmitter } from "events";
import os from "os";
import type { CanConfigApplyRequest } from "@dashboard/shared/protocols/can-config";
import {
  AgentRegistration,
  DeviceReport,
  NetworkInterfaceSummary,
  ReportedDeviceRecord,
  isAuthError,
  registerAgent,
  reportDevices,
  sendHeartbeat,
} from "./api/client";
import { AgentConfig, loadConfig, saveConfig } from "./config/store";
import { DiscoveryEvent, DiscoveryScanner, startDiscovery } from "./discovery";
import { applyCanConfigToDongle } from "./remp/can-config";
import { startPairingMode, submitPairing } from "./remp/pairing";
import { ControlConnection, ControlConnectionStatus, connectControlWs } from "./ws/control";
import { connectDataPlaneWs, type DataPlaneClient } from "./ws/data-plane";

const DEBUG_DISCOVERY = process.env.BRIDGE_AGENT_DEBUG_DISCOVERY === "1";

type AgentState = {
  agentId?: string;
  agentToken?: string;
  wsUrl?: string;
};

export type AgentStatus = {
  apiBaseUrl: string;
  agentId: string | null;
  wsStatus: ControlConnectionStatus;
  lastHeartbeatAt: string | null;
  discoveryEnabled: boolean;
  discoveryActive: boolean;
  discoveredDevices: DiscoveryDeviceStatus[];
  needsLogin: boolean;
  lastError: string | null;
};

export type DiscoveryDeviceStatus = {
  deviceId: string;
  lanIp?: string | null;
  udpPort?: number;
  fwBuild?: string | null;
  ownershipState?: string | null;
  pairingState?: number | null;
  lastSeenAt: string;
};

export type AgentOptions = {
  apiBaseUrl?: string;
  agentName?: string;
  version?: string;
  discoveryPort?: number;
  discoveryIntervalMs?: number;
  reportIntervalMs?: number;
  heartbeatIntervalMs?: number;
  autoRegisterFromEnv?: boolean;
};

export type AgentLoginPayload = {
  email: string;
  password: string;
};

export type AgentController = EventEmitter & {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  login: (payload: AgentLoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  setDiscoveryEnabled: (enabled: boolean) => void;
  getStatus: () => AgentStatus;
};

type DeviceSnapshot = {
  report: DeviceReport;
  signature: string;
  lastSeenAt: number;
  ownershipState?: string | null;
  ownerUserId?: string | null;
};

type CanConfigApplyMessage = {
  type: "can_config_apply";
  request_id: string;
  dongle_id: string;
  config: CanConfigApplyRequest;
};

type PairingModeStartMessage = {
  type: "pairing_mode_start";
  request_id: string;
  dongle_id: string;
  lan_ip?: string;
  udp_port?: number;
};

type PairingSubmitMessage = {
  type: "pairing_submit";
  request_id: string;
  dongle_id: string;
  pin: string;
  pairing_nonce?: string;
  dongle_token: string;
  lan_ip?: string;
  udp_port?: number;
};

const buildNetworkInterfacesSummary = (): NetworkInterfaceSummary[] => {
  const interfaces = os.networkInterfaces();
  const summary: NetworkInterfaceSummary[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries || entries.length === 0) {
      continue;
    }
    const addresses: NetworkInterfaceSummary["addresses"] = [];
    for (const entry of entries as os.NetworkInterfaceInfo[]) {
      if (!entry || entry.internal || !entry.address) {
        continue;
      }
      addresses.push({
        address: entry.address,
        family: entry.family,
        netmask: entry.netmask || undefined,
      });
    }
    if (addresses.length > 0) {
      summary.push({ name, addresses });
    }
  }
  return summary;
};

const parseControlMessage = (raw: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    return null;
  }
};

const isCanConfigApplyMessage = (message: Record<string, unknown>): message is CanConfigApplyMessage =>
  message.type === "can_config_apply" &&
  typeof message.request_id === "string" &&
  typeof message.dongle_id === "string" &&
  typeof message.config === "object" &&
  message.config !== null;

const isPairingModeStartMessage = (
  message: Record<string, unknown>
): message is PairingModeStartMessage =>
  message.type === "pairing_mode_start" &&
  typeof message.request_id === "string" &&
  typeof message.dongle_id === "string";

const isPairingSubmitMessage = (message: Record<string, unknown>): message is PairingSubmitMessage =>
  message.type === "pairing_submit" &&
  typeof message.request_id === "string" &&
  typeof message.dongle_id === "string" &&
  typeof message.pin === "string" &&
  typeof message.dongle_token === "string";

const parseNumber = (value: number | undefined, fallback: number) => {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const buildDeviceReport = (event: DiscoveryEvent): DeviceReport | null => {
  const deviceId = event.payload.deviceId?.toLowerCase();
  if (!deviceId) {
    return null;
  }

  const report: DeviceReport = {
    device_id: deviceId,
    lan_ip: event.payload.lanIp || event.sourceIp,
  };

  if (event.payload.fwBuild) {
    report.fw_build = event.payload.fwBuild;
  }
  if (event.payload.udpPort !== undefined) {
    report.udp_port = event.payload.udpPort;
  }
  if (event.payload.capabilities !== undefined) {
    report.capabilities = event.payload.capabilities;
  }
  if (event.payload.protoVer !== undefined) {
    report.proto_ver = event.payload.protoVer;
  }
  if (event.payload.pairingState !== undefined) {
    report.pairing_state = event.payload.pairingState;
  }
  if (event.payload.pairingNonce) {
    report.pairing_nonce = event.payload.pairingNonce;
  }

  return report;
};

export const createAgentController = (options: AgentOptions = {}): AgentController => {
  const emitter = new EventEmitter() as AgentController;

  const envBaseUrl = process.env.API_BASE_URL;
  const envAgentName = process.env.BRIDGE_AGENT_NAME;
  const envVersion = process.env.BRIDGE_AGENT_VERSION || process.env.npm_package_version;
  const envDiscoveryPort = process.env.BRIDGE_AGENT_DISCOVERY_PORT
    ? Number(process.env.BRIDGE_AGENT_DISCOVERY_PORT)
    : undefined;
  const envDiscoveryInterval = process.env.BRIDGE_AGENT_DISCOVERY_INTERVAL_MS
    ? Number(process.env.BRIDGE_AGENT_DISCOVERY_INTERVAL_MS)
    : undefined;
  const envReportInterval = process.env.BRIDGE_AGENT_REPORT_INTERVAL_MS
    ? Number(process.env.BRIDGE_AGENT_REPORT_INTERVAL_MS)
    : undefined;
  const envHeartbeatInterval = process.env.BRIDGE_AGENT_HEARTBEAT_INTERVAL_MS
    ? Number(process.env.BRIDGE_AGENT_HEARTBEAT_INTERVAL_MS)
    : undefined;

  let config: AgentConfig = {};
  let agentName = options.agentName || envAgentName || os.hostname();
  let apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl || envBaseUrl || "http://localhost:3000");
  let agentVersion = options.version || envVersion || "0.0.0";

  let state: AgentState = {};
  let status: AgentStatus = {
    apiBaseUrl,
    agentId: null,
    wsStatus: "closed",
    lastHeartbeatAt: null,
    discoveryEnabled: true,
    discoveryActive: false,
    discoveredDevices: [],
    needsLogin: true,
    lastError: null,
  };

  let control: ControlConnection | null = null;
  let dataPlane: DataPlaneClient | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reportTimer: NodeJS.Timeout | null = null;
  let discovery: DiscoveryScanner | null = null;
  let discoveryEnabled = true;
  let registrationInFlight = false;
  let running = false;

  const devices = new Map<string, DeviceSnapshot>();
  const deviceInterfaces = new Map<string, Set<string>>();
  let dirty = false;
  let reporting = false;

  const findTargetForDongle = (
    dongleId: string,
    hintedIp?: string,
    hintedPort?: number
  ): { host: string; port: number } | null => {
    const snapshot = devices.get(dongleId);
    const host = hintedIp || snapshot?.report.lan_ip;
    const port = hintedPort || snapshot?.report.udp_port;
    if (!host || !port) {
      return null;
    }
    return { host, port };
  };

  const discoveryPort = parseNumber(
    options.discoveryPort ?? envDiscoveryPort,
    50000
  );
  const discoveryIntervalMs = parseNumber(
    options.discoveryIntervalMs ?? envDiscoveryInterval,
    15000
  );
  const reportIntervalMs = parseNumber(options.reportIntervalMs ?? envReportInterval, 10000);
  const heartbeatIntervalMs = parseNumber(
    options.heartbeatIntervalMs ?? envHeartbeatInterval,
    30000
  );
  const autoRegisterFromEnv = options.autoRegisterFromEnv ?? false;
  const envCredentials = {
    email: process.env.AGENT_USER_EMAIL || "",
    password: process.env.AGENT_USER_PASSWORD || "",
  };

  const setStatus = (patch: Partial<AgentStatus>) => {
    status = { ...status, ...patch };
    emitter.emit("status", status);
  };

  const buildDiscoveryStatus = (): DiscoveryDeviceStatus[] =>
    Array.from(devices.values())
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((entry) => ({
        deviceId: entry.report.device_id,
        lanIp: entry.report.lan_ip ?? null,
        udpPort: entry.report.udp_port,
        fwBuild: entry.report.fw_build ?? null,
        ownershipState: entry.ownershipState ?? null,
        pairingState: entry.report.pairing_state ?? null,
        lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
      }));

  const updateDiscoveryStatus = () => {
    setStatus({ discoveredDevices: buildDiscoveryStatus() });
  };

  const persistConfig = async () => {
    await saveConfig({
      ...config,
      apiBaseUrl,
      agentName,
      agentId: state.agentId,
      agentToken: state.agentToken,
      wsUrl: state.wsUrl,
    });
  };

  const stopControl = () => {
    if (control) {
      control.close();
      control = null;
    }
    setStatus({ wsStatus: "closed" });
  };

  const stopDataPlane = () => {
    if (dataPlane) {
      dataPlane.close();
      dataPlane = null;
    }
  };

  const connectControl = () => {
    if (!state.agentId || !state.agentToken || !state.wsUrl) {
      return;
    }
    stopControl();
    control = connectControlWs({
      wsUrl: state.wsUrl,
      agentToken: state.agentToken,
      agentId: state.agentId,
      heartbeatIntervalMs,
    });
    control.on("status", (wsStatus) => {
      setStatus({ wsStatus });
    });
    control.on("error", (error) => {
      setStatus({ lastError: (error as Error).message });
    });
    control.on("message", async (rawMessage: string) => {
      const message = parseControlMessage(rawMessage);
      if (!message) {
        return;
      }
      if (isCanConfigApplyMessage(message)) {
        try {
          const { effective } = await applyCanConfigToDongle(
            message.dongle_id,
            message.config
          );
          control?.send({
            type: "can_config_ack",
            request_id: message.request_id,
            dongle_id: message.dongle_id,
            effective,
            applied_at: new Date().toISOString(),
          });
        } catch (error) {
          control?.send({
            type: "can_config_error",
            request_id: message.request_id,
            message: (error as Error).message,
          });
        }
        return;
      }
      if (isPairingModeStartMessage(message)) {
        try {
          const target = findTargetForDongle(
            message.dongle_id,
            message.lan_ip,
            message.udp_port
          );
          if (!target) {
            throw new Error("Missing LAN IP or UDP port for dongle.");
          }
          const result = await startPairingMode(target, message.dongle_id);
          control?.send({
            type: "pairing_mode_started",
            request_id: message.request_id,
            dongle_id: message.dongle_id,
            expires_at: result.expires_at,
          });
        } catch (error) {
          control?.send({
            type: "pairing_error",
            request_id: message.request_id,
            message: (error as Error).message,
          });
        }
        return;
      }
      if (isPairingSubmitMessage(message)) {
        try {
          const target = findTargetForDongle(
            message.dongle_id,
            message.lan_ip,
            message.udp_port
          );
          if (!target) {
            throw new Error("Missing LAN IP or UDP port for dongle.");
          }
          const result = await submitPairing(
            target,
            message.dongle_id,
            message.pin,
            typeof message.pairing_nonce === "string" ? message.pairing_nonce : undefined,
            message.dongle_token
          );
          control?.send({
            type: "pairing_result",
            request_id: message.request_id,
            dongle_id: message.dongle_id,
            status: result.status,
          });
        } catch (error) {
          control?.send({
            type: "pairing_error",
            request_id: message.request_id,
            message: (error as Error).message,
          });
        }
      }
    });
  };

  const connectDataPlane = () => {
    if (!state.agentId || !state.agentToken) {
      return;
    }
    stopDataPlane();
    dataPlane = connectDataPlaneWs({
      apiBaseUrl,
      agentId: state.agentId,
      agentToken: state.agentToken,
    });
  };

  const stopDiscovery = async () => {
    if (discovery) {
      await discovery.stop();
      discovery = null;
    }
    setStatus({ discoveryActive: false });
  };

  const startDiscoveryScanner = () => {
    if (discovery) {
      return;
    }
    discovery = startDiscovery({
      port: discoveryPort,
      intervalMs: discoveryIntervalMs,
    });
    discovery.on("dongleDiscovered", (event: DiscoveryEvent) => {
      const report = buildDeviceReport(event);
      if (!report) {
        return;
      }
      if (DEBUG_DISCOVERY) {
        console.log(
          `[bridge-agent] discovery event device=${report.device_id} ip=${report.lan_ip ?? "-"} udp=${report.udp_port ?? "-"}`
        );
      }
      const signature = JSON.stringify(report);
      const interfaceName = event.interfaceInfo?.name ?? "unknown";
      const existing = devices.get(report.device_id);
      const interfaces = deviceInterfaces.get(report.device_id) ?? new Set<string>();
      if (!interfaces.has(interfaceName) && interfaces.size > 0) {
        console.debug(
          `[bridge-agent] device ${report.device_id} seen on ${interfaceName} (previous: ${Array.from(
            interfaces
          ).join(", ")})`
        );
      }
      interfaces.add(interfaceName);
      deviceInterfaces.set(report.device_id, interfaces);
      if (!existing || existing.signature !== signature) {
        dirty = true;
      }
      devices.set(report.device_id, {
        report,
        signature,
        lastSeenAt: Date.now(),
      });
      updateDiscoveryStatus();
    });
    setStatus({ discoveryActive: true });
  };

  const syncDiscovery = () => {
    if (!discoveryEnabled) {
      void stopDiscovery();
      return;
    }
    startDiscoveryScanner();
  };

  const reportNow = async () => {
    if (!state.agentToken || reporting || !dirty) {
      return;
    }
    reporting = true;
    try {
      const payload = Array.from(devices.values()).map((entry) => entry.report);
      if (payload.length === 0) {
        dirty = false;
        return;
      }
      if (DEBUG_DISCOVERY) {
        console.log(`[bridge-agent] reporting ${payload.length} discovery device(s)`);
      }
      const response = await reportDevices({
        apiBaseUrl,
        agentToken: state.agentToken,
        devices: payload,
      });
      if (response?.devices?.length) {
        for (const record of response.devices) {
          const deviceId = record.device_id?.toLowerCase();
          if (!deviceId) {
            continue;
          }
          const snapshot = devices.get(deviceId);
          if (!snapshot) {
            continue;
          }
          snapshot.ownershipState = record.ownership_state ?? snapshot.ownershipState ?? null;
          snapshot.ownerUserId = record.owner_user_id ?? snapshot.ownerUserId ?? null;
        }
        updateDiscoveryStatus();
      }
      dirty = false;
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthFailure("device report unauthorized");
      } else {
        setStatus({ lastError: (error as Error).message });
      }
    } finally {
      reporting = false;
    }
  };

  const sendHeartbeatNow = async () => {
    if (!state.agentToken) {
      return;
    }
    try {
      await sendHeartbeat({
        apiBaseUrl,
        agentToken: state.agentToken,
        hostname: os.hostname(),
        os: os.platform(),
        version: agentVersion,
        agentName,
        networkInterfaces: buildNetworkInterfacesSummary(),
      });
      setStatus({ lastHeartbeatAt: new Date().toISOString(), needsLogin: false });
    } catch (error) {
      if (isAuthError(error)) {
        await handleAuthFailure("heartbeat unauthorized");
      } else {
        setStatus({ lastError: (error as Error).message });
      }
    }
  };

  const startTimers = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    heartbeatTimer = setInterval(async () => {
      await sendHeartbeatNow();
    }, heartbeatIntervalMs);

    if (reportTimer) {
      clearInterval(reportTimer);
    }
    reportTimer = setInterval(reportNow, reportIntervalMs);
  };

  const stopTimers = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (reportTimer) {
      clearInterval(reportTimer);
      reportTimer = null;
    }
  };

  const applyRegistration = async (registration: AgentRegistration) => {
    state = {
      agentId: registration.agentId,
      agentToken: registration.agentToken,
      wsUrl: registration.wsUrl,
    };
    setStatus({
      agentId: registration.agentId,
      needsLogin: false,
      lastError: null,
    });
    await persistConfig();
    connectControl();
    connectDataPlane();
    syncDiscovery();
    startTimers();
    await sendHeartbeatNow();
  };

  const clearCredentials = async () => {
    state = {};
    devices.clear();
    deviceInterfaces.clear();
    setStatus({
      agentId: null,
      wsStatus: "closed",
      lastHeartbeatAt: null,
      needsLogin: true,
      discoveredDevices: [],
    });
    await persistConfig();
    stopControl();
    stopDataPlane();
    stopTimers();
    await stopDiscovery();
  };

  const registerWithCredentials = async (payload: AgentLoginPayload) => {
    const registration = await registerAgent({
      apiBaseUrl,
      userEmail: payload.email,
      userPassword: payload.password,
      hostname: os.hostname(),
      os: os.platform(),
      version: agentVersion,
      agentName,
      networkInterfaces: buildNetworkInterfacesSummary(),
    });
    await applyRegistration(registration);
  };

  const handleAuthFailure = async (reason: string) => {
    setStatus({ lastError: reason });
    await clearCredentials();
    if (autoRegisterFromEnv && envCredentials.email && envCredentials.password) {
      await registerWithCredentials(envCredentials);
    }
  };

  emitter.start = async () => {
    if (running) {
      return;
    }
    running = true;
    config = await loadConfig();
    apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl || envBaseUrl || config.apiBaseUrl || apiBaseUrl);
    agentName = options.agentName || envAgentName || config.agentName || agentName;
    agentVersion = options.version || envVersion || agentVersion;
    state = {
      agentId: config.agentId,
      agentToken: config.agentToken,
      wsUrl: config.wsUrl,
    };
    discoveryEnabled = true;
    setStatus({
      apiBaseUrl,
      agentId: state.agentId ?? null,
      needsLogin: !state.agentToken,
      discoveryEnabled,
      lastError: null,
    });

    if (state.agentToken) {
      try {
        await sendHeartbeat({
          apiBaseUrl,
          agentToken: state.agentToken,
          hostname: os.hostname(),
          os: os.platform(),
          version: agentVersion,
          agentName,
          networkInterfaces: buildNetworkInterfacesSummary(),
        });
        setStatus({ lastHeartbeatAt: new Date().toISOString(), needsLogin: false });
        connectControl();
        connectDataPlane();
        syncDiscovery();
        startTimers();
      } catch (error) {
        if (isAuthError(error)) {
          await handleAuthFailure("stored token rejected");
        } else {
          setStatus({ lastError: (error as Error).message });
        }
      }
    } else if (autoRegisterFromEnv && envCredentials.email && envCredentials.password) {
      await registerWithCredentials(envCredentials);
    }
  };

  emitter.stop = async () => {
    running = false;
    stopTimers();
    stopControl();
    stopDataPlane();
    await stopDiscovery();
  };

  emitter.login = async (payload: AgentLoginPayload) => {
    if (registrationInFlight) {
      return;
    }
    registrationInFlight = true;
    try {
      await registerWithCredentials(payload);
    } finally {
      registrationInFlight = false;
    }
  };

  emitter.logout = async () => {
    await clearCredentials();
  };

  emitter.setDiscoveryEnabled = (enabled: boolean) => {
    discoveryEnabled = enabled;
    setStatus({ discoveryEnabled });
    syncDiscovery();
  };

  emitter.getStatus = () => status;

  return emitter;
};
