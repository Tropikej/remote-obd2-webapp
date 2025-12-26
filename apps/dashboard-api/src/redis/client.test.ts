import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("ioredis", () => {
  class MockRedis {
    url: string;
    constructor(url: string) {
      this.url = url;
      mocks.create(url);
    }
    ping() {
      return Promise.resolve("PONG");
    }
    quit() {
      return Promise.resolve();
    }
  }
  return {
    default: MockRedis,
  };
});

describe("redis client", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    delete process.env.REDIS_URL;
    vi.resetModules();
  });

  it("throws when REDIS_URL is missing", async () => {
    const { getRedis } = await import("./client");
    expect(() => getRedis()).toThrow("REDIS_URL is required");
  });

  it("creates a redis client when REDIS_URL is set", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const { getRedis } = await import("./client");
    const client = getRedis() as { url?: string };
    expect(client.url).toBe("redis://localhost:6379");
    expect(mocks.create).toHaveBeenCalledWith("redis://localhost:6379");
  });
});
