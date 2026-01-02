import rateLimit from "express-rate-limit";
import { ErrorCodes } from "@dashboard/shared";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message: string;
};

export const createRateLimiter = (options: RateLimitOptions) => {
  if (process.env.DISABLE_RATE_LIMITS === "true" || process.env.DISABLE_RATE_LIMITS === "1") {
    return (_req: any, _res: any, next: any) => next();
  }

  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: options.message,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === "string" ? req.body.email : "unknown";
      return `${req.ip}:${email}`;
    },
    handler: (req, res, _next, opts) => {
      res.status(opts.statusCode).json({
        code: ErrorCodes.RATE_LIMITED,
        message: typeof opts.message === "string" ? opts.message : "Too many requests.",
        details: { request_id: req.requestId },
      });
    },
  });
};
