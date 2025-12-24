import dgram from "dgram";

export type PairingTarget = {
  host: string;
  port: number;
};

export type PairingModeStartResponse = {
  expiresAt?: string;
  pairingNonce?: string;
};

export type PairingSubmitResponse =
  | { status: "ok"; tokenFingerprint?: string }
  | { status: "invalid_pin" }
  | { status: "error"; message?: string };

const DEFAULT_TIMEOUT_MS = 5000;

type UdpRequest = {
  type: string;
  [key: string]: unknown;
};

const sendUdpRequest = async <TResponse>(
  target: PairingTarget,
  payload: UdpRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<TResponse> => {
  const socket = dgram.createSocket("udp4");
  const message = Buffer.from(JSON.stringify(payload), "utf8");

  return new Promise<TResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Pairing UDP request timed out"));
    }, timeoutMs);

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

export const sendPairingModeStart = async (
  target: PairingTarget,
  dongleId: string,
  corrId: string
): Promise<PairingModeStartResponse> => {
  const payload: UdpRequest = {
    type: "PAIRING_MODE_START",
    dongle_id: dongleId,
    corr_id: corrId,
  };
  return sendUdpRequest<PairingModeStartResponse>(target, payload);
};

export const sendPairingSubmit = async (
  target: PairingTarget,
  dongleId: string,
  corrId: string,
  pin: string,
  pairingNonce: string | undefined,
  dongleToken: string
): Promise<PairingSubmitResponse> => {
  const payload: UdpRequest = {
    type: "PAIRING_SUBMIT",
    dongle_id: dongleId,
    corr_id: corrId,
    pin,
    pairing_nonce: pairingNonce,
    dongle_token: dongleToken,
  };
  return sendUdpRequest<PairingSubmitResponse>(target, payload);
};
