import dgram from "dgram";
import { decodeCanFrame, decodeRempHeader, REMP_TYPE_CAN } from "@dashboard/remp";

export type RempTarget = {
  host: string;
  port: number;
};

export type RempCanEvent = {
  deviceId: string;
  frame: ReturnType<typeof decodeCanFrame>;
  source: { host: string; port: number };
};

type PendingRequest = {
  id: number;
  match: (header: ReturnType<typeof decodeRempHeader>, payload: Buffer) => boolean;
  resolve: (message: Buffer) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type RempTransport = {
  send: (target: RempTarget, message: Buffer) => Promise<void>;
  request: (opts: {
    target: RempTarget;
    message: Buffer;
    timeoutMs: number;
    match: PendingRequest["match"];
  }) => Promise<Buffer>;
  onCanFrame: (handler: (event: RempCanEvent) => void) => () => void;
  close: () => void;
};

const toDeviceId = (value: Buffer) => value.toString("hex");

export const createRempTransport = (): RempTransport => {
  const socket = dgram.createSocket("udp4");
  const debug = process.env.BRIDGE_AGENT_DEBUG_REMP === "1";
  const logDebug = (message: string) => {
    if (debug) {
      console.log(`[bridge-agent] remp ${message}`);
    }
  };
  const listeners = new Set<(event: RempCanEvent) => void>();
  const pending = new Set<PendingRequest>();
  let seq = 0;

  const ready = new Promise<void>((resolve, reject) => {
    socket.once("listening", () => resolve());
    socket.once("error", (err) => reject(err));
    socket.bind(0);
  });

  const rejectAll = (error: Error) => {
    for (const req of pending) {
      clearTimeout(req.timeout);
      req.reject(error);
    }
    pending.clear();
  };

  socket.on("error", (error) => {
    logDebug(`socket error: ${error.message}`);
    rejectAll(error);
  });

  socket.on("message", (message, rinfo) => {
    let header: ReturnType<typeof decodeRempHeader>;
    try {
      header = decodeRempHeader(message);
    } catch {
      logDebug(`non-remp packet from ${rinfo.address}:${rinfo.port} (${message.length} bytes)`);
      return;
    }
    const payload = message.subarray(header.payloadOffset);
    for (const req of pending) {
      if (req.match(header, payload)) {
        logDebug(
          `matched type=${header.type} device=${header.deviceId.toString("hex")} token_len=${header.tokenLen} ` +
            `from ${rinfo.address}:${rinfo.port} payload=${payload.length}`
        );
        clearTimeout(req.timeout);
        pending.delete(req);
        req.resolve(message);
        return;
      }
    }
    logDebug(
      `unmatched type=${header.type} device=${header.deviceId.toString("hex")} token_len=${header.tokenLen} ` +
        `from ${rinfo.address}:${rinfo.port} payload=${payload.length}`
    );
    if (header.type === REMP_TYPE_CAN) {
      try {
        const frame = decodeCanFrame(payload);
        const deviceId = toDeviceId(header.deviceId);
        logDebug(
          `can frame device=${deviceId} dlc=${frame.dlc} is_extended=${frame.isExtended} data_len=${frame.data.length}`
        );
        listeners.forEach((handler) =>
          handler({ deviceId, frame, source: { host: rinfo.address, port: rinfo.port } })
        );
      } catch {
        logDebug(
          `can decode failed payload=${payload.toString("hex")} length=${payload.length}`
        );
        return;
      }
    }
  });

  const send = async (target: RempTarget, message: Buffer) => {
    await ready;
    await new Promise<void>((resolve, reject) => {
      socket.send(message, target.port, target.host, (err) => {
        if (err) {
          reject(err);
          return;
        }
        logDebug(`sent ${message.length} bytes to ${target.host}:${target.port}`);
        resolve();
      });
    });
  };

  const request = async (opts: {
    target: RempTarget;
    message: Buffer;
    timeoutMs: number;
    match: PendingRequest["match"];
  }) => {
    await ready;
    const requestId = ++seq;
    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(request);
        logDebug(
          `timeout waiting for response (request=${requestId}) to ${opts.target.host}:${opts.target.port}`
        );
        reject(new Error("REMP request timed out."));
      }, opts.timeoutMs);

      const request: PendingRequest = {
        id: requestId,
        match: opts.match,
        resolve,
        reject,
        timeout,
      };

      pending.add(request);
      socket.send(opts.message, opts.target.port, opts.target.host, (err) => {
        if (err) {
          pending.delete(request);
          clearTimeout(timeout);
          logDebug(`send error to ${opts.target.host}:${opts.target.port}: ${err.message}`);
          reject(err);
        }
      });
    });
  };

  const onCanFrame = (handler: (event: RempCanEvent) => void) => {
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  };

  const close = () => {
    rejectAll(new Error("REMP transport closed."));
    socket.close();
  };

  return {
    send,
    request,
    onCanFrame,
    close,
  };
};
