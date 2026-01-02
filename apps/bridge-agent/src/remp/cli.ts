import { randomUUID } from "crypto";
import {
  decodeCliResponse,
  decodeRempHeader,
  deviceIdToBytes,
  encodeCliRequest,
  encodeRempHeader,
  REMP_TYPE_CLI,
  type RempCliResponse,
} from "@dashboard/remp";
import type { RempTransport, RempTarget } from "./transport";
import { decodeDongleToken } from "./token";

export const sendDongleCliCommand = async (opts: {
  transport: RempTransport;
  target: RempTarget;
  deviceId: string;
  token: string;
  command: string;
  allowDangerous?: boolean;
  timeoutMs?: number;
}): Promise<RempCliResponse> => {
  const corrId = randomUUID();
  const payload = encodeCliRequest({
    corrId,
    command: opts.command,
    allowDangerous: opts.allowDangerous,
  });
  const header = encodeRempHeader({
    type: REMP_TYPE_CLI,
    deviceId: deviceIdToBytes(opts.deviceId),
    token: decodeDongleToken(opts.token),
  });
  const message = Buffer.concat([header, payload]);

  const response = await opts.transport.request({
    target: opts.target,
    message,
    timeoutMs: opts.timeoutMs ?? 5000,
    match: (respHeader, respPayload) => {
      if (respHeader.type !== REMP_TYPE_CLI) {
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

  const rempHeader = decodeRempHeader(response);
  if (rempHeader.type !== REMP_TYPE_CLI) {
    throw new Error("Unexpected CLI response type.");
  }
  const decoded = decodeCliResponse(response.subarray(rempHeader.payloadOffset));
  if (decoded.corrId !== corrId) {
    throw new Error("CLI corr_id mismatch.");
  }
  return decoded;
};
