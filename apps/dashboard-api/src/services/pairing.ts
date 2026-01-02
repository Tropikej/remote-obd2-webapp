import { randomBytes } from "crypto";
import { ErrorCodes } from "@dashboard/shared";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";
import { sendControlRequest } from "./agent-control";
import { createEncryptedDongleToken } from "./dongle-tokens";
import { enterSecurityHold, HOLD_COOLDOWN_MS } from "./security-hold";

const PAIRING_TTL_MS = 2 * 60 * 1000; // 120 seconds
const MAX_PIN_ATTEMPTS = 5;
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

const now = () => new Date();

const randomToken = () => randomBytes(32).toString("base64");

const ensureAgentOnline = (dongle: { lastSeenAt: Date | null; lastSeenAgentId: string | null }) => {
  const lastSeenAt = dongle.lastSeenAt;
  const lastSeenAgentId = dongle.lastSeenAgentId;
  const isOnline =
    lastSeenAt && lastSeenAgentId && Date.now() - lastSeenAt.getTime() < ONLINE_THRESHOLD_MS;
  if (!isOnline || !lastSeenAgentId) {
    throw new AppError(ErrorCodes.AGENT_OFFLINE, "Agent is offline.", 503);
  }
  return lastSeenAgentId;
};

const latestActiveSession = async (dongleId: string, userId: string) => {
  const existing = await prisma.pairingSession.findFirst({
    where: { dongleId, userId, status: "ACTIVE", expiresAt: { gt: now() } },
    orderBy: { createdAt: "desc" },
  });
  return existing;
};

const latestHoldSession = async (dongleId: string) => {
  const hold = await prisma.pairingSession.findFirst({
    where: { dongleId, status: "HOLD", holdUntil: { gt: now() } },
    orderBy: { holdUntil: "desc" },
  });
  return hold;
};

export const startPairingSession = async (dongleId: string, userId: string) => {
  const dongle = await prisma.dongle.findUnique({ where: { id: dongleId } });
  if (!dongle) {
    throw new AppError(ErrorCodes.DONGLE_NOT_FOUND, "Dongle not found.", 404);
  }

  if (dongle.ownerUserId && dongle.ownerUserId !== userId) {
    throw new AppError(ErrorCodes.DONGLE_OWNED_BY_OTHER, "Dongle owned by another user.", 403);
  }

  if (dongle.ownershipState === "SECURITY_HOLD") {
    const holdSession = await latestHoldSession(dongleId);
    const holdUntil = holdSession?.holdUntil;
    throw new AppError(ErrorCodes.PAIRING_SECURITY_HOLD, "Dongle is in security hold.", 423, {
      hold_until: holdUntil ? holdUntil.toISOString() : undefined,
    });
  }

  if (dongle.ownerUserId === userId && dongle.ownershipState === "CLAIMED_ACTIVE") {
    return {
      paired: true,
      dongle_id: dongleId,
      owner_user_id: userId,
      ownership_state: dongle.ownershipState,
    };
  }

  ensureAgentOnline({ lastSeenAt: dongle.lastSeenAt, lastSeenAgentId: dongle.lastSeenAgentId });

  if (!dongle.lanIp || !dongle.udpPort) {
    throw new AppError(ErrorCodes.AGENT_OFFLINE, "Dongle network info unavailable.", 503);
  }

  const hold = await latestHoldSession(dongleId);
  if (hold?.holdUntil && hold.holdUntil > now()) {
    throw new AppError(ErrorCodes.PAIRING_SECURITY_HOLD, "Dongle is in security hold.", 423, {
      hold_until: hold.holdUntil.toISOString(),
    });
  }

  const existing = await latestActiveSession(dongleId, userId);
  if (existing) {
    if (!existing.pairingNonce) {
      const agentId = ensureAgentOnline({
        lastSeenAt: dongle.lastSeenAt,
        lastSeenAgentId: dongle.lastSeenAgentId,
      });
      let response: any;
      try {
        response = await sendControlRequest(agentId, {
          type: "pairing_mode_start",
          dongle_id: dongleId,
          lan_ip: dongle.lanIp,
          udp_port: dongle.udpPort,
        });
      } catch (error) {
        throw new AppError(ErrorCodes.AGENT_OFFLINE, (error as Error).message, 503);
      }
      if (!response || response.type !== "pairing_mode_started") {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, "Invalid agent response.", 502);
      }
      const status = typeof response.status === "string" ? response.status : "ok";
      if (status === "cooldown") {
        const seconds =
          typeof response.expires_in_s === "number" ? response.expires_in_s : undefined;
        const holdUntil = seconds ? new Date(Date.now() + seconds * 1000) : undefined;
        if (holdUntil) {
          await enterSecurityHold(
            dongle.id,
            holdUntil,
            "too_many_pin_attempts",
            { userId },
            existing.id
          );
        }
        throw new AppError(ErrorCodes.PAIRING_SECURITY_HOLD, "Dongle is in security hold.", 423, {
          hold_until: holdUntil ? holdUntil.toISOString() : undefined,
        });
      }
      if (status !== "ok") {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, "Pairing failed.", 502);
      }
      const pairingNonce =
        typeof response.pairing_nonce === "string"
          ? Buffer.from(response.pairing_nonce, "base64")
          : null;
      if (status === "ok" && !pairingNonce) {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, "Pairing nonce missing from agent.", 502);
      }
      if (pairingNonce && pairingNonce.length !== 16) {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, "Invalid pairing nonce from agent.", 502);
      }
      const expiresAt =
        typeof response.expires_in_s === "number"
          ? new Date(Date.now() + response.expires_in_s * 1000)
          : typeof response.expires_at === "string"
            ? new Date(response.expires_at)
            : null;
      await prisma.pairingSession.update({
        where: { id: existing.id },
        data: {
          pairingNonce: pairingNonce ?? undefined,
          ...(expiresAt ? { expiresAt } : {}),
        },
      });
      const effectiveExpiresAt = expiresAt ?? existing.expiresAt;
      return {
        pairing_session_id: existing.id,
        expires_at: effectiveExpiresAt.toISOString(),
      };
    }
    return {
      pairing_session_id: existing.id,
      expires_at: existing.expiresAt.toISOString(),
    };
  }

  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.pairingSession.create({
      data: {
        dongleId,
        userId,
        status: "ACTIVE",
        attempts: 0,
        expiresAt,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "PAIRING_MODE_START",
        targetType: "dongle",
        targetId: dongleId,
        details: {
          pairing_session_id: created.id,
          expires_at: expiresAt.toISOString(),
        },
      },
    });

    return created;
  });

  const agentId = ensureAgentOnline({
    lastSeenAt: dongle.lastSeenAt,
    lastSeenAgentId: dongle.lastSeenAgentId,
  });

  let response: any;
  try {
    response = await sendControlRequest(agentId, {
      type: "pairing_mode_start",
      dongle_id: dongleId,
      lan_ip: dongle.lanIp,
      udp_port: dongle.udpPort,
    });
  } catch (error) {
    throw new AppError(ErrorCodes.AGENT_OFFLINE, (error as Error).message, 503);
  }
  if (!response || response.type !== "pairing_mode_started") {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, "Invalid agent response.", 502);
  }
  const status = typeof response.status === "string" ? response.status : "ok";
  if (status === "cooldown") {
    const seconds =
      typeof response.expires_in_s === "number" ? response.expires_in_s : undefined;
    const holdUntil = seconds ? new Date(Date.now() + seconds * 1000) : undefined;
    if (holdUntil) {
      await enterSecurityHold(
        dongle.id,
        holdUntil,
        "too_many_pin_attempts",
        { userId },
        session.id
      );
    }
    throw new AppError(ErrorCodes.PAIRING_SECURITY_HOLD, "Dongle is in security hold.", 423, {
      hold_until: holdUntil ? holdUntil.toISOString() : undefined,
    });
  }
  if (status !== "ok") {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, "Pairing failed.", 502);
  }
  const pairingNonce =
    typeof response.pairing_nonce === "string"
      ? Buffer.from(response.pairing_nonce, "base64")
      : null;
  if (status === "ok" && !pairingNonce) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, "Pairing nonce missing from agent.", 502);
  }
  if (pairingNonce && pairingNonce.length !== 16) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, "Invalid pairing nonce from agent.", 502);
  }
  const expiresAtFromAgent =
    typeof response.expires_in_s === "number"
      ? new Date(Date.now() + response.expires_in_s * 1000)
      : typeof response.expires_at === "string"
        ? new Date(response.expires_at)
        : null;
  if (pairingNonce || expiresAtFromAgent) {
    await prisma.pairingSession.update({
      where: { id: session.id },
      data: {
        pairingNonce: pairingNonce ?? undefined,
        ...(expiresAtFromAgent ? { expiresAt: expiresAtFromAgent } : {}),
      },
    });
  }

  return {
    pairing_session_id: session.id,
    expires_at: (expiresAtFromAgent ?? session.expiresAt).toISOString(),
  };
};

type PairingSubmitInput = {
  pairingSessionId: string;
  pin: string;
  pairingNonce?: string | null;
  dongleToken?: string | null;
  actorIp?: string | null;
  actorUserAgent?: string | null;
};

type PairingResult =
  | { status: "ok"; dongle_id: string; owner_user_id: string }
  | { status: "hold"; hold_until?: string }
  | { status: "invalid_pin"; attempts_remaining: number };

export const submitPairing = async (userId: string, input: PairingSubmitInput): Promise<PairingResult> => {
  const session = await prisma.pairingSession.findUnique({
    where: { id: input.pairingSessionId },
    include: { dongle: true },
  });

  if (!session || session.userId !== userId) {
    throw new AppError(ErrorCodes.PAIRING_SESSION_INVALID, "Pairing session invalid.", 400);
  }

  if (session.status !== "ACTIVE") {
    throw new AppError(ErrorCodes.PAIRING_SESSION_INVALID, "Pairing session inactive.", 400);
  }

  const dongle = session.dongle;
  if (!dongle) {
    throw new AppError(ErrorCodes.DONGLE_NOT_FOUND, "Dongle not found.", 404);
  }

  if (session.expiresAt <= now()) {
    await prisma.pairingSession.update({
      where: { id: session.id },
      data: { status: "EXPIRED" },
    });
    throw new AppError(ErrorCodes.PAIRING_SESSION_EXPIRED, "Pairing session expired.", 400);
  }

  const hold = await latestHoldSession(dongle.id);
  if (hold?.holdUntil && hold.holdUntil > now()) {
    throw new AppError(ErrorCodes.PAIRING_SECURITY_HOLD, "Dongle is in security hold.", 423, {
      hold_until: hold.holdUntil.toISOString(),
    });
  }

  if (session.attempts >= MAX_PIN_ATTEMPTS) {
    const holdUntil = new Date(Date.now() + HOLD_COOLDOWN_MS);
    await enterSecurityHold(
      dongle.id,
      holdUntil,
      "too_many_pin_attempts",
      { userId, ip: input.actorIp, userAgent: input.actorUserAgent },
      session.id
    );
    throw new AppError(ErrorCodes.PAIRING_SECURITY_HOLD, "Too many PIN attempts.", 423, {
      hold_until: holdUntil.toISOString(),
    });
  }

  const agentId = ensureAgentOnline({
    lastSeenAt: dongle.lastSeenAt,
    lastSeenAgentId: dongle.lastSeenAgentId,
  });

  if (!dongle.lanIp || !dongle.udpPort) {
    throw new AppError(ErrorCodes.AGENT_OFFLINE, "Dongle network info unavailable.", 503);
  }

  const dongleToken = input.dongleToken || randomToken();
  const storedNonce = session.pairingNonce
    ? session.pairingNonce.toString("base64")
    : undefined;
  const pairingNonce = input.pairingNonce ?? storedNonce;
  if (!pairingNonce) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, "Pairing nonce missing.", 500);
  }

  let response: any;
  try {
    response = await sendControlRequest(agentId, {
      type: "pairing_submit",
      dongle_id: dongle.id,
      pin: input.pin,
      pairing_nonce: pairingNonce,
      dongle_token: dongleToken,
      lan_ip: dongle.lanIp,
      udp_port: dongle.udpPort,
    });
  } catch (error) {
    throw new AppError(ErrorCodes.AGENT_OFFLINE, (error as Error).message, 503);
  }

  const status = response?.status as string | undefined;
  const isInvalidPin = status === "invalid_pin";
  const isOk = status === "ok";
  const isCooldown = status === "cooldown";

  if (isCooldown) {
    const seconds =
      typeof response?.expires_in_s === "number" ? response.expires_in_s : undefined;
    const holdUntil = seconds ? new Date(Date.now() + seconds * 1000) : undefined;
    if (holdUntil) {
      await enterSecurityHold(
        dongle.id,
        holdUntil,
        "too_many_pin_attempts",
        { userId, ip: input.actorIp, userAgent: input.actorUserAgent },
        session.id
      );
    }
    throw new AppError(ErrorCodes.PAIRING_SECURITY_HOLD, "Dongle is in security hold.", 423, {
      hold_until: holdUntil ? holdUntil.toISOString() : undefined,
    });
  }

  if (!isOk && !isInvalidPin) {
    await prisma.pairingSession.update({
      where: { id: session.id },
      data: { status: "FAILED", attempts: { increment: 1 } },
    });
    throw new AppError(ErrorCodes.INTERNAL_ERROR, "Pairing failed.", 502);
  }

  if (isInvalidPin) {
    const nextAttempts = session.attempts + 1;
    if (nextAttempts >= MAX_PIN_ATTEMPTS) {
      const holdUntil = new Date(Date.now() + HOLD_COOLDOWN_MS);
      await enterSecurityHold(
        dongle.id,
        holdUntil,
        "too_many_pin_attempts",
        { userId, ip: input.actorIp, userAgent: input.actorUserAgent },
        session.id
      );
      throw new AppError(ErrorCodes.PAIRING_SECURITY_HOLD, "Too many PIN attempts.", 423, {
        hold_until: holdUntil.toISOString(),
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.pairingSession.update({
        where: { id: session.id },
        data: { attempts: nextAttempts },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "PAIRING_PIN_INVALID",
          targetType: "dongle",
          targetId: dongle.id,
          ip: input.actorIp ?? null,
          userAgent: input.actorUserAgent ?? null,
          details: {
            pairing_session_id: session.id,
            attempts: nextAttempts,
            max_attempts: MAX_PIN_ATTEMPTS,
          },
        },
      });
    });

    throw new AppError(ErrorCodes.PAIRING_PIN_INVALID, "PIN is incorrect.", 400, {
      attempts_remaining: Math.max(MAX_PIN_ATTEMPTS - nextAttempts, 0),
    });
  }

  // status ok
  await prisma.$transaction(async (tx) => {
    await tx.pairingSession.update({
      where: { id: session.id },
      data: {
        status: "SUCCESS",
        attempts: { increment: 1 },
      },
    });

    await tx.dongle.update({
      where: { id: dongle.id },
      data: {
        ownerUserId: userId,
        ownershipState: "CLAIMED_ACTIVE",
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "PAIRING_SUCCESS",
        targetType: "dongle",
        targetId: dongle.id,
        ip: input.actorIp ?? null,
        userAgent: input.actorUserAgent ?? null,
        details: {
          pairing_session_id: session.id,
          attempts: session.attempts + 1,
        },
      },
    });
  });

  await createEncryptedDongleToken({
    dongleId: dongle.id,
    userId,
    token: dongleToken,
  });

  return { status: "ok", dongle_id: dongle.id, owner_user_id: userId };
};

export const unpairDongle = async (dongleId: string, actorUserId: string, force = false) => {
  const dongle = await prisma.dongle.findUnique({ where: { id: dongleId } });
  if (!dongle) {
    throw new AppError(ErrorCodes.DONGLE_NOT_FOUND, "Dongle not found.", 404);
  }

  if (!force) {
    if (!dongle.ownerUserId || dongle.ownerUserId !== actorUserId) {
      throw new AppError(ErrorCodes.DONGLE_OWNED_BY_OTHER, "Dongle not owned by user.", 403);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.dongleToken.deleteMany({ where: { dongleId } });
    await tx.dongleGroup.deleteMany({
      where: {
        OR: [{ dongleAId: dongleId }, { dongleBId: dongleId }],
      },
    });
    await tx.pairingSession.updateMany({
      where: { dongleId, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });

    await tx.dongle.update({
      where: { id: dongleId },
      data: {
        ownerUserId: null,
        ownershipState: "UNCLAIMED",
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actorUserId,
        action: force ? "DONGLE_FORCE_UNPAIR" : "DONGLE_UNPAIR",
        targetType: "dongle",
        targetId: dongleId,
        details: {
          previous_owner_user_id: dongle.ownerUserId,
          force,
        },
      },
    });
  });

  return { ok: true };
};
