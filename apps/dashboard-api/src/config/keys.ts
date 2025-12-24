import { Buffer } from "buffer";

export type Keyring = {
  defaultVersion: number;
  keys: Map<number, Buffer>;
};

let cachedKeyring: Keyring | null = null;

const parseKeyEnv = (value: string, version: number) => {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error(`DONGLE_TOKEN_MASTER_KEY_V${version} must decode to 32 bytes.`);
  }
  return decoded;
};

export const getKeyring = () => {
  if (cachedKeyring) {
    return cachedKeyring;
  }

  const keys = new Map<number, Buffer>();

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^DONGLE_TOKEN_MASTER_KEY_V(\d+)$/);
    if (!match || !value) {
      continue;
    }
    const version = Number(match[1]);
    if (Number.isNaN(version)) {
      continue;
    }
    keys.set(version, parseKeyEnv(value, version));
  }

  if (keys.size === 0) {
    throw new Error("No dongle token master keys were found in environment variables.");
  }

  const envDefault = process.env.DONGLE_TOKEN_MASTER_KEY_DEFAULT_VERSION;
  const defaultVersion = envDefault ? Number(envDefault) : Math.max(...keys.keys());

  if (!keys.has(defaultVersion)) {
    throw new Error(
      `Default key version ${defaultVersion} is not present in DONGLE_TOKEN_MASTER_KEY_V* env vars.`
    );
  }

  cachedKeyring = { defaultVersion, keys };
  return cachedKeyring;
};

export const getKeyForVersion = (version: number) => {
  const keyring = getKeyring();
  const key = keyring.keys.get(version);
  if (!key) {
    throw new Error(`Missing dongle token master key for version ${version}.`);
  }
  return key;
};
