import type { Request, Response, NextFunction } from "express";
import { ErrorCodes } from "@dashboard/shared";
import { AppError } from "../errors/app-error";

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestId = req.requestId ?? "unknown";

  if (err instanceof AppError) {
    const details = { ...err.details, request_id: requestId };
    res.status(err.status).json({ code: err.code, message: err.message, details });
    return;
  }

  console.error(`[error] request_id=${requestId}`, err);
  res.status(500).json({
    code: ErrorCodes.INTERNAL_ERROR,
    message: "Unexpected error.",
    details: { request_id: requestId },
  });
};
