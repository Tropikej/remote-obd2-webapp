import { prisma } from "../db";

export const HOLD_COOLDOWN_MS = 5 * 60 * 1000;

type HoldReason =
  | "too_many_pin_attempts"
  | "reset_detected"
  | "suspicious_agent_behavior"
  | "auth_anomaly"
  | "force_hold";

type AuditActor = {
  userId?: string;
  ip?: string | null;
  userAgent?: string | null;
};

export const enterSecurityHold = async (
  dongleId: string,
  holdUntil: Date,
  reason: HoldReason,
  actor?: AuditActor,
  pairingSessionId?: string
) => {
  await prisma.$transaction(async (tx) => {
    if (pairingSessionId) {
      await tx.pairingSession.update({
        where: { id: pairingSessionId },
        data: {
          status: "HOLD",
          holdUntil,
          holdReason: reason,
        },
      });
    }

    await tx.dongle.update({
      where: { id: dongleId },
      data: {
        ownershipState: "SECURITY_HOLD",
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor?.userId,
        action: "SECURITY_HOLD_ENTER",
        targetType: "dongle",
        targetId: dongleId,
        ip: actor?.ip ?? null,
        userAgent: actor?.userAgent ?? null,
        details: {
          reason,
          hold_until: holdUntil.toISOString(),
          pairing_session_id: pairingSessionId ?? null,
        },
      },
    });
  });
};

export const clearSecurityHold = async (dongleId: string, actor?: AuditActor) => {
  await prisma.$transaction(async (tx) => {
    await tx.dongle.update({
      where: { id: dongleId },
      data: {
        ownershipState: "UNCLAIMED",
      },
    });

    await tx.pairingSession.updateMany({
      where: { dongleId, status: "HOLD" },
      data: { status: "EXPIRED" },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor?.userId,
        action: "SECURITY_HOLD_CLEAR",
        targetType: "dongle",
        targetId: dongleId,
        ip: actor?.ip ?? null,
        userAgent: actor?.userAgent ?? null,
        details: {
          reason: "manual_clear",
        },
      },
    });
  });
};
