import { Buffer } from "buffer";
import {
  CommandStatusEvent,
  ErrorCodes,
  type CommandChunkMessage,
  type CommandResponseMessage,
  type CommandSource,
  type CommandTarget,
} from "@dashboard/shared";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";
import { sendControlRequest } from "../ws/control";
import { streamManager } from "./streams";

type CommandStatusDb = "queued" | "running" | "done" | "error" | "timeout";

type EnqueueInput = {
  command: unknown;
  args?: unknown;
  timeout_ms?: unknown;
  command_target?: unknown;
  command_source?: unknown;
  allow_dangerous?: unknown;
};

type CommandMeta = {
  actorIp?: string;
  actorUserAgent?: string;
};

type AllowlistEntry = {
  command: string;
  args?: string[];
  maxArgs?: number;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
};

export const AGENT_COMMAND_ALLOWLIST: AllowlistEntry[] = [
  { command: "ifconfig", maxArgs: 4, defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
  { command: "ip", maxArgs: 6, defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
  { command: "ping", maxArgs: 6, defaultTimeoutMs: 10000, maxTimeoutMs: 20000 },
];

export const DONGLE_COMMAND_ALLOWLIST: AllowlistEntry[] = [
  { command: "help", args: [], defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
  { command: "remote", args: ["status"], defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
  { command: "remote", args: ["stats"], defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
  { command: "can", args: ["cfg", "show"], defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
  { command: "discovery", args: ["status"], defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
  { command: "time", args: ["status"], defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
];

const COMMAND_OUTPUT_MAX_BYTES = 64 * 1024;

const commandTimers = new Map<string, NodeJS.Timeout>();

const isTerminal = (status: CommandStatusDb) => status === "done" || status === "error" || status === "timeout";

const toExternalStatus = (status: CommandStatusDb): CommandStatusEvent["status"] => {
  if (status === "done") return "ok";
  if (status === "timeout") return "timeout";
  if (status === "error") return "error";
  if (status === "running") return "running";
  return "queued";
};

const mapAgentStatusToDb = (status: unknown): CommandStatusDb => {
  if (typeof status !== "string") return "error";
  const value = status.toLowerCase();
  if (value === "running") return "running";
  if (value === "ok" || value === "done" || value === "success") return "done";
  if (value === "timeout" || value === "timed_out") return "timeout";
  if (value === "queued" || value === "pending") return "queued";
  return "error";
};

const normalizeArgs = (args: unknown) => {
  if (args === undefined) return [] as string[];
  if (!Array.isArray(args)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "args must be an array of strings.", 400);
  }
  const cleaned = args.map((arg) => {
    if (typeof arg !== "string") {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "args must be strings.", 400);
    }
    return arg;
  });
  return cleaned;
};

const clampTimeout = (requested: unknown, entry: AllowlistEntry) => {
  const min = 1000;
  const def = entry.defaultTimeoutMs ?? 5000;
  const max = entry.maxTimeoutMs ?? 15000;
  const numeric = typeof requested === "number" && Number.isFinite(requested) ? requested : def;
  return Math.min(Math.max(numeric, min), max);
};

const sameArgs = (left: string[] | undefined, right: string[]) => {
  if (!left) return true;
  if (left.length !== right.length) return false;
  return left.every((value, idx) => value === right[idx]);
};

const isDevMode = () => process.env.NODE_ENV !== "production";

const getAllowlistedCommand = (
  target: CommandTarget,
  name: string,
  args: string[],
  allowDangerous: boolean
) => {
  const normalized = name.trim().toLowerCase();
  if (target === "dongle") {
    if (allowDangerous && isDevMode()) {
      return { command: normalized, defaultTimeoutMs: 5000, maxTimeoutMs: 30000 };
    }
    const entry = DONGLE_COMMAND_ALLOWLIST.find(
      (item) => item.command === normalized && sameArgs(item.args, args)
    );
    if (!entry) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Command is not allowed.", 400);
    }
    return entry;
  }

  const entry = AGENT_COMMAND_ALLOWLIST.find((item) => item.command === normalized);
  if (!entry) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Command is not allowed.", 400);
  }
  if (typeof entry.maxArgs === "number" && args.length > entry.maxArgs) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Too many arguments for this command.", 400);
  }
  return entry;
};

const buildEventFromRecord = (record: {
  id: string;
  dongleId: string;
  status: CommandStatusDb;
  startedAt: Date | null;
  finishedAt: Date | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  commandTarget: CommandTarget;
  commandSource: CommandSource;
  truncated: boolean;
}): CommandStatusEvent => ({
  type: "command_status",
  command_id: record.id,
  status: toExternalStatus(record.status),
  started_at: record.startedAt ? record.startedAt.toISOString() : null,
  completed_at: record.finishedAt ? record.finishedAt.toISOString() : null,
  exit_code: record.exitCode ?? null,
  stdout: record.stdout || undefined,
  stderr: record.stderr || undefined,
  dongle_id: record.dongleId,
  command_target: record.commandTarget,
  command_source: record.commandSource,
  truncated: record.truncated,
});

const publishSse = (record: {
  id: string;
  dongleId: string;
  status: CommandStatusDb;
  startedAt: Date | null;
  finishedAt: Date | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  commandTarget: CommandTarget;
  commandSource: CommandSource;
  truncated: boolean;
}) => {
  const event = buildEventFromRecord(record);
  streamManager.publish(`dongle:${record.dongleId}`, "command_status", event);
};

const clearTimer = (commandId: string) => {
  const timer = commandTimers.get(commandId);
  if (timer) {
    clearTimeout(timer);
    commandTimers.delete(commandId);
  }
};

const scheduleTimeout = (commandId: string, dongleId: string, timeoutMs: number) => {
  clearTimer(commandId);
  const timer = setTimeout(async () => {
    try {
      const now = new Date();
      const updated = await prisma.command.updateMany({
        where: { id: commandId, status: { in: ["queued", "running"] } },
        data: { status: "timeout", finishedAt: now },
      });
      if (updated.count > 0) {
        const record = await prisma.command.findUnique({ where: { id: commandId } });
        if (record) {
          publishSse({
            id: record.id,
            dongleId,
            status: record.status as CommandStatusDb,
            startedAt: record.startedAt ?? null,
            finishedAt: record.finishedAt ?? null,
            exitCode: record.exitCode ?? null,
            stdout: record.stdout,
            stderr: record.stderr,
            commandTarget: record.commandTarget as CommandTarget,
            commandSource: record.commandSource as CommandSource,
            truncated: record.truncated,
          });
        }
      }
    } catch {
      // best-effort timeout
    } finally {
      clearTimer(commandId);
    }
  }, timeoutMs);
  commandTimers.set(commandId, timer);
};

export const enqueueCommand = async (
  dongleId: string,
  userId: string,
  isAdmin: boolean,
  payload: EnqueueInput,
  meta?: CommandMeta
) => {
  if (!payload || typeof payload.command !== "string" || !payload.command.trim()) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Command is required.", 400);
  }
  const commandTarget: CommandTarget =
    payload.command_target === "dongle" ? "dongle" : "agent";
  const commandSource: CommandSource = "web";
  const allowDangerous = payload.allow_dangerous === true;
  if (allowDangerous && (!isDevMode() || commandTarget !== "dongle")) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Dangerous commands are disabled.", 400);
  }

  const rawArgs = normalizeArgs(payload.args);
  const args = commandTarget === "dongle" ? rawArgs.map((arg) => arg.toLowerCase()) : rawArgs;
  const allowlist = getAllowlistedCommand(
    commandTarget,
    payload.command,
    args,
    allowDangerous
  );
  const timeoutMs = clampTimeout(payload.timeout_ms, allowlist);

  const dongle = await prisma.dongle.findUnique({ where: { id: dongleId } });
  if (!dongle) {
    throw new AppError(ErrorCodes.DONGLE_NOT_FOUND, "Dongle not found.", 404);
  }
  if (!isAdmin && dongle.ownerUserId !== userId) {
    throw new AppError(ErrorCodes.DONGLE_OWNED_BY_OTHER, "Dongle not owned by user.", 403);
  }

  const isOnline =
    dongle.lastSeenAgentId && dongle.lastSeenAt
      ? Date.now() - dongle.lastSeenAt.getTime() < 5 * 60 * 1000
      : false;
  if (!isOnline || !dongle.lastSeenAgentId) {
    throw new AppError(ErrorCodes.AGENT_OFFLINE, "Agent is offline.", 503);
  }

  const command = await prisma.command.create({
    data: {
      dongleId,
      userId,
      command: allowlist.command,
      commandTarget,
      commandSource,
      status: "queued",
    },
  });

  publishSse({
    id: command.id,
    dongleId,
    status: command.status as CommandStatusDb,
    startedAt: command.startedAt ?? null,
    finishedAt: command.finishedAt ?? null,
    exitCode: command.exitCode ?? null,
    stdout: command.stdout,
    stderr: command.stderr,
    commandTarget: command.commandTarget as CommandTarget,
    commandSource: command.commandSource as CommandSource,
    truncated: command.truncated,
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "COMMAND_ENQUEUED",
      targetType: "dongle",
      targetId: dongleId,
      ip: meta?.actorIp,
      userAgent: meta?.actorUserAgent,
      details: {
        command_id: command.id,
        command: allowlist.command,
        args,
        timeout_ms: timeoutMs,
        command_target: commandTarget,
        command_source: commandSource,
        allow_dangerous: allowDangerous,
      },
    },
  });

  scheduleTimeout(command.id, dongleId, timeoutMs);

  try {
    await sendControlRequest(dongle.lastSeenAgentId, {
      type: "command_request",
      command_id: command.id,
      dongle_id: dongleId,
      command: allowlist.command,
      args,
      timeout_ms: timeoutMs,
      command_target: commandTarget,
      command_source: commandSource,
      allow_dangerous: allowDangerous,
    });
  } catch (error) {
    clearTimer(command.id);
    await prisma.command.update({
      where: { id: command.id },
      data: { status: "error", finishedAt: new Date(), stderr: (error as Error).message ?? "" },
    });
    publishSse({
      id: command.id,
      dongleId,
      status: "error",
      startedAt: null,
      finishedAt: new Date(),
      exitCode: null,
      stdout: "",
      stderr: (error as Error).message ?? "Dispatch failed",
      commandTarget: command.commandTarget as CommandTarget,
      commandSource: command.commandSource as CommandSource,
      truncated: command.truncated,
    });
    throw new AppError(ErrorCodes.AGENT_OFFLINE, "Agent failed to accept command.", 503);
  }

  return { command_id: command.id, status: toExternalStatus(command.status as CommandStatusDb) };
};

export const getCommandForUser = async (
  dongleId: string,
  commandId: string,
  userId: string,
  isAdmin: boolean
) => {
  const command = await prisma.command.findUnique({ where: { id: commandId } });
  if (!command || command.dongleId !== dongleId) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Command not found.", 404);
  }
  const dongle = await prisma.dongle.findUnique({ where: { id: dongleId } });
  if (!dongle) {
    throw new AppError(ErrorCodes.DONGLE_NOT_FOUND, "Dongle not found.", 404);
  }
  if (!isAdmin && dongle.ownerUserId !== userId) {
    throw new AppError(ErrorCodes.DONGLE_OWNED_BY_OTHER, "Dongle not owned by user.", 403);
  }

  return {
    command_id: command.id,
    status: toExternalStatus(command.status as CommandStatusDb),
    started_at: command.startedAt ? command.startedAt.toISOString() : null,
    completed_at: command.finishedAt ? command.finishedAt.toISOString() : null,
    exit_code: command.exitCode ?? null,
    stdout: command.stdout,
    stderr: command.stderr,
    command_target: command.commandTarget as CommandTarget,
    command_source: command.commandSource as CommandSource,
    truncated: command.truncated,
  };
};

const sanitizeOutput = (value: string | undefined) => {
  if (!value) {
    return "";
  }
  return value.replace(/\u0000/g, "");
};

const clampOutputChunk = (base: string | undefined, chunk: string | undefined, remaining: number) => {
  const safeBase = base ?? "";
  const safeChunk = sanitizeOutput(chunk);
  if (!safeChunk) {
    return { value: safeBase, used: 0, truncated: false };
  }
  if (remaining <= 0) {
    return { value: safeBase, used: 0, truncated: true };
  }
  const buffer = Buffer.from(safeChunk, "utf8");
  if (buffer.length <= remaining) {
    return { value: safeBase + safeChunk, used: buffer.length, truncated: false };
  }
  const sliced = buffer.subarray(0, remaining).toString("utf8");
  return { value: safeBase + sliced, used: remaining, truncated: true };
};

export const handleAgentCommandUpdate = async (
  message: CommandResponseMessage | CommandChunkMessage
): Promise<boolean> => {
  const commandId = typeof message.command_id === "string" ? message.command_id : null;
  if (!commandId) {
    return false;
  }

  const command = await prisma.command.findUnique({ where: { id: commandId } });
  if (!command) {
    return false;
  }

  if (isTerminal(command.status as CommandStatusDb)) {
    return true;
  }

  const isChunk = message.type === "command_chunk";
  const decodedChunk =
    isChunk && typeof message.data === "string"
      ? (() => {
          try {
            return sanitizeOutput(Buffer.from(message.data, "base64").toString("utf8"));
          } catch {
            return sanitizeOutput(message.data);
          }
        })()
      : "";
  const stdoutChunk =
    isChunk && (message as CommandChunkMessage).stream === "stdout"
      ? decodedChunk
      : typeof (message as CommandResponseMessage).stdout === "string"
        ? sanitizeOutput((message as CommandResponseMessage).stdout)
        : "";
  const stderrChunk =
    isChunk && (message as CommandChunkMessage).stream === "stderr"
      ? decodedChunk
      : typeof (message as CommandResponseMessage).stderr === "string"
        ? sanitizeOutput((message as CommandResponseMessage).stderr)
        : "";
  const messageTruncated =
    typeof (message as CommandResponseMessage).truncated === "boolean"
      ? (message as CommandResponseMessage).truncated
      : typeof (message as CommandChunkMessage).truncated === "boolean"
        ? (message as CommandChunkMessage).truncated
        : false;

  const status = isChunk ? "running" : mapAgentStatusToDb((message as CommandResponseMessage).status);
  const exitCode =
    !isChunk && (typeof (message as CommandResponseMessage).exit_code === "number" || (message as CommandResponseMessage).exit_code === null)
      ? (message as CommandResponseMessage).exit_code
      : undefined;
  const startedAt =
    !isChunk && typeof (message as CommandResponseMessage).started_at === "string"
      ? new Date((message as CommandResponseMessage).started_at as string)
      : !isChunk && (message as CommandResponseMessage).started_at === null
        ? null
        : undefined;
  const completedAt =
    !isChunk && typeof (message as CommandResponseMessage).completed_at === "string"
      ? new Date((message as CommandResponseMessage).completed_at as string)
      : !isChunk && (message as CommandResponseMessage).completed_at === null
        ? null
        : undefined;

  const existingBytes =
    Buffer.byteLength(command.stdout, "utf8") + Buffer.byteLength(command.stderr, "utf8");
  let remaining = COMMAND_OUTPUT_MAX_BYTES - existingBytes;
  const stdoutResult = clampOutputChunk(command.stdout, stdoutChunk, remaining);
  remaining -= stdoutResult.used;
  const stderrResult = clampOutputChunk(command.stderr, stderrChunk, remaining);
  const truncated =
    command.truncated || messageTruncated || stdoutResult.truncated || stderrResult.truncated;

  const updated = await prisma.command.update({
    where: { id: commandId },
    data: {
      status,
      stdout: stdoutResult.value,
      stderr: stderrResult.value,
      truncated,
      exitCode: exitCode ?? command.exitCode,
      startedAt: startedAt !== undefined ? startedAt : command.startedAt ?? new Date(),
      finishedAt:
        completedAt !== undefined
          ? completedAt
          : isTerminal(status)
            ? new Date()
            : command.finishedAt,
    },
  });

  if (isTerminal(status)) {
    clearTimer(commandId);
  }

  publishSse({
    id: updated.id,
    dongleId: updated.dongleId,
    status: updated.status as CommandStatusDb,
    startedAt: updated.startedAt ?? null,
    finishedAt: updated.finishedAt ?? null,
    exitCode: updated.exitCode ?? null,
    stdout: updated.stdout,
    stderr: updated.stderr,
    commandTarget: updated.commandTarget as CommandTarget,
    commandSource: updated.commandSource as CommandSource,
    truncated: updated.truncated,
  });

  return true;
};

export const normalizeCommandStatus = (
  message: Record<string, unknown>
): (CommandStatusEvent & { dongle_id?: string; group_id?: string }) | null => {
  const commandId = typeof message.command_id === "string" ? message.command_id : null;
  if (!commandId) {
    return null;
  }
  const status = mapAgentStatusToDb(message.status);
  const startedAt =
    typeof message.started_at === "string" || message.started_at === null ? message.started_at : undefined;
  const completedAt =
    typeof message.completed_at === "string" || message.completed_at === null
      ? message.completed_at
      : undefined;
  const exitCode =
    typeof message.exit_code === "number" || message.exit_code === null ? message.exit_code : undefined;
  const stdout = typeof message.stdout === "string" ? message.stdout : undefined;
  const stderr = typeof message.stderr === "string" ? message.stderr : undefined;
  const dongleId = typeof message.dongle_id === "string" ? message.dongle_id : undefined;
  const groupId = typeof message.group_id === "string" ? message.group_id : undefined;
  const commandTarget =
    message.command_target === "agent" || message.command_target === "dongle"
      ? message.command_target
      : undefined;
  const commandSource =
    message.command_source === "web" || message.command_source === "agent" || message.command_source === "system"
      ? message.command_source
      : undefined;
  const truncated =
    typeof message.truncated === "boolean" ? message.truncated : undefined;

  return {
    type: "command_status",
    command_id: commandId,
    status: toExternalStatus(status),
    started_at: startedAt ?? undefined,
    completed_at: completedAt ?? undefined,
    exit_code: exitCode,
    stdout,
    stderr,
    dongle_id: dongleId,
    group_id: groupId,
    command_target: commandTarget,
    command_source: commandSource,
    truncated,
  };
};
