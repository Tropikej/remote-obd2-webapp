#!/usr/bin/env node
const { spawn } = require("child_process");

const processes = [];

const spawnTask = (name, args) => {
  const child = spawn("npm", ["run", ...args], {
    stdio: "inherit",
    shell: process.platform === "win32",
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

const shutdown = () => {
  processes.forEach((p) => {
    if (!p.killed) {
      p.kill();
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

spawnTask("api", ["dev:api"]);
spawnTask("web", ["dev:web"]);
