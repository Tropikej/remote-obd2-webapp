import { WebSocketServer } from "ws";
import { connectControlWs } from "../ws/control";

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const waitFor = (predicate: () => boolean, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timeout waiting for condition."));
      }
    }, 50);
  });

const run = async () => {
  const server = new WebSocketServer({ port: 0 });
  const address = server.address();
  if (typeof address === "string" || !address) {
    throw new Error("Failed to start WebSocket server.");
  }
  const url = `ws://127.0.0.1:${address.port}`;

  let sawAuth = false;
  let sawHeartbeat = false;

  server.on("connection", (socket, request) => {
    const auth = request.headers.authorization;
    sawAuth = Boolean(auth && auth.startsWith("Bearer "));
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      if (text.includes("\"heartbeat\"")) {
        sawHeartbeat = true;
      }
    });
  });

  const control = connectControlWs({
    wsUrl: url,
    agentToken: "test-token",
    agentId: "agent-123",
    heartbeatIntervalMs: 200,
    reconnectMinDelayMs: 200,
    reconnectMaxDelayMs: 500,
  });

  await waitFor(() => sawAuth, 2000);
  await waitFor(() => sawHeartbeat, 2000);

  control.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  assert(sawAuth, "Authorization header missing.");
  assert(sawHeartbeat, "Heartbeat message missing.");

  console.log("Control WebSocket test passed.");
};

run().catch((error) => {
  console.error("Control WebSocket test failed.");
  console.error(error);
  process.exit(1);
});
