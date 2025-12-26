import Redis, { type Redis as RedisClient } from "ioredis";

let client: RedisClient | null = null;

export const getRedis = (): RedisClient => {
  if (client) {
    return client;
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is required for Redis-backed features.");
  }

  client = new Redis(url);
  return client;
};

export const closeRedis = async () => {
  if (!client) {
    return;
  }
  await client.quit();
  client = null;
};
