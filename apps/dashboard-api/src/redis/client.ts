import Redis, { type Redis as RedisClient } from "ioredis";
import RedisMock from "ioredis-mock";

let client: RedisClient | null = null;

export const getRedis = (): RedisClient => {
  if (client) {
    return client;
  }

  const url = process.env.REDIS_URL;
  if (url) {
    client = new Redis(url);
    return client;
  }

  // Fallback to an in-memory mock to keep local tests runnable without Redis.
  console.warn("[redis] REDIS_URL not set, using in-memory mock (not for production).");
  client = new (RedisMock as unknown as typeof Redis)();
  return client;
};

export const closeRedis = async () => {
  if (!client) {
    return;
  }
  await client.quit();
  client = null;
};
