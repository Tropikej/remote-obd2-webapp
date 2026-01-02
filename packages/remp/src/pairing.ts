import dgram from "dgram";
import {
  bytesToUuid,
  decodeRempHeader,
  deviceIdToBytes,
  encodeRempHeader,
  uuidToBytes,
  REMP_TYPE_PAIRING,
} from "./remp";

export type PairingTarget = {
  host: string;
  port: number;
};

export type PairingAck = {
  status: "ok" | "invalid_pin" | "cooldown" | "error";
  expiresInS?: number;
  pairingNonce?: string;
  corrId: string;
};

const DEFAULT_TIMEOUT_MS = 5000;
const CORR_ID_LEN = 16;
const PAIRING_NONCE_LEN = 16;
const PAIRING_ACTION_START = 1;
const PAIRING_ACTION_SUBMIT = 2;
const PAIRING_ACTION_ACK = 3;
const TOKEN_LEN = 32;

const normalizeBase64 = (value: string) => {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  return padding ? normalized + "=".repeat(4 - padding) : normalized;
};

const decodeToken = (token: string) => {
  const normalized = normalizeBase64(token);
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length !== TOKEN_LEN) {
    throw new Error("Dongle token must be 32 bytes.");
  }
  return bytes;
};

const assertPin = (pin: string) => {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error("PIN must be 6 digits.");
  }
};

const decodePairingStatus = (value: number): PairingAck["status"] => {
  if (value === 0) return "ok";
  if (value === 1) return "invalid_pin";
  if (value === 2) return "cooldown";
  return "error";
};

export const encodePairingStart = (corrId: string) => {
  const corrBytes = uuidToBytes(corrId);
  const payload = Buffer.alloc(1 + 1 + 2 + CORR_ID_LEN);
  let offset = 0;
  payload.writeUInt8(PAIRING_ACTION_START, offset++);
  payload.writeUInt8(0, offset++);
  payload.writeUInt16BE(0, offset);
  offset += 2;
  corrBytes.copy(payload, offset, 0, CORR_ID_LEN);
  return payload;
};

export const encodePairingSubmit = (
  corrId: string,
  pin: string,
  pairingNonce: string,
  dongleToken: string
) => {
  assertPin(pin);
  const corrBytes = uuidToBytes(corrId);
  const nonceBytes = Buffer.from(pairingNonce, "base64");
  if (nonceBytes.length !== PAIRING_NONCE_LEN) {
    throw new Error("Pairing nonce must be 16 bytes.");
  }
  const tokenBytes = decodeToken(dongleToken);

  const payload = Buffer.alloc(1 + 1 + 2 + CORR_ID_LEN + 6 + PAIRING_NONCE_LEN + 1 + tokenBytes.length);
  let offset = 0;
  payload.writeUInt8(PAIRING_ACTION_SUBMIT, offset++);
  payload.writeUInt8(0, offset++);
  payload.writeUInt16BE(0, offset);
  offset += 2;
  corrBytes.copy(payload, offset, 0, CORR_ID_LEN);
  offset += CORR_ID_LEN;
  payload.write(pin, offset, "ascii");
  offset += 6;
  nonceBytes.copy(payload, offset);
  offset += PAIRING_NONCE_LEN;
  payload.writeUInt8(tokenBytes.length, offset++);
  tokenBytes.copy(payload, offset);
  return payload;
};

export const decodePairingAck = (message: Buffer): PairingAck => {
  const { type, payloadOffset } = decodeRempHeader(message);
  if (type !== REMP_TYPE_PAIRING) {
    throw new Error(`Unexpected REMP message type ${type}.`);
  }
  const payload = message.subarray(payloadOffset);
  if (payload.length < 1 + 1 + 2 + CORR_ID_LEN) {
    throw new Error("Pairing ACK payload too short.");
  }
  const action = payload.readUInt8(0);
  if (action !== PAIRING_ACTION_ACK) {
    throw new Error(`Unexpected pairing action ${action}.`);
  }
  const status = decodePairingStatus(payload.readUInt8(1));
  const seconds = payload.readUInt16BE(2);
  const corrId = bytesToUuid(payload.subarray(4, 4 + CORR_ID_LEN));
  let pairingNonce: string | undefined;
  if (payload.length >= 4 + CORR_ID_LEN + PAIRING_NONCE_LEN) {
    const nonceOffset = 4 + CORR_ID_LEN;
    pairingNonce = payload.subarray(nonceOffset, nonceOffset + PAIRING_NONCE_LEN).toString("base64");
  }
  return {
    status,
    expiresInS: seconds > 0 ? seconds : undefined,
    pairingNonce,
    corrId,
  };
};

const sendUdpRequest = async (
  target: PairingTarget,
  message: Buffer,
  timeoutMs = DEFAULT_TIMEOUT_MS
) => {
  const socket = dgram.createSocket("udp4");

  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Pairing UDP request timed out"));
    }, timeoutMs);

    socket.once("error", (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.once("message", (msg) => {
      clearTimeout(timer);
      socket.close();
      resolve(msg);
    });

    socket.send(message, target.port, target.host, (err) => {
      if (err) {
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
};

export const sendPairingModeStartBinary = async (
  target: PairingTarget,
  dongleId: string,
  corrId: string
): Promise<PairingAck> => {
  const payload = encodePairingStart(corrId);
  const header = encodeRempHeader({ type: REMP_TYPE_PAIRING, deviceId: deviceIdToBytes(dongleId) });
  const response = await sendUdpRequest(target, Buffer.concat([header, payload]));
  const decoded = decodePairingAck(response);
  if (decoded.corrId !== corrId) {
    throw new Error("Pairing ACK corr_id mismatch.");
  }
  return decoded;
};

export const sendPairingSubmitBinary = async (
  target: PairingTarget,
  dongleId: string,
  corrId: string,
  pin: string,
  pairingNonce: string,
  dongleToken: string
): Promise<PairingAck> => {
  const payload = encodePairingSubmit(corrId, pin, pairingNonce, dongleToken);
  const header = encodeRempHeader({ type: REMP_TYPE_PAIRING, deviceId: deviceIdToBytes(dongleId) });
  const response = await sendUdpRequest(target, Buffer.concat([header, payload]));
  const decoded = decodePairingAck(response);
  if (decoded.corrId !== corrId) {
    throw new Error("Pairing ACK corr_id mismatch.");
  }
  return decoded;
};
