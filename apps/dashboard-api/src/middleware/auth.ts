import type { Request, Response, NextFunction } from "express";
import { ErrorCodes } from "@dashboard/shared";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";

export const attachUser = async (req: Request, _res: Response, next: NextFunction) => {
  const userId = req.session?.userId;

  if (!userId) {
    next();
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    req.session.userId = undefined;
    next();
    return;
  }

  req.user = {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  };

  next();
};

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) {
    next(new AppError(ErrorCodes.AUTH_SESSION_EXPIRED, "Session expired.", 401));
    return;
  }

  if (req.user.status !== "active") {
    next(new AppError(ErrorCodes.AUTH_USER_DISABLED, "User is disabled.", 403));
    return;
  }

  next();
};

export const requireRole = (role: "super_admin") => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new AppError(ErrorCodes.AUTH_SESSION_EXPIRED, "Session expired.", 401));
      return;
    }

    if (req.user.role !== role) {
      next(new AppError(ErrorCodes.VALIDATION_ERROR, "Insufficient role.", 403));
      return;
    }

    next();
  };
};
