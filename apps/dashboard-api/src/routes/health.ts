import type { Request, Response } from "express";
import { prisma } from "../db";
import { getRedis } from "../redis/client";

const ok = { status: "ok", service: "dashboard-api" };

export const healthHandler = (_req: Request, res: Response) => {
  res.json(ok);
};

export const readyHandler = async (_req: Request, res: Response) => {
  const result: Record<string, string> = { service: "dashboard-api" };
  let hasError = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    result.db = "ok";
  } catch (error) {
    hasError = true;
    result.db = "error";
    result.db_error = (error as Error).message;
  }

  try {
    const redis = getRedis();
    const pong = await redis.ping();
    result.redis = pong === "PONG" ? "ok" : "error";
  } catch (error) {
    hasError = true;
    result.redis = "error";
    result.redis_error = (error as Error).message;
  }

  if (hasError) {
    res.status(503).json(result);
    return;
  }

  res.json(result);
};
