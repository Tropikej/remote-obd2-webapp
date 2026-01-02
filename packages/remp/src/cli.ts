import { bytesToUuid, uuidToBytes } from "./remp";

export type RempCliRequest = {
  corrId: string;
  command: string;
  allowDangerous?: boolean;
};

export type RempCliResponse = {
  corrId: string;
  status: "ok" | "denied" | "error" | "timeout";
  truncated: boolean;
  exitCode: number;
  output: string;
};

const CLI_ACTION_REQUEST = 1;
const CLI_ACTION_RESPONSE = 2;

const mapStatus = (value: number): RempCliResponse["status"] => {
  if (value === 0) return "ok";
  if (value === 1) return "denied";
  if (value === 2) return "error";
  return "timeout";
};

export const encodeCliRequest = (req: RempCliRequest) => {
  const corr = uuidToBytes(req.corrId);
  const cmdBytes = Buffer.from(req.command, "utf8");
  if (cmdBytes.length > 0xffff) {
    throw new Error("CLI command too long.");
  }
  const payload = Buffer.alloc(1 + 1 + 2 + 16 + 2 + cmdBytes.length);
  let offset = 0;
  payload.writeUInt8(CLI_ACTION_REQUEST, offset++);
  payload.writeUInt8(req.allowDangerous ? 0x01 : 0x00, offset++);
  payload.writeUInt16BE(0, offset);
  offset += 2;
  corr.copy(payload, offset);
  offset += 16;
  payload.writeUInt16BE(cmdBytes.length, offset);
  offset += 2;
  cmdBytes.copy(payload, offset);
  return payload;
};

export const decodeCliResponse = (payload: Buffer): RempCliResponse => {
  if (payload.length < 1 + 1 + 1 + 1 + 16 + 2 + 2) {
    throw new Error("CLI response payload too short.");
  }
  const action = payload.readUInt8(0);
  if (action !== CLI_ACTION_RESPONSE) {
    throw new Error(`Unexpected CLI action ${action}.`);
  }
  const status = mapStatus(payload.readUInt8(1));
  const flags = payload.readUInt8(2);
  const truncated = (flags & 0x01) !== 0;
  const corrId = bytesToUuid(payload.subarray(4, 20));
  const exitCode = payload.readUInt16BE(20);
  const outLen = payload.readUInt16BE(22);
  if (payload.length < 24 + outLen) {
    throw new Error("CLI response output length mismatch.");
  }
  const output = payload.subarray(24, 24 + outLen).toString("utf8");
  return { corrId, status, truncated, exitCode, output };
};
