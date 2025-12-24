import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { ErrorCodes } from "@dashboard/shared";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";

const hashToken = (token: string) => {
  return createHash("sha256").update(token).digest("hex");
};

export const requireAgent = async (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    next(new AppError(ErrorCodes.AUTH_SESSION_EXPIRED, "Agent token missing.", 401));
    return;
  }

  const token = match[1];
  const tokenHash = hashToken(token);

  const agentToken = await prisma.agentToken.findFirst({
    where: { tokenHash, revokedAt: null },
    include: { agent: true },
  });

  if (!agentToken) {
    next(new AppError(ErrorCodes.AUTH_SESSION_EXPIRED, "Agent token invalid.", 401));
    return;
  }

  req.agent = { id: agentToken.agent.id, userId: agentToken.agent.userId };
  next();
};
