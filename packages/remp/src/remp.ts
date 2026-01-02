export const REMP_MAGIC = "REMP";
export const REMP_VERSION = 1;
export const REMP_HEADER_LEN = 31;

export const REMP_TYPE_CAN = 0;
export const REMP_TYPE_CAN_CONFIG = 2;
export const REMP_TYPE_PAIRING = 3;
export const REMP_TYPE_CLI = 4;

export const MAX_TOKEN_LEN = 64;

let rempSeq = 0;

const nextSeq = () => {
  rempSeq = (rempSeq + 1) >>> 0;
  return rempSeq;
};

export const uuidToBytes = (value: string) => {
  const normalized = value.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    throw new Error(`Invalid corr_id: ${value}`);
  }
  return Buffer.from(normalized, "hex");
};

export const bytesToUuid = (value: Buffer) => {
  const hex = value.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const deviceIdToBytes = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{16}$/.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }
  return Buffer.alloc(8);
};

export type RempHeader = {
  type: number;
  flags: number;
  tokenLen: number;
  fwBuild: number;
  deviceId: Buffer;
  seq: number;
  timestampUs: bigint;
  payloadOffset: number;
  token?: Buffer;
};

export const encodeRempHeader = (opts: {
  type: number;
  flags?: number;
  token?: Buffer;
  deviceId?: Buffer;
  fwBuild?: number;
  seq?: number;
  timestampUs?: bigint;
}) => {
  const token = opts.token ?? Buffer.alloc(0);
  if (token.length > MAX_TOKEN_LEN) {
    throw new Error("Token length exceeds maximum.");
  }
  const header = Buffer.alloc(REMP_HEADER_LEN + token.length);
  let offset = 0;
  header.write(REMP_MAGIC, offset, "ascii");
  offset += 4;
  header.writeUInt8(REMP_VERSION, offset++);
  header.writeUInt8(opts.type, offset++);
  header.writeUInt8(opts.flags ?? 0, offset++);
  header.writeUInt8(0, offset++);
  header.writeUInt8(token.length, offset++);
  header.writeUInt16BE(opts.fwBuild ?? 0, offset);
  offset += 2;
  const deviceId = opts.deviceId ?? Buffer.alloc(8);
  deviceId.copy(header, offset, 0, 8);
  offset += 8;
  header.writeUInt32BE(opts.seq ?? nextSeq(), offset);
  offset += 4;
  const timestamp = opts.timestampUs ?? BigInt(Date.now()) * 1000n;
  header.writeBigUInt64BE(timestamp, offset);
  offset += 8;
  if (token.length > 0) {
    token.copy(header, offset);
  }
  return header;
};

export const decodeRempHeader = (message: Buffer): RempHeader => {
  if (message.length < REMP_HEADER_LEN) {
    throw new Error("REMP message too short.");
  }
  const magic = message.subarray(0, 4).toString("ascii");
  if (magic !== REMP_MAGIC) {
    throw new Error("Invalid REMP magic.");
  }
  const version = message.readUInt8(4);
  if (version !== REMP_VERSION) {
    throw new Error(`Unsupported REMP version ${version}.`);
  }
  const type = message.readUInt8(5);
  const flags = message.readUInt8(6);
  const tokenLen = message.readUInt8(8);
  if (tokenLen > MAX_TOKEN_LEN) {
    throw new Error("REMP token length exceeds maximum.");
  }
  const fwBuild = message.readUInt16BE(9);
  const deviceId = message.subarray(11, 19);
  const seq = message.readUInt32BE(19);
  const timestampUs = message.readBigUInt64BE(23);
  const payloadOffset = REMP_HEADER_LEN + tokenLen;
  if (payloadOffset > message.length) {
    throw new Error("REMP payload offset exceeds message length.");
  }
  const token = tokenLen > 0 ? message.subarray(REMP_HEADER_LEN, payloadOffset) : undefined;
  return {
    type,
    flags,
    tokenLen,
    fwBuild,
    deviceId,
    seq,
    timestampUs,
    payloadOffset,
    token,
  };
};
