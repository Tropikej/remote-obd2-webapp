import { EventEmitter } from "events";
import dgram from "dgram";
import os from "os";
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
  const socket = dgram.createSocket("udp4");
  let intervalTimer: NodeJS.Timeout | null = null;
  let interfaces: InterfaceInfo[] = [];
  let seq = 1;
  let warnedNoInterfaces = false;

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

  socket.on("message", (msg, rinfo) => {
    let payload: AnnouncePayload;
    try {
      payload = decodeAnnounce(msg);
    } catch (error) {
      return;
    }

    const deviceId = payload.deviceId?.toLowerCase();
    if (!deviceId) {
      return;
    }

    const sourceIp = rinfo.address;
    const interfaceInfo = findInterfaceForIp(interfaces, sourceIp);

    const normalized: AnnouncePayload = {
      ...payload,
      deviceId,
      lanIp: payload.lanIp || sourceIp,
    };

    emitter.emit("dongleDiscovered", {
      payload: normalized,
      sourceIp,
      interfaceInfo,
      receivedAt: new Date(),
    } satisfies DiscoveryEvent);
  });

  socket.on("error", (error) => {
    console.warn(`[bridge-agent] discovery socket error: ${error.message}`);
  });

  socket.bind(0, () => {
    socket.setBroadcast(true);
    scan();
    intervalTimer = setInterval(scan, config.intervalMs);
  });

  emitter.scan = scan;
  emitter.stop = async () => {
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  };

  return emitter;
};
