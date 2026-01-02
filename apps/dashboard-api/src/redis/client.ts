import Redis, { type Redis as RedisClient, type RedisOptions } from "ioredis";

let client: RedisClient | null = null;

export const getRedis = (): RedisClient => {
  if (client) {
    return client;
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is required for Redis-backed features.");
  }

  let options: RedisOptions | undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost") {
      options = { family: 4 };
    }
  } catch {
    options = undefined;
  }

  client = options ? new Redis(url, options) : new Redis(url);
  return client;
};

export const closeRedis = async () => {
  if (!client) {
    return;
  }
  await client.quit();
  client = null;
};
