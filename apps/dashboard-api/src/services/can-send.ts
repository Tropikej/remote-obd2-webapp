import { ErrorCodes } from "@dashboard/shared";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";
import { sendControlRequest } from "./agent-control";
import { streamManager } from "./streams";

type CanSendInput = {
  can_id: unknown;
  is_extended?: unknown;
  data_hex: unknown;
  bus?: unknown;
};

const MAX_STD_ID = 0x7ff;
const MAX_EXT_ID = 0x1fffffff;

const normalizeCanId = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "CAN id is required.", 400);
  }
  const trimmed = value.trim().toLowerCase();
  const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid CAN id format.", 400);
  }
  const parsed = Number.parseInt(normalized, 16);
  if (!Number.isFinite(parsed)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid CAN id.", 400);
  }
  return parsed;
};

const normalizeHexData = (value: unknown) => {
  if (typeof value !== "string") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "data_hex must be a hex string.", 400);
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  if (!/^[0-9a-f]+$/.test(trimmed)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "data_hex must be hexadecimal.", 400);
  }
  if (trimmed.length % 2 !== 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "data_hex must have an even length.", 400);
  }
  if (trimmed.length > 16) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "CAN payload too large.", 400);
  }
  return trimmed;
};

const mapControlError = (error: unknown) => {
  const message = (error as Error).message || "Agent control channel error.";
  const isOffline = message.toLowerCase().includes("offline");
  const isTimeout = message.toLowerCase().includes("timeout");
  const code = isOffline || isTimeout ? ErrorCodes.AGENT_OFFLINE : ErrorCodes.INTERNAL_ERROR;
  const status = isTimeout ? 504 : isOffline ? 503 : 502;
  return new AppError(code, message, status);
};

export const sendCanFrame = async (
  dongleId: string,
  userId: string,
  isAdmin: boolean,
  payload: CanSendInput
) => {
  const dongle = await prisma.dongle.findUnique({ where: { id: dongleId } });
  if (!dongle) {
    throw new AppError(ErrorCodes.DONGLE_NOT_FOUND, "Dongle not found.", 404);
  }
  if (!isAdmin && dongle.ownerUserId !== userId) {
    throw new AppError(ErrorCodes.DONGLE_OWNED_BY_OTHER, "Dongle not owned by user.", 403);
  }

  const lastSeenAt = dongle.lastSeenAt;
  const isOnline = lastSeenAt && Date.now() - lastSeenAt.getTime() < 5 * 60 * 1000;
  if (!isOnline || !dongle.lastSeenAgentId) {
    throw new AppError(ErrorCodes.AGENT_OFFLINE, "Agent is offline.", 503);
  }

  const canId = normalizeCanId(payload.can_id);
  const requestedExtended =
    typeof payload.is_extended === "boolean" ? payload.is_extended : undefined;
  const isExtended =
    requestedExtended !== undefined ? requestedExtended : canId > MAX_STD_ID;

  if (!isExtended && canId > MAX_STD_ID) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "CAN id requires extended format.", 400);
  }
  if (isExtended && canId > MAX_EXT_ID) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "CAN id out of range.", 400);
  }

  const dataHex = normalizeHexData(payload.data_hex);
  const dlc = dataHex.length / 2;
  const canIdHex = `0x${canId.toString(16)}`;
  const bus = typeof payload.bus === "string" ? payload.bus : undefined;

  try {
    await sendControlRequest(dongle.lastSeenAgentId, {
      type: "can_frame_send",
      dongle_id: dongleId,
      lan_ip: dongle.lanIp ?? undefined,
      udp_port: dongle.udpPort ?? undefined,
      frame: {
        can_id: canIdHex,
        is_extended: isExtended,
        data_hex: dataHex,
        dlc,
        bus,
      },
    });
  } catch (error) {
    throw mapControlError(error);
  }

  streamManager.publish(`dongle:${dongleId}`, "can_frame", {
    type: "can_frame",
    dongle_id: dongleId,
    direction: "tx",
    bus,
    id: canIdHex,
    can_id: canIdHex,
    is_extended: isExtended,
    dlc,
    data_hex: dataHex,
    ts: new Date().toISOString(),
  });

  return { ok: true };
};
