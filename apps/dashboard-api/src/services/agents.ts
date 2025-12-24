import { randomBytes, createHash } from "crypto";
import { ErrorCodes } from "@dashboard/shared";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";
import { streamManager } from "./streams";

type RegisterAgentInput = {
  userId: string;
  agentName?: string;
  hostname: string;
  os: string;
  version: string;
  networkInterfaces?: unknown;
};

type DeviceReport = {
  device_id: string;
  fw_build?: string;
  udp_port?: number;
  capabilities?: number;
  proto_ver?: number;
  lan_ip?: string;
  pairing_state?: number;
  pairing_nonce?: string;
  owner_user_id?: string;
};

type NetworkInterfaceSummary = {
  name: string;
  addresses: {
    address: string;
    family: string;
    netmask?: string;
  }[];
};

const normalizeDeviceId = (value: string) => value.trim().toLowerCase();

const ensureDeviceId = (value: string) => {
  const normalized = normalizeDeviceId(value);
  if (!/^[0-9a-f]{16}$/.test(normalized)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid device_id.", 400);
  }
  return normalized;
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const normalizeNetworkInterfaces = (value: unknown): NetworkInterfaceSummary[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const cleaned = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const raw = entry as { name?: unknown; addresses?: unknown };
      if (typeof raw.name !== "string" || !Array.isArray(raw.addresses)) {
        return null;
      }
      const addresses = raw.addresses
        .map((addressEntry) => {
          if (!addressEntry || typeof addressEntry !== "object") {
            return null;
          }
          const addr = addressEntry as { address?: unknown; family?: unknown; netmask?: unknown };
          if (typeof addr.address !== "string" || typeof addr.family !== "string") {
            return null;
          }
          const item: NetworkInterfaceSummary["addresses"][number] = {
            address: addr.address,
            family: addr.family,
          };
          if (typeof addr.netmask === "string") {
            item.netmask = addr.netmask;
          }
          return item;
        })
        .filter((addr): addr is NetworkInterfaceSummary["addresses"][number] => Boolean(addr));
      if (addresses.length === 0) {
        return null;
      }
      return { name: raw.name, addresses };
    })
    .filter((entry): entry is NetworkInterfaceSummary => Boolean(entry));

  return cleaned.length > 0 ? cleaned : undefined;
};

export const registerAgent = async (input: RegisterAgentInput) => {
  const networkInterfaces = normalizeNetworkInterfaces(input.networkInterfaces);
  const agent = await prisma.agent.create({
    data: {
      userId: input.userId,
      agentName: input.agentName,
      hostname: input.hostname,
      os: input.os,
      version: input.version,
      networkInterfaces,
      lastSeenAt: new Date(),
    },
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.agentToken.create({
    data: {
      agentId: agent.id,
      tokenHash: hashToken(token),
    },
  });

  return { agent, token };
};

export const updateHeartbeat = async (agentId: string, data: Partial<RegisterAgentInput>) => {
  const networkInterfaces = normalizeNetworkInterfaces(data.networkInterfaces);
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      agentName: data.agentName,
      hostname: data.hostname,
      os: data.os,
      version: data.version,
      ...(networkInterfaces ? { networkInterfaces } : {}),
      lastSeenAt: new Date(),
    },
  });
};

export const reportDevices = async (agentId: string, devices: DeviceReport[]) => {
  const now = new Date();

  await prisma.agent.update({
    where: { id: agentId },
    data: { lastSeenAt: now },
  });

  const results = [];
  for (const device of devices) {
    const deviceId = ensureDeviceId(device.device_id);
    const pairingNonce = device.pairing_nonce ? Buffer.from(device.pairing_nonce, "base64") : null;
    const existing = await prisma.dongle.findUnique({ where: { deviceId } });
    const ownerProvided = typeof device.owner_user_id === "string";
    const ownerUserId = ownerProvided ? device.owner_user_id : existing?.ownerUserId ?? null;

    const record = await prisma.dongle.upsert({
      where: { deviceId },
      create: {
        deviceId,
        ownerUserId,
        ownershipState: ownerUserId ? "CLAIMED_ACTIVE" : "UNCLAIMED",
        fwBuild: device.fw_build,
        lanIp: device.lan_ip,
        udpPort: device.udp_port,
        capabilities: device.capabilities,
        protoVer: device.proto_ver,
        pairingState: device.pairing_state,
        pairingNonce: pairingNonce ?? undefined,
        lastSeenAgentId: agentId,
        lastSeenAt: now,
      },
      update: {
        ownerUserId,
        ownershipState: ownerProvided ? "CLAIMED_ACTIVE" : existing?.ownershipState ?? "UNCLAIMED",
        fwBuild: device.fw_build,
        lanIp: device.lan_ip,
        udpPort: device.udp_port,
        capabilities: device.capabilities,
        protoVer: device.proto_ver,
        pairingState: device.pairing_state,
        pairingNonce: pairingNonce ?? undefined,
        lastSeenAgentId: agentId,
        lastSeenAt: now,
      },
    });

    streamManager.publish(`dongle:${record.id}`, "presence", {
      type: "presence",
      dongle_id: record.id,
      online: true,
      agent_id: agentId,
      seen_at: now.toISOString(),
    });

    if (ownerProvided && ownerUserId && ownerUserId !== existing?.ownerUserId) {
      await prisma.auditLog.create({
        data: {
          actorUserId: ownerUserId,
          action: "DONGLE_OWNERSHIP_UPDATED",
          targetType: "dongle",
          targetId: record.id,
          details: {
            device_id: record.deviceId,
            owner_user_id: ownerUserId,
          },
        },
      });
    }

    results.push(record);
  }

  return results;
};
