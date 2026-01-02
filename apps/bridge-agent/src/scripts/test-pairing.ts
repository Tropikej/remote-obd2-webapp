import dgram from "dgram";
import { randomBytes, randomUUID } from "crypto";
import { sendPairingModeStartBinary, sendPairingSubmitBinary } from "@dashboard/remp";

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const REMp_MAGIC = "REMP";
const REMp_VERSION = 1;
const REMp_TYPE_PAIRING = 3;
const PAIRING_ACTION_START = 1;
const PAIRING_ACTION_SUBMIT = 2;
const PAIRING_ACTION_ACK = 3;

const useJsonSimulator = process.env.PAIRING_JSON_SIM === "1";

const startJsonDongleServer = (port: number, goodPin: string) => {
  const server = dgram.createSocket("udp4");
  server.on("message", (msg, rinfo) => {
    try {
      const payload = JSON.parse(msg.toString("utf8")) as Record<string, unknown>;
      if (payload.type === "PAIRING_MODE_START") {
        const response = {
          expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          pairingNonce: randomBytes(16).toString("base64"),
          corr_id: payload.corr_id,
        };
        server.send(Buffer.from(JSON.stringify(response)), rinfo.port, rinfo.address);
      } else if (payload.type === "PAIRING_SUBMIT") {
        const response =
          payload.pin === goodPin
            ? { status: "ok", corr_id: payload.corr_id }
            : { status: "invalid_pin", corr_id: payload.corr_id };
        server.send(Buffer.from(JSON.stringify(response)), rinfo.port, rinfo.address);
      }
    } catch {
      // ignore malformed
    }
  });
  server.bind(port);
  return server;
};

const parseRempHeader = (msg: Buffer) => {
  if (msg.length < 31) {
    return null;
  }
  if (msg.subarray(0, 4).toString("ascii") !== REMp_MAGIC) {
    return null;
  }
  if (msg.readUInt8(4) !== REMp_VERSION) {
    return null;
  }
  const type = msg.readUInt8(5);
  const tokenLen = msg.readUInt8(8);
  const payloadOffset = 9 + 2 + 8 + 4 + 8 + tokenLen;
  if (payloadOffset > msg.length) {
    return null;
  }
  return { type, payloadOffset };
};

const buildRempAck = (
  status: number,
  seconds: number,
  corrId: Buffer,
  pairingNonce?: Buffer
) => {
  const header = Buffer.alloc(31);
  let offset = 0;
  header.write(REMp_MAGIC, offset, "ascii");
  offset += 4;
  header.writeUInt8(REMp_VERSION, offset++);
  header.writeUInt8(REMp_TYPE_PAIRING, offset++);
  header.writeUInt8(0, offset++);
  header.writeUInt8(0, offset++);
  header.writeUInt8(0, offset++);
  header.writeUInt16BE(0, offset);
  offset += 2;
  Buffer.alloc(8).copy(header, offset);
  offset += 8;
  const seq = randomBytes(4);
  seq.copy(header, offset);
  offset += 4;
  const ts = BigInt(Date.now()) * 1000n;
  header.writeBigUInt64BE(ts, offset);
  offset += 8;

  const payloadLen = 1 + 1 + 2 + 16 + (pairingNonce ? 16 : 0);
  const payload = Buffer.alloc(payloadLen);
  payload.writeUInt8(PAIRING_ACTION_ACK, 0);
  payload.writeUInt8(status, 1);
  payload.writeUInt16BE(seconds, 2);
  corrId.copy(payload, 4);
  if (pairingNonce) {
    pairingNonce.copy(payload, 20);
  }
  return Buffer.concat([header, payload]);
};

const startRempDongleServer = (port: number, goodPin: string) => {
  const server = dgram.createSocket("udp4");
  const pairingNonce = randomBytes(16);
  server.on("message", (msg, rinfo) => {
    const header = parseRempHeader(msg);
    if (!header || header.type !== REMp_TYPE_PAIRING) {
      return;
    }
    const payload = msg.subarray(header.payloadOffset);
    if (payload.length < 4 + 16) {
      return;
    }
    const action = payload.readUInt8(0);
    const corrId = payload.subarray(4, 20);
    if (action === PAIRING_ACTION_START) {
      const response = buildRempAck(0, 120, corrId, pairingNonce);
      server.send(response, rinfo.port, rinfo.address);
      return;
    }
    if (action === PAIRING_ACTION_SUBMIT) {
      if (payload.length < 4 + 16 + 6 + 16 + 1) {
        return;
      }
      const pin = payload.subarray(20, 26).toString("ascii");
      const response =
        pin === goodPin
          ? buildRempAck(0, 0, corrId)
          : buildRempAck(1, 0, corrId);
      server.send(response, rinfo.port, rinfo.address);
    }
  });
  server.bind(port);
  return server;
};

const sendJsonRequest = async <TResponse>(
  target: { host: string; port: number },
  payload: Record<string, unknown>
) => {
  const socket = dgram.createSocket("udp4");
  const message = Buffer.from(JSON.stringify(payload), "utf8");

  return new Promise<TResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Pairing UDP request timed out"));
    }, 5000);

    socket.once("error", (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.once("message", (msg) => {
      clearTimeout(timer);
      socket.close();
      try {
        const parsed = JSON.parse(msg.toString("utf8")) as TResponse;
        resolve(parsed);
      } catch (error) {
        reject(error as Error);
      }
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

const sendJsonPairingStart = (target: { host: string; port: number }, corrId: string) =>
  sendJsonRequest<{ expiresAt?: string; pairingNonce?: string }>(target, {
    type: "PAIRING_MODE_START",
    corr_id: corrId,
  });

const sendJsonPairingSubmit = (
  target: { host: string; port: number },
  corrId: string,
  pin: string,
  pairingNonce: string | undefined,
  dongleToken: string
) =>
  sendJsonRequest<{ status: string }>(target, {
    type: "PAIRING_SUBMIT",
    corr_id: corrId,
    pin,
    pairing_nonce: pairingNonce,
    dongle_token: dongleToken,
  });

const run = async () => {
  const goodPin = "654321";
  const port = 50555;
  const server = useJsonSimulator
    ? startJsonDongleServer(port, goodPin)
    : startRempDongleServer(port, goodPin);
  const target = { host: "127.0.0.1", port };

  try {
    if (useJsonSimulator) {
      const mode = await sendJsonPairingStart(target, randomUUID());
      assert(Boolean(mode.expiresAt), "Mode start should return expiresAt");

      const invalid = await sendJsonPairingSubmit(
        target,
        randomUUID(),
        "111111",
        mode.pairingNonce,
        "tokenA"
      );
      assert(invalid.status === "invalid_pin", "Expected invalid_pin for wrong pin");

      const ok = await sendJsonPairingSubmit(
        target,
        randomUUID(),
        goodPin,
        mode.pairingNonce,
        "tokenB"
      );
      assert(ok.status === "ok", "Expected ok for correct pin");
    } else {
      const mode = await sendPairingModeStartBinary(
        target,
        "0000000000000000",
        randomUUID()
      );
      assert(Boolean(mode.expiresInS), "Mode start should return expiresInS");

      assert(Boolean(mode.pairingNonce), "Mode start should return pairingNonce");
      const nonce = mode.pairingNonce as string;

      const invalid = await sendPairingSubmitBinary(
        target,
        "0000000000000000",
        randomUUID(),
        "111111",
        nonce,
        "tokenA"
      );
      assert(invalid.status === "invalid_pin", "Expected invalid_pin for wrong pin");

      const ok = await sendPairingSubmitBinary(
        target,
        "0000000000000000",
        randomUUID(),
        goodPin,
        nonce,
        "tokenB"
      );
      assert(ok.status === "ok", "Expected ok for correct pin");
    }

    console.log("Pairing transport simulation passed.");
  } finally {
    server.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
