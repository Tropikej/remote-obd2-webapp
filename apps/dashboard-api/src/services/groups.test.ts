import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./streams", () => {
  return {
    streamManager: { publish: vi.fn() },
  };
});

vi.mock("../redis/client", () => {
  const mockRedis = {
    xlen: vi.fn<Promise<number>, [string]>(),
  };
  return {
    getRedis: () => mockRedis,
  };
});

vi.mock("../db", () => {
  const mockPrisma = {
    dongleGroup: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

import { prisma } from "../db";
import { getRedis } from "../redis/client";
import { streamManager } from "./streams";
import { markGroupMode } from "./groups";

const publishMock = streamManager.publish as unknown as ReturnType<typeof vi.fn>;
const redisMock = getRedis() as unknown as { xlen: ReturnType<typeof vi.fn> };
const prismaMock = prisma as unknown as {
  dongleGroup: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

describe("markGroupMode", () => {
  beforeEach(() => {
    publishMock.mockClear();
    redisMock.xlen.mockReset();
    prismaMock.dongleGroup.findUnique.mockReset();
    prismaMock.dongleGroup.update.mockReset();
  });

  it("updates mode and publishes backlog metrics with offline side", async () => {
    prismaMock.dongleGroup.findUnique.mockResolvedValue({
      id: "group-1",
      mode: "ACTIVE",
    });
    prismaMock.dongleGroup.update.mockResolvedValue({
      id: "group-1",
      mode: "DEGRADED",
    });
    redisMock.xlen.mockResolvedValueOnce(3).mockResolvedValueOnce(5);

    const result = await markGroupMode("group-1", "DEGRADED", { offlineSide: "B" });

    expect(result?.mode).toBe("DEGRADED");
    expect(prismaMock.dongleGroup.update).toHaveBeenCalled();
    expect(redisMock.xlen).toHaveBeenNthCalledWith(1, "group:group-1:a_to_b");
    expect(redisMock.xlen).toHaveBeenNthCalledWith(2, "group:group-1:b_to_a");
    expect(publishMock).toHaveBeenCalledWith(
      "group:group-1",
      "group_state",
      expect.objectContaining({
        buffered_frames_a_to_b: 3,
        buffered_frames_b_to_a: 5,
        offline_side: "B",
        mode: "DEGRADED",
      })
    );
  });

  it("publishes metrics even when mode is unchanged", async () => {
    prismaMock.dongleGroup.findUnique.mockResolvedValue({
      id: "group-2",
      mode: "ACTIVE",
    });
    redisMock.xlen.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const result = await markGroupMode("group-2", "ACTIVE");

    expect(result?.mode).toBe("ACTIVE");
    expect(prismaMock.dongleGroup.update).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith(
      "group:group-2",
      "group_state",
      expect.objectContaining({
        buffered_frames_a_to_b: 0,
        buffered_frames_b_to_a: 1,
        offline_side: null,
        mode: "ACTIVE",
      })
    );
  });
});
