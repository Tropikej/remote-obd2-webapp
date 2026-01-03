import { Router } from "express";
import { ErrorCodes } from "@dashboard/shared";
import { requireRole } from "../middleware/auth";
import { AppError } from "../errors/app-error";
import { prisma } from "../db";
import { sendCanFrame } from "../services/can-send";
import { streamManager } from "../services/streams";

type BenchmarkMode = "ordered" | "fuzz";

type BenchmarkSendPayload = {
  mode?: unknown;
  delay_ms?: unknown;
  can_id?: unknown;
  dlc?: unknown;
  is_extended?: unknown;
  bus?: unknown;
};

const router = Router();

const MAX_STD_ID = 0x7ff;
const MAX_EXT_ID = 0x1fffffff;
const DEFAULT_DLC = 8;

const orderedState = new Map<string, number[]>();

const asyncHandler =
  (handler: (req: any, res: any, next: any) => Promise<void>) =>
  (req: any, res: any, next: any) => {
    handler(req, res, next).catch(next);
  };

const writeEvent = (res: any, event: { id: number; type: string; data: unknown }) => {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
};

const parseLastEventId = (value: string | undefined) => {
  if (!value) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
};

const normalizeMode = (value: unknown): BenchmarkMode => {
  if (value === "ordered" || value === "fuzz") {
    return value;
  }
  throw new AppError(ErrorCodes.VALIDATION_ERROR, "mode must be ordered or fuzz.", 400);
};

const normalizeDelay = (value: unknown) => {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "delay_ms must be a number.", 400);
  }
  if (value < 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "delay_ms must be >= 0.", 400);
  }
  return Math.floor(value);
};

const normalizeDlc = (value: unknown) => {
  if (value === undefined || value === null) return DEFAULT_DLC;
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "dlc must be a number.", 400);
  }
  const dlc = Math.floor(value);
  if (dlc < 0 || dlc > 8) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "dlc must be between 0 and 8.", 400);
  }
  return dlc;
};

const normalizeCanKey = (value: string) => value.trim().toLowerCase().replace(/^0x/, "");

const incrementPayload = (payload: number[]) => {
  const next = [...payload];
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] < 0xff) {
      next[i] += 1;
      return next;
    }
    next[i] = 0x00;
  }
  return next;
};

const toHex = (payload: number[]) =>
  payload.map((byte) => byte.toString(16).padStart(2, "0")).join("");

const randomByte = () => Math.floor(Math.random() * 256);

const randomCanId = (isExtended: boolean) => {
  const max = isExtended ? MAX_EXT_ID : MAX_STD_ID;
  return Math.floor(Math.random() * (max + 1));
};

router.post(
  "/dongles/:id/send",
  requireRole("super_admin"),
  asyncHandler(async (req, res) => {
    const payload = (req.body ?? {}) as BenchmarkSendPayload;
    const mode = normalizeMode(payload.mode);
    const delayMs = normalizeDelay(payload.delay_ms);
    const dlc = normalizeDlc(payload.dlc);
    const isExtended = typeof payload.is_extended === "boolean" ? payload.is_extended : false;
    const bus = typeof payload.bus === "string" ? payload.bus : undefined;

    let canId = "";
    let dataHex = "";
    let resolvedExtended = isExtended;

    if (mode === "ordered") {
      if (typeof payload.can_id !== "string" || !payload.can_id.trim()) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "can_id is required for ordered mode.", 400);
      }
      canId = payload.can_id.trim();
      const key = `${req.params.id}:${normalizeCanKey(canId)}:${dlc}`;
      const previous = orderedState.get(key);
      const nextPayload = previous ? incrementPayload(previous) : new Array(dlc).fill(0);
      orderedState.set(key, nextPayload);
      dataHex = toHex(nextPayload);
    } else {
      const fuzzId = randomCanId(isExtended);
      canId = `0x${fuzzId.toString(16)}`;
      const nextPayload = new Array(dlc).fill(0).map(() => randomByte());
      dataHex = toHex(nextPayload);
      resolvedExtended = isExtended;
    }

    const result = await sendCanFrame(req.params.id, req.user!.id, true, {
      can_id: canId,
      is_extended: resolvedExtended,
      data_hex: dataHex,
      bus,
    });

    res.json({
      ...result,
      frame: {
        mode,
        delay_ms: delayMs,
        can_id: canId,
        is_extended: resolvedExtended,
        dlc,
        data_hex: dataHex,
        bus,
      },
    });
  })
);

router.get(
  "/dongles/:id/stream",
  requireRole("super_admin"),
  asyncHandler(async (req, res) => {
    const dongle = await prisma.dongle.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!dongle) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const lastEventId = parseLastEventId(req.header("Last-Event-ID"));
    const streamKey = `dongle:${dongle.id}`;
    const subscription = streamManager.subscribe(streamKey, lastEventId, (event) =>
      writeEvent(res, event)
    );

    const heartbeat = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
    });
  })
);

export const benchmarkRouter = router;
