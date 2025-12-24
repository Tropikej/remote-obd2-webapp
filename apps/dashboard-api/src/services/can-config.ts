import { ErrorCodes } from "@dashboard/shared";
import type { CanConfigApplyRequest } from "@dashboard/shared";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";
import { sendCanConfig } from "./agent-control";

const MODE_VALUES = new Set(["normal", "listen_only", "loopback", "ext_loop"]);

const assertNumber = (value: unknown, name: string) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `Invalid ${name}.`, 400);
  }
};

export const applyCanConfig = async (
  dongleId: string,
  userId: string,
  isAdmin: boolean,
  config: CanConfigApplyRequest
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

  if (!MODE_VALUES.has(config.mode)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid CAN mode.", 400);
  }

  assertNumber(config.bitrate, "bitrate");
  assertNumber(config.sample_point_permille, "sample_point_permille");
  assertNumber(config.prescaler, "prescaler");
  assertNumber(config.sjw, "sjw");
  assertNumber(config.tseg1, "tseg1");
  assertNumber(config.tseg2, "tseg2");

  const existing = await prisma.canConfig.findUnique({ where: { dongleId } });
  const { effective, appliedAt } = await sendCanConfig(dongle.lastSeenAgentId, dongleId, config);

  await prisma.canConfig.upsert({
    where: { dongleId },
    create: {
      dongleId,
      bitrate: effective.bitrate,
      samplePointPermille: effective.sample_point_permille,
      mode: effective.mode,
      useRaw: effective.use_raw,
      prescaler: effective.prescaler,
      sjw: effective.sjw,
      tseg1: effective.tseg1,
      tseg2: effective.tseg2,
      autoRetx: effective.auto_retx,
      txPause: effective.tx_pause,
      protocolExc: effective.protocol_exc,
      updatedAt: appliedAt,
    },
    update: {
      bitrate: effective.bitrate,
      samplePointPermille: effective.sample_point_permille,
      mode: effective.mode,
      useRaw: effective.use_raw,
      prescaler: effective.prescaler,
      sjw: effective.sjw,
      tseg1: effective.tseg1,
      tseg2: effective.tseg2,
      autoRetx: effective.auto_retx,
      txPause: effective.tx_pause,
      protocolExc: effective.protocol_exc,
      updatedAt: appliedAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "CAN_CONFIG_APPLIED",
      targetType: "dongle",
      targetId: dongleId,
      details: {
        before: existing
          ? {
              bitrate: existing.bitrate,
              sample_point_permille: existing.samplePointPermille,
              mode: existing.mode,
              use_raw: existing.useRaw,
              prescaler: existing.prescaler,
              sjw: existing.sjw,
              tseg1: existing.tseg1,
              tseg2: existing.tseg2,
              auto_retx: existing.autoRetx,
              tx_pause: existing.txPause,
              protocol_exc: existing.protocolExc,
            }
          : null,
        after: effective,
        applied_at: appliedAt.toISOString(),
      },
    },
  });

  return {
    dongle_id: dongleId,
    applied: true,
    effective,
    applied_at: appliedAt.toISOString(),
  };
};
