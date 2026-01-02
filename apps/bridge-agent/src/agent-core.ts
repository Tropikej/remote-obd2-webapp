import { EventEmitter } from "events";
import { spawn } from "child_process";
import os from "os";
import type { CanConfigApplyRequest } from "@dashboard/shared/protocols/can-config";
import type {
  CanRelayFrame,
  CommandChunkMessage,
  CommandRequestMessage,
  CommandResponseMessage,
} from "@dashboard/shared";
import {
  deviceIdToBytes,
  encodeCanFrame,
  encodeRempHeader,
  REMP_TYPE_CAN,
} from "@dashboard/remp";
import {
  AgentRegistration,
  DeviceReport,
  NetworkInterfaceSummary,
  ReportedDeviceRecord,
  fetchDongleToken,
  isAuthError,
  registerAgent,
  reportDevices,
  sendHeartbeat,
} from "./api/client";
import { AgentConfig, loadConfig, saveConfig } from "./config/store";
import { DiscoveryEvent, DiscoveryScanner, startDiscovery } from "./discovery";
import { applyCanConfigToDongle } from "./remp/can-config";
import { sendDongleCliCommand } from "./remp/cli";
import { startPairingMode, submitPairing } from "./remp/pairing";
import { decodeDongleToken } from "./remp/token";
import { createRempTransport, type RempCanEvent, type RempTarget } from "./remp/transport";
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
  cloudId?: string | null;
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

type CanFrameSendMessage = {
  type: "can_frame_send";
  request_id: string;
  dongle_id: string;
  frame: {
    can_id: string;
    is_extended: boolean;
    data_hex: string;
    dlc?: number;
    bus?: string;
  };
};

type CommandRequestControlMessage = CommandRequestMessage & {
  request_id: string;
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

const isCanFrameSendMessage = (message: Record<string, unknown>): message is CanFrameSendMessage =>
  message.type === "can_frame_send" &&
  typeof message.request_id === "string" &&
  typeof message.dongle_id === "string" &&
  typeof (message as CanFrameSendMessage).frame === "object" &&
  (message as CanFrameSendMessage).frame !== null &&
  typeof (message as CanFrameSendMessage).frame.can_id === "string" &&
  typeof (message as CanFrameSendMessage).frame.is_extended === "boolean" &&
  typeof (message as CanFrameSendMessage).frame.data_hex === "string";

const isCommandRequestMessage = (
  message: Record<string, unknown>
): message is CommandRequestControlMessage =>
  message.type === "command_request" &&
  typeof message.request_id === "string" &&
  typeof message.command_id === "string" &&
  typeof message.dongle_id === "string" &&
  typeof message.command === "string" &&
  Array.isArray(message.args) &&
  (message.args as unknown[]).every((arg) => typeof arg === "string") &&
  typeof message.timeout_ms === "number";

const parseNumber = (value: number | undefined, fallback: number) => {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const parseCanId = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error("Invalid CAN id format.");
  }
  const parsed = Number.parseInt(normalized, 16);
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid CAN id.");
  }
  return parsed;
};

const formatCanId = (value: number) => `0x${value.toString(16)}`;

const parseDataHex = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return Buffer.alloc(0);
  }
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Invalid CAN payload.");
  }
  return Buffer.from(normalized, "hex");
};

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
  let dataPlaneUnsubscribe: (() => void) | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let reportTimer: NodeJS.Timeout | null = null;
  let discovery: DiscoveryScanner | null = null;
  let discoveryEnabled = true;
  let registrationInFlight = false;
  let running = false;

  const rempTransport = createRempTransport();

  const devices = new Map<string, DeviceSnapshot>();
  const deviceInterfaces = new Map<string, Set<string>>();
  const cloudIdToDeviceId = new Map<string, string>();
  const tokenCache = new Map<string, { token: string; expiresAt: number }>();
  let dirty = false;
  let reporting = false;

  const resolveDeviceId = (dongleId: string) => {
    return cloudIdToDeviceId.get(dongleId) ?? dongleId;
  };

  const getSnapshotForDongle = (dongleId: string) => {
    const deviceId = resolveDeviceId(dongleId);
    return devices.get(deviceId) ?? null;
  };

  const findTargetForDongle = (
    dongleId: string,
    hintedIp?: string,
    hintedPort?: number
  ): RempTarget | null => {
    const snapshot = getSnapshotForDongle(dongleId);
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
  const tokenTtlMs = 5 * 60 * 1000;

  const setStatus = (patch: Partial<AgentStatus>) => {
    status = { ...status, ...patch };
    emitter.emit("status", status);
  };

  const getDongleToken = async (dongleId: string) => {
    const cached = tokenCache.get(dongleId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.token;
    }
    if (!state.agentToken) {
      throw new Error("Missing agent token.");
    }
    const response = await fetchDongleToken({
      apiBaseUrl,
      agentToken: state.agentToken,
      dongleId,
    });
    const token = response.token;
    tokenCache.set(dongleId, { token, expiresAt: now + tokenTtlMs });
    return token;
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
    if (dataPlaneUnsubscribe) {
      dataPlaneUnsubscribe();
      dataPlaneUnsubscribe = null;
    }
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
          const target = findTargetForDongle(message.dongle_id);
          if (!target) {
            throw new Error("Missing LAN IP or UDP port for dongle.");
          }
          const snapshot = getSnapshotForDongle(message.dongle_id);
          if (!snapshot) {
            throw new Error("Dongle not found in discovery cache.");
          }
          const token = await getDongleToken(message.dongle_id);
          const { effective } = await applyCanConfigToDongle(
            rempTransport,
            target,
            snapshot.report.device_id,
            token,
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
          const snapshot = getSnapshotForDongle(message.dongle_id);
          if (!snapshot) {
            throw new Error("Dongle not found in discovery cache.");
          }
          const result = await startPairingMode(
            rempTransport,
            target,
            snapshot.report.device_id
          );
          control?.send({
            type: "pairing_mode_started",
            request_id: message.request_id,
            dongle_id: message.dongle_id,
            status: result.status,
            expires_at: result.expires_at,
            expires_in_s: result.expires_in_s,
            pairing_nonce: result.pairing_nonce,
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
          const snapshot = getSnapshotForDongle(message.dongle_id);
          if (!snapshot) {
            throw new Error("Dongle not found in discovery cache.");
          }
          const result = await submitPairing(
            rempTransport,
            target,
            snapshot.report.device_id,
            message.pin,
            typeof message.pairing_nonce === "string" ? message.pairing_nonce : undefined,
            message.dongle_token
          );
          control?.send({
            type: "pairing_result",
            request_id: message.request_id,
            dongle_id: message.dongle_id,
            status: result.status,
            expires_in_s: "expires_in_s" in result ? result.expires_in_s : undefined,
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
      if (isCanFrameSendMessage(message)) {
        try {
          await sendCanFrameToDongle(message.dongle_id, message.frame);
          control?.send({
            type: "can_frame_ack",
            request_id: message.request_id,
            dongle_id: message.dongle_id,
          });
        } catch (error) {
          control?.send({
            type: "can_frame_error",
            request_id: message.request_id,
            message: (error as Error).message,
          });
        }
        return;
      }
      if (isCommandRequestMessage(message)) {
        control?.send({
          type: "command_ack",
          request_id: message.request_id,
          command_id: message.command_id,
          dongle_id: message.dongle_id,
        });
        const target = message.command_target === "dongle" ? "dongle" : "agent";
        if (target === "dongle") {
          void executeDongleCommand(message);
        } else {
          void executeAgentCommand(message);
        }
        return;
      }
    });
  };

  const sendCanFrameToDongle = async (
    dongleId: string,
    frame: { can_id: string; is_extended?: boolean; data_hex: string }
  ) => {
    const snapshot = getSnapshotForDongle(dongleId);
    if (!snapshot) {
      throw new Error("Dongle not found in discovery cache.");
    }
    const target = findTargetForDongle(dongleId);
    if (!target) {
      throw new Error("Missing LAN IP or UDP port for dongle.");
    }
    const canId = parseCanId(frame.can_id);
    const data = parseDataHex(frame.data_hex);
    const isExtended =
      typeof frame.is_extended === "boolean" ? frame.is_extended : canId > 0x7ff;
    const token = await getDongleToken(dongleId);
    const payload = encodeCanFrame({
      canId,
      isExtended,
      data,
    });
    const header = encodeRempHeader({
      type: REMP_TYPE_CAN,
      deviceId: deviceIdToBytes(snapshot.report.device_id),
      token: decodeDongleToken(token),
    });
    await rempTransport.send(target, Buffer.concat([header, payload]));
  };

  const handleDataPlaneFrame = async (message: { type: string } & Record<string, unknown>) => {
    if (message.type !== "can_frame") {
      return;
    }
    const payload = message as Record<string, unknown>;
    const dongleId = typeof payload.dongle_id === "string" ? payload.dongle_id : undefined;
    const targetDongleId =
      typeof payload.target_dongle_id === "string" ? payload.target_dongle_id : dongleId;
    const frame =
      typeof payload.frame === "object" && payload.frame !== null
        ? (payload.frame as Record<string, unknown>)
        : null;
    const canId = frame && typeof frame.can_id === "string" ? frame.can_id : null;
    const dataHex = frame && typeof frame.data_hex === "string" ? frame.data_hex : null;
    const isExtended =
      frame && typeof frame.is_extended === "boolean" ? frame.is_extended : undefined;
    if (!targetDongleId || !canId || !dataHex) {
      return;
    }
    try {
      await sendCanFrameToDongle(targetDongleId, {
        can_id: canId,
        is_extended: isExtended,
        data_hex: dataHex,
      });
    } catch (error) {
      console.warn(`[bridge-agent] data-plane CAN relay failed: ${(error as Error).message}`);
    }
  };

  const handleRempCanFrame = (event: RempCanEvent) => {
    const snapshot = devices.get(event.deviceId);
    const dongleId = snapshot?.cloudId;
    if (!dongleId || !dataPlane || !dataPlane.isOpen()) {
      return;
    }
    const frame: CanRelayFrame = {
      ts: new Date().toISOString(),
      can_id: formatCanId(event.frame.canId),
      is_extended: event.frame.isExtended,
      dlc: event.frame.dlc,
      data_hex: event.frame.dataHex,
      direction: "rx",
    };
    dataPlane.sendFrame({
      dongleId,
      frame,
    });
  };

  const rempUnsubscribe = rempTransport.onCanFrame(handleRempCanFrame);

  const sendCommandChunk = (payload: CommandChunkMessage) => {
    control?.send(payload);
  };

  const sendCommandResponse = (payload: CommandResponseMessage) => {
    control?.send(payload);
  };

  const executeDongleCommand = async (message: CommandRequestControlMessage) => {
    const commandSource = message.command_source ?? "web";
    const commandTarget = "dongle";
    const startedAt = new Date().toISOString();
    const snapshot = getSnapshotForDongle(message.dongle_id);
    if (!snapshot) {
      sendCommandResponse({
        type: "command_response",
        command_id: message.command_id,
        status: "error",
        stderr: "Dongle not found in discovery cache.",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        dongle_id: message.dongle_id,
        command_source: commandSource,
        command_target: commandTarget,
      });
      return;
    }
    const target = findTargetForDongle(message.dongle_id);
    if (!target) {
      sendCommandResponse({
        type: "command_response",
        command_id: message.command_id,
        status: "error",
        stderr: "Missing LAN IP or UDP port for dongle.",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        dongle_id: message.dongle_id,
        command_source: commandSource,
        command_target: commandTarget,
      });
      return;
    }

    const fullCommand = [message.command, ...(message.args || [])].join(" ").trim();
    try {
      const token = await getDongleToken(message.dongle_id);
      const response = await sendDongleCliCommand({
        transport: rempTransport,
        target,
        deviceId: snapshot.report.device_id,
        token,
        command: fullCommand,
        allowDangerous: message.allow_dangerous,
        timeoutMs: message.timeout_ms,
      });
      if (response.output) {
        const stream = response.status === "ok" ? "stdout" : "stderr";
        sendCommandChunk({
          type: "command_chunk",
          command_id: message.command_id,
          seq: 1,
          is_last: true,
          stream,
          data: Buffer.from(response.output, "utf8").toString("base64"),
          dongle_id: message.dongle_id,
          command_source: commandSource,
          command_target: commandTarget,
          truncated: response.truncated,
        });
      }
      const status =
        response.status === "ok"
          ? "ok"
          : response.status === "timeout"
            ? "timeout"
            : "error";
      sendCommandResponse({
        type: "command_response",
        command_id: message.command_id,
        status,
        exit_code: response.exitCode,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        dongle_id: message.dongle_id,
        command_source: commandSource,
        command_target: commandTarget,
        truncated: response.truncated,
      });
    } catch (error) {
      sendCommandResponse({
        type: "command_response",
        command_id: message.command_id,
        status: "error",
        stderr: (error as Error).message ?? "Dongle CLI failed.",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        dongle_id: message.dongle_id,
        command_source: commandSource,
        command_target: commandTarget,
      });
    }
  };

  const executeAgentCommand = async (message: CommandRequestControlMessage) => {
    const commandSource = message.command_source ?? "web";
    const commandTarget = "agent";
    const startedAt = new Date().toISOString();
    let seq = 0;
    let finished = false;

    const respond = (payload: CommandResponseMessage) => {
      if (finished) {
        return;
      }
      finished = true;
      sendCommandResponse(payload);
    };

    const proc = spawn(message.command, message.args, {
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      respond({
        type: "command_response",
        command_id: message.command_id,
        status: "timeout",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        dongle_id: message.dongle_id,
        command_source: commandSource,
        command_target: commandTarget,
      });
    }, message.timeout_ms);

    const onData = (stream: "stdout" | "stderr") => (data: Buffer) => {
      if (finished) {
        return;
      }
      sendCommandChunk({
        type: "command_chunk",
        command_id: message.command_id,
        seq: seq++,
        is_last: false,
        stream,
        data: Buffer.from(data).toString("base64"),
        dongle_id: message.dongle_id,
        command_source: commandSource,
        command_target: commandTarget,
      });
    };

    proc.stdout?.on("data", onData("stdout"));
    proc.stderr?.on("data", onData("stderr"));

    proc.on("error", (error) => {
      clearTimeout(timeout);
      respond({
        type: "command_response",
        command_id: message.command_id,
        status: "error",
        stderr: (error as Error).message ?? "Command failed to start.",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        dongle_id: message.dongle_id,
        command_source: commandSource,
        command_target: commandTarget,
      });
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      const status = code === 0 ? "ok" : "error";
      respond({
        type: "command_response",
        command_id: message.command_id,
        status,
        exit_code: code ?? null,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        dongle_id: message.dongle_id,
        command_source: commandSource,
        command_target: commandTarget,
      });
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
    dataPlaneUnsubscribe = dataPlane.onFrame((payload) => {
      void handleDataPlaneFrame(payload as any);
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
        ownershipState: existing?.ownershipState ?? null,
        ownerUserId: existing?.ownerUserId ?? null,
        cloudId: existing?.cloudId ?? null,
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
          snapshot.cloudId = record.id ?? snapshot.cloudId ?? null;
          if (record.id) {
            cloudIdToDeviceId.set(record.id, deviceId);
          }
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
    cloudIdToDeviceId.clear();
    tokenCache.clear();
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
    rempUnsubscribe();
    rempTransport.close();
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
