import { randomBytes, createHash } from "crypto";
import { prisma } from "../db";

const TOKEN_TTL_MS = 1000 * 60 * 60;

const hashToken = (token: string) => {
  return createHash("sha256").update(token).digest("hex");
};

export const createPasswordResetToken = async (userId: string) => {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const now = new Date();

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    }),
  ]);

  return { token, expiresAt };
};

export const consumePasswordResetToken = async (token: string) => {
  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.usedAt) {
    return { status: "invalid" as const };
  }

  if (record.expiresAt.getTime() < Date.now()) {
    return { status: "expired" as const };
  }

  return { status: "ok" as const, record };
};
