import type { CanConfigApplyRequest } from "@dashboard/shared/protocols/can-config";
import {
  decodeRempHeader,
  decodeCanConfigResponse,
  encodeCanConfigRequest,
  encodeRempHeader,
  deviceIdToBytes,
  REMP_TYPE_CAN_CONFIG,
  type RempCanConfig,
} from "@dashboard/remp";
import type { RempTransport, RempTarget } from "./transport";
import { decodeDongleToken } from "./token";

type ApplyCanConfigResult = {
  effective: CanConfigApplyRequest;
};

const MODE_TO_RAW: Record<CanConfigApplyRequest["mode"], number> = {
  normal: 0,
  listen_only: 1,
  loopback: 2,
  ext_loop: 3,
};

const RAW_TO_MODE: Record<number, CanConfigApplyRequest["mode"]> = {
  0: "normal",
  1: "listen_only",
  2: "loopback",
  3: "ext_loop",
};

const toRempConfig = (config: CanConfigApplyRequest): RempCanConfig => ({
  bitrate: config.bitrate,
  samplePointPermille: config.sample_point_permille,
  prescaler: config.prescaler,
  sjw: config.sjw,
  tseg1: config.tseg1,
  tseg2: config.tseg2,
  mode: MODE_TO_RAW[config.mode],
  useRaw: config.use_raw,
  autoRetx: config.auto_retx,
  txPause: config.tx_pause,
  protocolExc: config.protocol_exc,
});

const fromRempConfig = (config: RempCanConfig): CanConfigApplyRequest => ({
  bitrate: config.bitrate,
  sample_point_permille: config.samplePointPermille,
  prescaler: config.prescaler,
  sjw: config.sjw,
  tseg1: config.tseg1,
  tseg2: config.tseg2,
  mode: RAW_TO_MODE[config.mode] ?? "normal",
  use_raw: config.useRaw,
  auto_retx: config.autoRetx,
  tx_pause: config.txPause,
  protocol_exc: config.protocolExc,
});

export const applyCanConfigToDongle = async (
  transport: RempTransport,
  target: RempTarget,
  deviceId: string,
  token: string,
  tokenBytes: Buffer | undefined,
  config: CanConfigApplyRequest,
  timeoutMs = 5000
): Promise<ApplyCanConfigResult> => {
  const payload = encodeCanConfigRequest("set", toRempConfig(config));
  const header = encodeRempHeader({
    type: REMP_TYPE_CAN_CONFIG,
    deviceId: deviceIdToBytes(deviceId),
    token: tokenBytes ?? decodeDongleToken(token),
  });
  const message = Buffer.concat([header, payload]);
  const response = await transport.request({
    target,
    message,
    timeoutMs,
    match: (respHeader) =>
      respHeader.type === REMP_TYPE_CAN_CONFIG &&
      respHeader.deviceId.toString("hex") === deviceId.toLowerCase(),
  });
  const responseHeader = decodeRempHeader(response);
  if (responseHeader.type !== REMP_TYPE_CAN_CONFIG) {
    throw new Error("Unexpected CAN config response type.");
  }
  const responsePayload = response.subarray(responseHeader.payloadOffset);
  const decoded = decodeCanConfigResponse(responsePayload);
  if (decoded.status !== "ok") {
    throw new Error(`CAN config rejected: ${decoded.status}`);
  }
  return { effective: fromRempConfig(decoded.config) };
};
