import dgram from "dgram";
import { randomBytes } from "crypto";
import { sendPairingModeStart, sendPairingSubmit } from "@dashboard/remp/pairing";

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const startFakeDongleServer = (port: number, goodPin: string) => {
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

const run = async () => {
  const goodPin = "654321";
  const port = 50555;
  const server = startFakeDongleServer(port, goodPin);
  const target = { host: "127.0.0.1", port };

  try {
    const mode = await sendPairingModeStart(target, "dongle-1", "corr-mode-1");
    assert(Boolean(mode.expiresAt), "Mode start should return expiresAt");

    const invalid = await sendPairingSubmit(target, "dongle-1", "corr-submit-1", "111111", mode.pairingNonce, "tokenA");
    assert(invalid.status === "invalid_pin", "Expected invalid_pin for wrong pin");

    const ok = await sendPairingSubmit(target, "dongle-1", "corr-submit-2", goodPin, mode.pairingNonce, "tokenB");
    assert(ok.status === "ok", "Expected ok for correct pin");

    console.log("Pairing transport simulation passed.");
  } finally {
    server.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
