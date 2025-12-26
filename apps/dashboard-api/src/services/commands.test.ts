import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "@dashboard/shared";

const mocks = vi.hoisted(() => ({
  publishMock: vi.fn(),
  sendControlRequestMock: vi.fn(),
  prismaCommandMock: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  prismaDongleMock: { findUnique: vi.fn() },
  prismaAuditLogMock: { create: vi.fn() },
}));

vi.mock("./streams", () => ({
  streamManager: {
    publish: mocks.publishMock,
  },
}));

vi.mock("../ws/control", () => ({
  sendControlRequest: mocks.sendControlRequestMock,
}));

vi.mock("../db", () => ({
  prisma: {
    command: mocks.prismaCommandMock,
    dongle: mocks.prismaDongleMock,
    auditLog: mocks.prismaAuditLogMock,
  },
}));

const {
  publishMock,
  sendControlRequestMock,
  prismaAuditLogMock,
  prismaCommandMock,
  prismaDongleMock,
} = mocks;

import { enqueueCommand, handleAgentCommandUpdate, normalizeCommandStatus } from "./commands";

describe("commands service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publishMock.mockClear();
    sendControlRequestMock.mockReset();
    Object.values(prismaCommandMock).forEach((fn) => fn.mockReset());
    Object.values(prismaDongleMock).forEach((fn) => fn.mockReset());
    prismaAuditLogMock.create.mockReset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("rejects disallowed commands", async () => {
    await expect(
      enqueueCommand("dongle-1", "user-1", false, { command: "rm -rf /" })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it("enqueues command, logs audit, schedules timeout, and dispatches to agent", async () => {
    prismaDongleMock.findUnique.mockResolvedValue({
      id: "dongle-1",
      ownerUserId: "user-1",
      lastSeenAgentId: "agent-1",
      lastSeenAt: new Date(),
    });
    prismaCommandMock.create.mockResolvedValue({
      id: "cmd-1",
      dongleId: "dongle-1",
      userId: "user-1",
      command: "ifconfig",
      status: "queued",
      stdout: "",
      stderr: "",
      startedAt: null,
      finishedAt: null,
      exitCode: null,
    });
    sendControlRequestMock.mockResolvedValue({ type: "command_ack" });

    const result = await enqueueCommand(
      "dongle-1",
      "user-1",
      false,
      { command: "ifconfig", args: [], timeout_ms: 50 },
      { actorIp: "127.0.0.1", actorUserAgent: "vitest" }
    );

    expect(result).toEqual({ command_id: "cmd-1", status: "queued" });
    expect(prismaCommandMock.create).toHaveBeenCalled();
    expect(prismaAuditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "COMMAND_ENQUEUED",
          targetId: "dongle-1",
        }),
      })
    );
    expect(sendControlRequestMock).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        type: "command_request",
        command_id: "cmd-1",
        dongle_id: "dongle-1",
        command: "ifconfig",
        args: [],
        timeout_ms: expect.any(Number),
      })
    );
    expect(sendControlRequestMock.mock.calls[0]?.[1]?.timeout_ms).toBeGreaterThanOrEqual(1000);
    expect(publishMock).toHaveBeenCalledWith(
      "dongle:dongle-1",
      "command_status",
      expect.objectContaining({ status: "queued" })
    );
  });

  it("marks timeout when timer fires", async () => {
    prismaDongleMock.findUnique.mockResolvedValue({
      id: "dongle-1",
      ownerUserId: "user-1",
      lastSeenAgentId: "agent-1",
      lastSeenAt: new Date(),
    });
    prismaCommandMock.create.mockResolvedValue({
      id: "cmd-1",
      dongleId: "dongle-1",
      userId: "user-1",
      command: "ifconfig",
      status: "queued",
      stdout: "",
      stderr: "",
      startedAt: null,
      finishedAt: null,
      exitCode: null,
    });
    prismaCommandMock.updateMany.mockResolvedValue({ count: 1 });
    prismaCommandMock.findUnique.mockResolvedValue({
      id: "cmd-1",
      dongleId: "dongle-1",
      status: "timeout",
      startedAt: null,
      finishedAt: new Date(),
      exitCode: null,
      stdout: "",
      stderr: "",
    });
    sendControlRequestMock.mockResolvedValue({ type: "command_ack" });

    await enqueueCommand("dongle-1", "user-1", false, { command: "ifconfig", timeout_ms: 1 });

    await vi.runAllTimersAsync();

    expect(prismaCommandMock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "cmd-1" }) })
    );
    expect(publishMock).toHaveBeenCalledWith(
      "dongle:dongle-1",
      "command_status",
      expect.objectContaining({ status: "timeout" })
    );
  });

  it("updates command status from agent and publishes SSE", async () => {
    prismaCommandMock.findUnique.mockResolvedValue({
      id: "cmd-2",
      dongleId: "dongle-1",
      status: "queued",
      stdout: "",
      stderr: "",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
    });
    prismaCommandMock.update.mockResolvedValue({
      id: "cmd-2",
      dongleId: "dongle-1",
      status: "done",
      stdout: "out",
      stderr: "",
      exitCode: 0,
      startedAt: new Date("2024-01-01T00:00:00Z"),
      finishedAt: new Date("2024-01-01T00:00:01Z"),
    });

    const handled = await handleAgentCommandUpdate({
      type: "command_response",
      command_id: "cmd-2",
      status: "ok",
      stdout: "out",
      exit_code: 0,
      started_at: "2024-01-01T00:00:00Z",
      completed_at: "2024-01-01T00:00:01Z",
    });

    expect(handled).toBe(true);
    expect(prismaCommandMock.update).toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith(
      "dongle:dongle-1",
      "command_status",
      expect.objectContaining({ status: "ok", stdout: "out" })
    );
  });
});

describe("normalizeCommandStatus", () => {
  it("maps statuses to external shape", () => {
    const normalized = normalizeCommandStatus({
      command_id: "cmd-1",
      status: "done",
      stdout: "ok",
      stderr: "",
      dongle_id: "dongle-1",
    });
    expect(normalized).toEqual(
      expect.objectContaining({
        command_id: "cmd-1",
        status: "ok",
        stdout: "ok",
        stderr: "",
        dongle_id: "dongle-1",
      })
    );
  });
});
