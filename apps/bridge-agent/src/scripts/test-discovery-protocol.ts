import { randomBytes } from "crypto";
import {
  decodeAnnounce,
  encodeAnnounce,
  encodeDiscover,
} from "@dashboard/shared/protocols/discovery";

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = () => {
  const nonce = randomBytes(16).toString("base64");
  const payload = {
    deviceId: "0011223344556677",
    fwBuild: "1.2.3",
    udpPort: 50000,
    capabilities: 3,
    protoVer: 1,
    lanIp: "192.168.1.50",
    pairingState: 1,
    pairingNonce: nonce,
  };

  const packet = encodeAnnounce(42, payload);
  const decoded = decodeAnnounce(packet);

  assert(decoded.deviceId === payload.deviceId, "Device ID mismatch.");
  assert(decoded.fwBuild === payload.fwBuild, "Firmware build mismatch.");
  assert(decoded.udpPort === payload.udpPort, "UDP port mismatch.");
  assert(decoded.capabilities === payload.capabilities, "Capabilities mismatch.");
  assert(decoded.protoVer === payload.protoVer, "Protocol version mismatch.");
  assert(decoded.lanIp === payload.lanIp, "LAN IP mismatch.");
  assert(decoded.pairingState === payload.pairingState, "Pairing state mismatch.");
  assert(decoded.pairingNonce === payload.pairingNonce, "Pairing nonce mismatch.");

  const discover = encodeDiscover(7);
  assert(discover.length > 0, "DISCOVER packet not encoded.");

  const corrupted = Buffer.from(packet);
  corrupted[corrupted.length - 1] ^= 0xff;
  let threw = false;
  try {
    decodeAnnounce(corrupted);
  } catch (error) {
    threw = true;
  }
  assert(threw, "CRC mismatch did not throw.");

  console.log("Discovery protocol test passed.");
};

run();
