import { randomUUID } from "crypto";
import {
  decodePairingAck,
  deviceIdToBytes,
  encodePairingStart,
  encodePairingSubmit,
  encodeRempHeader,
  REMP_TYPE_PAIRING,
  type PairingTarget,
} from "@dashboard/remp";
import type { RempTransport } from "./transport";

export type PairingModeStartResult = {
  status: "ok" | "cooldown" | "error";
  expires_at?: string;
  expires_in_s?: number;
  pairing_nonce?: string;
};

export type PairingSubmitResult =
  | { status: "ok" }
  | { status: "invalid_pin" }
  | { status: "cooldown"; expires_in_s?: number }
  | { status: "error"; message?: string };

export const startPairingMode = async (
  transport: RempTransport,
  target: PairingTarget,
  deviceId: string
): Promise<PairingModeStartResult> => {
  const corrId = randomUUID();
  const payload = encodePairingStart(corrId);
  const header = encodeRempHeader({
    type: REMP_TYPE_PAIRING,
    deviceId: deviceIdToBytes(deviceId),
  });
  const message = Buffer.concat([header, payload]);
  const response = await transport.request({
    target,
    message,
    timeoutMs: 5000,
    match: (respHeader, respPayload) => {
      if (respHeader.type !== REMP_TYPE_PAIRING) {
        return false;
      }
      if (respPayload.length < 20) {
        return false;
      }
      const corrOffset = 4;
      const corr = respPayload.subarray(corrOffset, corrOffset + 16).toString("hex");
      return corr === corrId.replace(/-/g, "");
    },
  });
  const decoded = decodePairingAck(response);
  if (decoded.corrId !== corrId) {
    throw new Error("Pairing corr_id mismatch.");
  }
  const status = decoded.status === "invalid_pin" ? "error" : decoded.status;
  const expiresAt = decoded.expiresInS
    ? new Date(Date.now() + decoded.expiresInS * 1000).toISOString()
    : undefined;
  return {
    status,
    expires_at: expiresAt,
    expires_in_s: decoded.expiresInS,
    pairing_nonce: decoded.pairingNonce,
  };
};

export const submitPairing = async (
  transport: RempTransport,
  target: PairingTarget,
  deviceId: string,
  pin: string,
  pairingNonce: string | undefined,
  dongleToken: string
): Promise<PairingSubmitResult> => {
  const corrId = randomUUID();
  if (!pairingNonce) {
    return { status: "error", message: "Pairing nonce missing." };
  }
  const payload = encodePairingSubmit(corrId, pin, pairingNonce, dongleToken);
  const header = encodeRempHeader({
    type: REMP_TYPE_PAIRING,
    deviceId: deviceIdToBytes(deviceId),
  });
  const message = Buffer.concat([header, payload]);
  const response = await transport.request({
    target,
    message,
    timeoutMs: 5000,
    match: (respHeader, respPayload) => {
      if (respHeader.type !== REMP_TYPE_PAIRING) {
        return false;
      }
      if (respPayload.length < 20) {
        return false;
      }
      const corrOffset = 4;
      const corr = respPayload.subarray(corrOffset, corrOffset + 16).toString("hex");
      return corr === corrId.replace(/-/g, "");
    },
  });
  const decoded = decodePairingAck(response);
  if (decoded.corrId !== corrId) {
    throw new Error("Pairing corr_id mismatch.");
  }
  if (!decoded || decoded.status === "error") {
    return { status: "error", message: "Pairing failed." };
  }
  if (decoded.status === "invalid_pin") {
    return { status: "invalid_pin" };
  }
  if (decoded.status === "cooldown") {
    return { status: "cooldown", expires_in_s: decoded.expiresInS };
  }
  return { status: "ok" };
};
