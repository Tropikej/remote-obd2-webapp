import type { Redis as RedisClient } from "ioredis";

export const REDIS_SCHEMA_VERSION_KEY = "dashboard:redis:schema_version";
export const REDIS_SCHEMA_VERSION = "1";

export type RedisBootstrapClient = Pick<RedisClient, "get" | "set">;

export const bootstrapRedis = async (redis: RedisBootstrapClient) => {
  const setResult = await redis.set(
    REDIS_SCHEMA_VERSION_KEY,
    REDIS_SCHEMA_VERSION,
    "NX"
  );
  const schemaVersion = await redis.get(REDIS_SCHEMA_VERSION_KEY);

  if (!schemaVersion) {
    throw new Error("Redis bootstrap failed to persist schema version.");
  }

  return { setResult, schemaVersion };
};
