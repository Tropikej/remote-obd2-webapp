import type { Request, Response, NextFunction } from "express";
import { ErrorCodes } from "@dashboard/shared";
import { AppError } from "../errors/app-error";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const requireCsrf = (req: Request, _res: Response, next: NextFunction) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const authHeader = req.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    next();
    return;
  }

  const token = req.get("X-CSRF-Token");
  const sessionToken = req.session?.csrfToken;

  if (!token || !sessionToken || token !== sessionToken) {
    next(new AppError(ErrorCodes.CSRF_INVALID, "Invalid CSRF token.", 403));
    return;
  }

  next();
};
