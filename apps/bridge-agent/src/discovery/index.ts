import { EventEmitter } from "events";
import dgram from "dgram";
import os from "os";
import type { AddressInfo } from "net";
import {
  AnnouncePayload,
  decodeAnnounce,
  encodeDiscover,
} from "@dashboard/shared/protocols/discovery";

export type InterfaceInfo = {
  name: string;
  address: string;
  netmask: string;
  broadcast: string;
};

export type DiscoveryEvent = {
  payload: AnnouncePayload;
  sourceIp: string;
  sourcePort: number;
  interfaceInfo: InterfaceInfo | null;
  receivedAt: Date;
};

export type DiscoveryConfig = {
  port: number;
  intervalMs: number;
};

export type DiscoveryScanner = EventEmitter & {
  stop: () => Promise<void>;
  scan: () => void;
};

const EXCLUDED_PREFIXES = ["tun", "tap", "wg", "utun", "ppp", "docker", "br-", "vbox", "vmnet"];
const DEBUG_DISCOVERY = process.env.BRIDGE_AGENT_DEBUG_DISCOVERY === "1";

const ipToInt = (ip: string) =>
  ip
    .split(".")
    .map((octet) => Number(octet))
    .reduce((acc, octet) => ((acc << 8) | octet) >>> 0, 0);

const intToIp = (value: number) =>
  [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join(".");

const computeBroadcast = (address: string, netmask: string) => {
  const addr = ipToInt(address);
  const mask = ipToInt(netmask);
  return intToIp((addr | (~mask >>> 0)) >>> 0);
};

const isExcluded = (name: string) =>
  EXCLUDED_PREFIXES.some((prefix) => name.toLowerCase().startsWith(prefix));

const enumerateInterfaces = (): InterfaceInfo[] => {
  const result: InterfaceInfo[] = [];
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries || isExcluded(name)) {
      continue;
    }
    for (const entry of entries) {
      if (!entry || entry.internal) {
        continue;
      }
      const family = typeof entry.family === "string" ? entry.family : "IPv4";
      if (family !== "IPv4") {
        continue;
      }
      if (!entry.address || !entry.netmask) {
        continue;
      }
      result.push({
        name,
        address: entry.address,
        netmask: entry.netmask,
        broadcast: computeBroadcast(entry.address, entry.netmask),
      });
    }
  }
  return result;
};

const findInterfaceForIp = (interfaces: InterfaceInfo[], ip: string) => {
  const target = ipToInt(ip);
  for (const iface of interfaces) {
    const mask = ipToInt(iface.netmask);
    const network = ipToInt(iface.address) & mask;
    if ((target & mask) === network) {
      return iface;
    }
  }
  return null;
};

export const startDiscovery = (config: DiscoveryConfig): DiscoveryScanner => {
  const emitter = new EventEmitter() as DiscoveryScanner;
  const createSocket = () => dgram.createSocket({ type: "udp4", reuseAddr: true });
  let socket = createSocket();
  let intervalTimer: NodeJS.Timeout | null = null;
  let interfaces: InterfaceInfo[] = [];
  let seq = 1;
  let warnedNoInterfaces = false;
  let stopped = false;

  const logDebug = (message: string) => {
    if (DEBUG_DISCOVERY) {
      console.log(message);
    }
  };

  const scan = () => {
    interfaces = enumerateInterfaces();
    if (interfaces.length === 0) {
      if (!warnedNoInterfaces) {
        console.warn("[bridge-agent] discovery: no eligible interfaces found.");
        warnedNoInterfaces = true;
      }
      return;
    }
    warnedNoInterfaces = false;
    if (DEBUG_DISCOVERY) {
      const summary = interfaces
        .map((iface) => `${iface.name} ${iface.address} -> ${iface.broadcast}`)
        .join(" | ");
      logDebug(`[bridge-agent] discovery interfaces: ${summary}`);
    }
    const packet = encodeDiscover(seq++);
    const targets = new Set(interfaces.map((iface) => iface.broadcast));
    for (const broadcast of targets) {
      socket.send(packet, config.port, broadcast, (error) => {
        if (error) {
          console.warn(`[bridge-agent] discovery broadcast failed: ${error.message}`);
        }
      });
    }
  };

  const attachSocketHandlers = () => {
    socket.on("message", (msg, rinfo) => {
      let payload: AnnouncePayload;
      try {
        payload = decodeAnnounce(msg);
      } catch (error) {
        if (DEBUG_DISCOVERY) {
          const reason = (error as Error).message;
          logDebug(
            `[bridge-agent] discovery decode failed from ${rinfo.address}:${rinfo.port} (${msg.length} bytes): ${reason}`
          );
        }
        return;
      }

      const deviceId = payload.deviceId?.toLowerCase();
      if (!deviceId) {
        if (DEBUG_DISCOVERY) {
          logDebug(`[bridge-agent] discovery announce missing device_id from ${rinfo.address}`);
        }
        return;
      }

      const sourceIp = rinfo.address;
      const sourcePort = rinfo.port;
      const interfaceInfo = findInterfaceForIp(interfaces, sourceIp);

      const lanIp = payload.lanIp;
      const isValidLanIp =
        typeof lanIp === "string" &&
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(lanIp) &&
        !lanIp.startsWith("127.") &&
        lanIp !== "0.0.0.0";
      const normalized: AnnouncePayload = {
        ...payload,
        deviceId,
        lanIp: isValidLanIp ? lanIp : sourceIp,
      };

      if (DEBUG_DISCOVERY) {
        const ifaceName = interfaceInfo?.name ?? "unknown";
        logDebug(
          `[bridge-agent] discovery announce device=${deviceId} ip=${normalized.lanIp} iface=${ifaceName}`
        );
      }

      emitter.emit("dongleDiscovered", {
        payload: normalized,
        sourceIp,
        sourcePort,
        interfaceInfo,
        receivedAt: new Date(),
      } satisfies DiscoveryEvent);
    });

    socket.on("error", (error) => {
      console.warn(`[bridge-agent] discovery socket error: ${error.message}`);
    });
  };

  const bindSocket = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        socket.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        socket.off("error", onError);
        resolve();
      };
      socket.once("error", onError);
      socket.once("listening", onListening);
      socket.bind(port);
    });

  const ensureBound = async () => {
    try {
      await bindSocket(config.port);
      logDebug(`[bridge-agent] discovery bound to udp ${config.port}`);
    } catch (error) {
      const message = (error as Error).message;
      console.warn(
        `[bridge-agent] discovery bind ${config.port} failed: ${message}; falling back to ephemeral port`
      );
      socket.removeAllListeners();
      socket.close();
      socket = createSocket();
      attachSocketHandlers();
      await bindSocket(0);
      const addr = socket.address();
      const port =
        typeof addr === "object" && addr !== null ? (addr as AddressInfo).port : 0;
      logDebug(`[bridge-agent] discovery bound to udp ${port}`);
    }

    if (stopped) {
      socket.close();
    }
  };

  attachSocketHandlers();

  void ensureBound().then(() => {
    socket.setBroadcast(true);
    scan();
    intervalTimer = setInterval(scan, config.intervalMs);
  });

  emitter.scan = scan;
  emitter.stop = async () => {
    stopped = true;
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  };

  return emitter;
};
