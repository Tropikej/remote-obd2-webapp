#!/usr/bin/env node
const { spawn } = require("child_process");
const net = require("net");

const processes = [];

const spawnTask = (name, args, envOverrides = {}) => {
  const child = spawn("npm", ["run", ...args], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...envOverrides },
  });
  processes.push(child);
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[dev-stack] ${name} exited with code ${code}`);
      process.exitCode = code ?? 1;
    }
  });
  return child;
};

const runCommand = (name, args, envOverrides = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", ...args], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...envOverrides },
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`[dev-stack] ${name} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });

const shutdown = () => {
  processes.forEach((p) => {
    if (!p.killed) {
      p.kill();
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const canListen = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });

const findAvailablePort = async (start, attempts = 10) => {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = start + offset;
    if (await canListen(port)) {
      return port;
    }
  }
  return start;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const canConnect = (host, port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });

const waitForPort = async (host, port, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`[dev-stack] ${host}:${port} did not become available`);
};

const run = async () => {
  await runCommand("services", ["dev:services"]);

  await waitForPort("127.0.0.1", 6379);

  const basePort = Number(process.env.DASHBOARD_API_PORT ?? process.env.PORT ?? 3000);
  const apiPort = await findAvailablePort(basePort);
  const apiTarget = `http://localhost:${apiPort}`;

  if (apiPort !== basePort) {
    console.warn(`[dev-stack] port ${basePort} busy, using ${apiPort} for API`);
  }

  spawnTask("api", ["dev:api"], { PORT: String(apiPort) });
  spawnTask("web", ["dev:web"], { VITE_API_PROXY_TARGET: apiTarget });
};

run().catch((error) => {
  console.error(`[dev-stack] failed to start: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
