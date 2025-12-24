export const DISCOVERY_MAGIC = "OBD2";
export const DISCOVERY_PROTOCOL_VERSION = 1;
export const MSG_DISCOVER = 0x01;
export const MSG_ANNOUNCE = 0x02;
export const HEADER_LEN_V1 = 18;
export const HEADER_LEN_LEGACY = 16;

export const TLV_DEVICE_ID = 0x01;
export const TLV_FW_BUILD = 0x02;
export const TLV_UDP_PORT = 0x03;
export const TLV_CAPABILITIES = 0x04;
export const TLV_PROTO_VER = 0x05;
export const TLV_LAN_IP = 0x06;
export const TLV_PAIRING_STATE = 0x07;
export const TLV_PAIRING_NONCE = 0x08;

export type AnnouncePayload = {
  seq: number;
  deviceId?: string;
  fwBuild?: string;
  udpPort?: number;
  capabilities?: number;
  protoVer?: number;
  lanIp?: string;
  pairingState?: number;
  pairingNonce?: string;
};

export type AnnounceFields = Omit<AnnouncePayload, "seq">;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export const computeCrc32 = (buffer: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const writeHeader = (
  header: Buffer,
  payloadLen: number,
  seq: number,
  msgType: number,
  headerLen: number
) => {
  header.write(DISCOVERY_MAGIC, 0, "ascii");
  header.writeUInt8(DISCOVERY_PROTOCOL_VERSION, 4);
  header.writeUInt8(msgType, 5);
  header.writeUInt8(0, 6);
  header.writeUInt8(headerLen, 7);
  header.writeUInt16LE(payloadLen, 8);
  if (headerLen === HEADER_LEN_LEGACY) {
    header.writeUInt16LE(seq & 0xffff, 10);
    header.writeUInt32LE(0, 12);
    return;
  }
  header.writeUInt32LE(seq >>> 0, 10);
  header.writeUInt32LE(0, 14);
};

const finalizeHeaderCrc = (
  header: Buffer,
  payload: Buffer,
  headerLen: number
) => {
  const crcBuffer = Buffer.concat([header.slice(0, headerLen), payload]);
  const crc = computeCrc32(crcBuffer);
  if (headerLen === HEADER_LEN_LEGACY) {
    header.writeUInt32LE(crc >>> 0, 12);
    return;
  }
  header.writeUInt32LE(crc >>> 0, 14);
};

export const encodeDiscover = (seq: number) => {
  const payload = Buffer.alloc(0);
  const header = Buffer.alloc(HEADER_LEN_V1);
  writeHeader(header, payload.length, seq, MSG_DISCOVER, HEADER_LEN_V1);
  finalizeHeaderCrc(header, payload, HEADER_LEN_V1);
  return Buffer.concat([header, payload]);
};

export const encodeAnnounce = (seq: number, payload: AnnounceFields) => {
  const tlvs: Buffer[] = [];

  if (payload.deviceId) {
    const bytes = Buffer.from(payload.deviceId, "hex");
    tlvs.push(Buffer.from([TLV_DEVICE_ID, bytes.length]));
    tlvs.push(bytes);
  }
  if (payload.fwBuild) {
    const bytes = Buffer.from(payload.fwBuild, "utf8");
    tlvs.push(Buffer.from([TLV_FW_BUILD, bytes.length]));
    tlvs.push(bytes);
  }
  if (payload.udpPort !== undefined) {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(payload.udpPort);
    tlvs.push(Buffer.from([TLV_UDP_PORT, bytes.length]));
    tlvs.push(bytes);
  }
  if (payload.capabilities !== undefined) {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(payload.capabilities);
    tlvs.push(Buffer.from([TLV_CAPABILITIES, bytes.length]));
    tlvs.push(bytes);
  }
  if (payload.protoVer !== undefined) {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(payload.protoVer);
    tlvs.push(Buffer.from([TLV_PROTO_VER, bytes.length]));
    tlvs.push(bytes);
  }
  if (payload.lanIp) {
    const bytes = Buffer.from(payload.lanIp.split(".").map((octet) => Number(octet)));
    tlvs.push(Buffer.from([TLV_LAN_IP, bytes.length]));
    tlvs.push(bytes);
  }
  if (payload.pairingState !== undefined) {
    const bytes = Buffer.from([payload.pairingState]);
    tlvs.push(Buffer.from([TLV_PAIRING_STATE, bytes.length]));
    tlvs.push(bytes);
  }
  if (payload.pairingNonce) {
    const bytes = Buffer.from(payload.pairingNonce, "base64");
    tlvs.push(Buffer.from([TLV_PAIRING_NONCE, bytes.length]));
    tlvs.push(bytes);
  }

  const tlvPayload = Buffer.concat(tlvs);
  const header = Buffer.alloc(HEADER_LEN_V1);
  writeHeader(header, tlvPayload.length, seq, MSG_ANNOUNCE, HEADER_LEN_V1);
  finalizeHeaderCrc(header, tlvPayload, HEADER_LEN_V1);
  return Buffer.concat([header, tlvPayload]);
};

const parseHeader = (buffer: Buffer) => {
  if (buffer.length < HEADER_LEN_LEGACY) {
    throw new Error("Packet too short.");
  }

  const magic = buffer.toString("ascii", 0, 4);
  if (magic !== DISCOVERY_MAGIC) {
    throw new Error("Invalid magic.");
  }

  const proto = buffer.readUInt8(4);
  if (proto !== DISCOVERY_PROTOCOL_VERSION) {
    throw new Error("Unsupported protocol version.");
  }

  const msgType = buffer.readUInt8(5);
  const headerLen = buffer.readUInt8(7);
  const payloadLen = buffer.readUInt16LE(8);

  if (headerLen !== HEADER_LEN_V1 && headerLen !== HEADER_LEN_LEGACY) {
    throw new Error("Unsupported header length.");
  }

  if (buffer.length < headerLen + payloadLen) {
    throw new Error("Truncated packet.");
  }

  const seq = headerLen === HEADER_LEN_LEGACY ? buffer.readUInt16LE(10) : buffer.readUInt32LE(10);
  const crcOffset = headerLen === HEADER_LEN_LEGACY ? 12 : 14;
  const crc = buffer.readUInt32LE(crcOffset);

  return { msgType, headerLen, payloadLen, seq, crc, crcOffset };
};

export const decodeAnnounce = (buffer: Buffer): AnnouncePayload => {
  const header = parseHeader(buffer);
  if (header.msgType !== MSG_ANNOUNCE) {
    throw new Error("Not an ANNOUNCE packet.");
  }

  const headerCopy = Buffer.from(buffer.slice(0, header.headerLen));
  headerCopy.writeUInt32LE(0, header.crcOffset);
  const payload = buffer.slice(header.headerLen, header.headerLen + header.payloadLen);
  const computed = computeCrc32(Buffer.concat([headerCopy, payload]));
  if ((computed >>> 0) !== (header.crc >>> 0)) {
    throw new Error("CRC mismatch.");
  }

  const result: AnnouncePayload = { seq: header.seq };
  let offset = 0;

  while (offset + 2 <= payload.length) {
    const type = payload.readUInt8(offset);
    const length = payload.readUInt8(offset + 1);
    offset += 2;
    if (offset + length > payload.length) {
      break;
    }
    const value = payload.slice(offset, offset + length);
    offset += length;

    switch (type) {
      case TLV_DEVICE_ID:
        result.deviceId = value.toString("hex");
        break;
      case TLV_FW_BUILD:
        result.fwBuild = value.toString("utf8");
        break;
      case TLV_UDP_PORT:
        result.udpPort = value.readUInt16LE(0);
        break;
      case TLV_CAPABILITIES:
        result.capabilities = value.readUInt32LE(0);
        break;
      case TLV_PROTO_VER:
        result.protoVer = value.readUInt16LE(0);
        break;
      case TLV_LAN_IP:
        result.lanIp = Array.from(value).join(".");
        break;
      case TLV_PAIRING_STATE:
        result.pairingState = value.readUInt8(0);
        break;
      case TLV_PAIRING_NONCE:
        result.pairingNonce = value.toString("base64");
        break;
      default:
        break;
    }
  }

  return result;
};
