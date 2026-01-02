"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeRempHeader = exports.encodeRempHeader = exports.deviceIdToBytes = exports.bytesToUuid = exports.uuidToBytes = exports.MAX_TOKEN_LEN = exports.REMP_TYPE_CLI = exports.REMP_TYPE_PAIRING = exports.REMP_TYPE_CAN_CONFIG = exports.REMP_TYPE_CAN = exports.REMP_HEADER_LEN = exports.REMP_VERSION = exports.REMP_MAGIC = void 0;
exports.REMP_MAGIC = "REMP";
exports.REMP_VERSION = 1;
exports.REMP_HEADER_LEN = 31;
exports.REMP_TYPE_CAN = 0;
exports.REMP_TYPE_CAN_CONFIG = 2;
exports.REMP_TYPE_PAIRING = 3;
exports.REMP_TYPE_CLI = 4;
exports.MAX_TOKEN_LEN = 64;
let rempSeq = 0;
const nextSeq = () => {
    rempSeq = (rempSeq + 1) >>> 0;
    return rempSeq;
};
const uuidToBytes = (value) => {
    const normalized = value.replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(normalized)) {
        throw new Error(`Invalid corr_id: ${value}`);
    }
    return Buffer.from(normalized, "hex");
};
exports.uuidToBytes = uuidToBytes;
const bytesToUuid = (value) => {
    const hex = value.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
exports.bytesToUuid = bytesToUuid;
const deviceIdToBytes = (value) => {
    const normalized = value.trim().toLowerCase();
    if (/^[0-9a-f]{16}$/.test(normalized)) {
        return Buffer.from(normalized, "hex");
    }
    return Buffer.alloc(8);
};
exports.deviceIdToBytes = deviceIdToBytes;
const encodeRempHeader = (opts) => {
    const token = opts.token ?? Buffer.alloc(0);
    if (token.length > exports.MAX_TOKEN_LEN) {
        throw new Error("Token length exceeds maximum.");
    }
    const header = Buffer.alloc(exports.REMP_HEADER_LEN + token.length);
    let offset = 0;
    header.write(exports.REMP_MAGIC, offset, "ascii");
    offset += 4;
    header.writeUInt8(exports.REMP_VERSION, offset++);
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
exports.encodeRempHeader = encodeRempHeader;
const decodeRempHeader = (message) => {
    if (message.length < exports.REMP_HEADER_LEN) {
        throw new Error("REMP message too short.");
    }
    const magic = message.subarray(0, 4).toString("ascii");
    if (magic !== exports.REMP_MAGIC) {
        throw new Error("Invalid REMP magic.");
    }
    const version = message.readUInt8(4);
    if (version !== exports.REMP_VERSION) {
        throw new Error(`Unsupported REMP version ${version}.`);
    }
    const type = message.readUInt8(5);
    const flags = message.readUInt8(6);
    const tokenLen = message.readUInt8(8);
    if (tokenLen > exports.MAX_TOKEN_LEN) {
        throw new Error("REMP token length exceeds maximum.");
    }
    const fwBuild = message.readUInt16BE(9);
    const deviceId = message.subarray(11, 19);
    const seq = message.readUInt32BE(19);
    const timestampUs = message.readBigUInt64BE(23);
    const payloadOffset = exports.REMP_HEADER_LEN + tokenLen;
    if (payloadOffset > message.length) {
        throw new Error("REMP payload offset exceeds message length.");
    }
    const token = tokenLen > 0 ? message.subarray(exports.REMP_HEADER_LEN, payloadOffset) : undefined;
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
exports.decodeRempHeader = decodeRempHeader;
