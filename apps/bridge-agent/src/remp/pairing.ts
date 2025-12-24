import { randomUUID } from "crypto";
import {
  sendPairingModeStart,
  sendPairingSubmit,
  type PairingTarget,
} from "@dashboard/remp/pairing";

export type PairingModeStartResult = {
  expires_at?: string;
  pairing_nonce?: string;
};

export type PairingSubmitResult =
  | { status: "ok" }
  | { status: "invalid_pin" }
  | { status: "error"; message?: string };

export const startPairingMode = async (
  target: PairingTarget,
  dongleId: string
): Promise<PairingModeStartResult> => {
  const corrId = randomUUID();
  const response = await sendPairingModeStart(target, dongleId, corrId);
  return {
    expires_at: response.expiresAt,
    pairing_nonce: response.pairingNonce,
  };
};

export const submitPairing = async (
  target: PairingTarget,
  dongleId: string,
  pin: string,
  pairingNonce: string | undefined,
  dongleToken: string
): Promise<PairingSubmitResult> => {
  const corrId = randomUUID();
  const response = await sendPairingSubmit(target, dongleId, corrId, pin, pairingNonce, dongleToken);
  if (!response || response.status === "error") {
    return { status: "error", message: response?.message };
  }
  if (response.status === "invalid_pin") {
    return { status: "invalid_pin" };
  }
  return { status: "ok" };
};
