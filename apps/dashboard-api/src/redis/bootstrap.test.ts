import { describe, expect, it, vi } from "vitest";

import {
  REDIS_SCHEMA_VERSION,
  REDIS_SCHEMA_VERSION_KEY,
  bootstrapRedis
} from "./bootstrap";

describe("bootstrapRedis", () => {
  it("sets schema version if missing", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      get: vi.fn().mockResolvedValue(REDIS_SCHEMA_VERSION)
    };

    const result = await bootstrapRedis(redis);

    expect(redis.set).toHaveBeenCalledWith(
      REDIS_SCHEMA_VERSION_KEY,
      REDIS_SCHEMA_VERSION,
      "NX"
    );
    expect(redis.get).toHaveBeenCalledWith(REDIS_SCHEMA_VERSION_KEY);
    expect(result.schemaVersion).toBe(REDIS_SCHEMA_VERSION);
  });

  it("throws when schema version cannot be read", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      get: vi.fn().mockResolvedValue(null)
    };

    await expect(bootstrapRedis(redis)).rejects.toThrow(
      "Redis bootstrap failed to persist schema version."
    );
  });
});
