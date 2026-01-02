import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { getKeyForVersion, getKeyring } from "../config/keys";

export type DongleTokenAad = {
  dongleId: string;
  userId: string;
  createdAt: string;
};

export type DongleTokenEnvelope = {
  keyVersion: number;
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
};

const normalizeBase64 = (value: string) => {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  return padding ? normalized + "=".repeat(4 - padding) : normalized;
};

const aadToBuffer = (aad: DongleTokenAad) => {
  return Buffer.from(`${aad.dongleId}|${aad.userId}|${aad.createdAt}`, "utf8");
};

export const encryptDongleToken = (token: string, aad: DongleTokenAad, version?: number) => {
  const keyring = getKeyring();
  const keyVersion = version ?? keyring.defaultVersion;
  const key = getKeyForVersion(keyVersion);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);

  cipher.setAAD(aadToBuffer(aad));

  const tokenBytes = Buffer.from(normalizeBase64(token), "base64");
  const ciphertext = Buffer.concat([cipher.update(tokenBytes), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { keyVersion, nonce, ciphertext, tag };
};

export const decryptDongleToken = (envelope: DongleTokenEnvelope, aad: DongleTokenAad) => {
  const key = getKeyForVersion(envelope.keyVersion);
  const decipher = createDecipheriv("aes-256-gcm", key, envelope.nonce);
  decipher.setAAD(aadToBuffer(aad));
  decipher.setAuthTag(envelope.tag);

  const plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
  return plaintext.toString("base64");
};
