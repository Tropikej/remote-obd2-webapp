"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeCanConfigResponse = exports.encodeCanConfigRequest = exports.decodeCanFrame = exports.encodeCanFrame = void 0;
const MAX_CAN_ID = 0x1fffffff;
const MAX_STD_ID = 0x7ff;
const encodeCanFrame = (frame) => {
    const dlc = frame.data.length;
    if (dlc > 8) {
        throw new Error("CAN payload too large.");
    }
    const isExtended = frame.isExtended;
    if (isExtended && frame.canId > MAX_CAN_ID) {
        throw new Error("Extended CAN id out of range.");
    }
    if (!isExtended && frame.canId > MAX_STD_ID) {
        throw new Error("Standard CAN id out of range.");
    }
    const canId = (isExtended ? 0x80000000 : 0) | (frame.canId & (isExtended ? MAX_CAN_ID : MAX_STD_ID));
    const flags = (frame.simulated ? 0x01 : 0) |
        (frame.loopback ? 0x02 : 0);
    const payload = Buffer.alloc(4 + 1 + 1 + 2 + dlc);
    payload.writeUInt32BE(canId >>> 0, 0);
    payload.writeUInt8(flags, 4);
    payload.writeUInt8(dlc, 5);
    payload.writeUInt8(0, 6);
    payload.writeUInt8(0, 7);
    frame.data.copy(payload, 8);
    return payload;
};
exports.encodeCanFrame = encodeCanFrame;
const decodeCanFrame = (payload) => {
    if (payload.length < 8) {
        throw new Error("CAN payload too short.");
    }
    const rawId = payload.readUInt32BE(0);
    const isExtended = (rawId & 0x80000000) !== 0;
    const canId = rawId & (isExtended ? MAX_CAN_ID : MAX_STD_ID);
    const flags = payload.readUInt8(4);
    const dlc = payload.readUInt8(5);
    if (dlc > 8) {
        throw new Error("CAN DLC out of range.");
    }
    if (payload.length < 8 + dlc) {
        throw new Error("CAN payload length mismatch.");
    }
    const data = payload.subarray(8, 8 + dlc);
    return {
        canId,
        isExtended,
        dlc,
        data,
        dataHex: data.toString("hex"),
        simulated: (flags & 0x01) !== 0,
        loopback: (flags & 0x02) !== 0,
    };
};
exports.decodeCanFrame = decodeCanFrame;
const encodeFlags = (config) => {
    return ((config.useRaw ? 0x01 : 0) |
        (config.autoRetx ? 0x02 : 0) |
        (config.txPause ? 0x04 : 0) |
        (config.protocolExc ? 0x08 : 0));
};
const decodeFlags = (flags) => ({
    useRaw: (flags & 0x01) !== 0,
    autoRetx: (flags & 0x02) !== 0,
    txPause: (flags & 0x04) !== 0,
    protocolExc: (flags & 0x08) !== 0,
});
const encodeCanConfigRequest = (action, config) => {
    const payload = Buffer.alloc(1 + 1 + 4 + 2 + 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
    payload.writeUInt8(action === "get" ? 0 : 1, 0);
    payload.writeUInt8(0, 1);
    const cfg = config ?? {
        bitrate: 0,
        samplePointPermille: 0,
        prescaler: 0,
        sjw: 0,
        tseg1: 0,
        tseg2: 0,
        mode: 0,
        useRaw: false,
        autoRetx: false,
        txPause: false,
        protocolExc: false,
    };
    payload.writeUInt32BE(cfg.bitrate >>> 0, 2);
    payload.writeUInt16BE(cfg.samplePointPermille, 6);
    payload.writeUInt16BE(cfg.prescaler, 8);
    payload.writeUInt8(cfg.sjw, 10);
    payload.writeUInt8(cfg.tseg1, 11);
    payload.writeUInt8(cfg.tseg2, 12);
    payload.writeUInt8(cfg.mode, 13);
    payload.writeUInt8(encodeFlags(cfg), 14);
    payload.writeUInt8(0, 15);
    return payload;
};
exports.encodeCanConfigRequest = encodeCanConfigRequest;
const decodeCanConfigResponse = (payload) => {
    if (payload.length < 16) {
        throw new Error("CAN config payload too short.");
    }
    const action = payload.readUInt8(0);
    if (action !== 2) {
        throw new Error(`Unexpected CAN config action ${action}.`);
    }
    const statusRaw = payload.readUInt8(1);
    const status = statusRaw === 0 ? "ok" : statusRaw === 1 ? "invalid" : "apply_failed";
    const bitrate = payload.readUInt32BE(2);
    const samplePointPermille = payload.readUInt16BE(6);
    const prescaler = payload.readUInt16BE(8);
    const sjw = payload.readUInt8(10);
    const tseg1 = payload.readUInt8(11);
    const tseg2 = payload.readUInt8(12);
    const mode = payload.readUInt8(13);
    const flags = payload.readUInt8(14);
    const decodedFlags = decodeFlags(flags);
    return {
        status,
        config: {
            bitrate,
            samplePointPermille,
            prescaler,
            sjw,
            tseg1,
            tseg2,
            mode,
            ...decodedFlags,
        },
    };
};
exports.decodeCanConfigResponse = decodeCanConfigResponse;
