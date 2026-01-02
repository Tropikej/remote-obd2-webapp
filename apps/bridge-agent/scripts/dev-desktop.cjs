const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const appRoot = process.cwd();
const repoRoot = path.resolve(appRoot, "..", "..");
const binExt = process.platform === "win32" ? ".cmd" : "";

const resolveBin = (name) => {
  const candidates = [
    path.join(appRoot, "node_modules", ".bin", `${name}${binExt}`),
    path.join(repoRoot, "node_modules", ".bin", `${name}${binExt}`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return name;
};

const tscBin = resolveBin("tsc");
const viteBin = resolveBin("vite");
const electronBin = resolveBin("electron");

const sharedTsconfig = path.join(repoRoot, "packages", "shared", "tsconfig.json");
const sharedDiscovery = path.join(repoRoot, "packages", "shared", "dist", "protocols", "discovery.js");
const rempTsconfig = path.join(repoRoot, "packages", "remp", "tsconfig.json");
const rempIndex = path.join(repoRoot, "packages", "remp", "dist", "index.js");
const rempPairing = path.join(repoRoot, "packages", "remp", "dist", "pairing.js");
const mainOutput = path.join(appRoot, "dist", "desktop", "main.js");

const children = new Set();
let devServerUrl = null;
let electronStarted = false;

const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");

const spawnProcess = (command, args, options = {}) => {
  const child = spawn(command, args, {
    stdio: "inherit",
    cwd: appRoot,
    env: process.env,
    shell: process.platform === "win32",
    ...options,
  });
  children.add(child);
  child.on("exit", (code) => {
    children.delete(child);
    if (code && code !== 0) {
      shutdown(code);
    }
  });
  return child;
};

const waitForReady = () => {
  if (electronStarted || !devServerUrl) {
    return;
  }
  if (
    !fs.existsSync(sharedDiscovery) ||
    !fs.existsSync(rempIndex) ||
    !fs.existsSync(rempPairing) ||
    !fs.existsSync(mainOutput)
  ) {
    return;
  }
  electronStarted = true;
  const electronEnv = { ...process.env, VITE_DEV_SERVER_URL: devServerUrl };
  spawnProcess(electronBin, [mainOutput], { env: electronEnv });
};

const watchReady = () => {
  setInterval(waitForReady, 250);
};

const launchVite = () => {
  const vite = spawn(viteBin, ["--config", "vite.desktop.config.ts", "--port", "5174"], {
    cwd: appRoot,
    env: process.env,
    shell: process.platform === "win32",
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.add(vite);

  const handleOutput = (chunk) => {
    const text = stripAnsi(chunk.toString());
    process.stdout.write(chunk);
    const match = text.match(/http:\/\/localhost:\d+\//);
    if (match && !devServerUrl) {
      devServerUrl = match[0].replace(/\/$/, "");
      waitForReady();
    }
  };

  vite.stdout.on("data", handleOutput);
  vite.stderr.on("data", (chunk) => process.stderr.write(chunk));
  vite.on("exit", (code) => {
    children.delete(vite);
    if (code && code !== 0) {
      shutdown(code);
    }
  });
};

const shutdown = (code) => {
  for (const child of children) {
    child.kill();
  }
  process.exit(code || 0);
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

spawnProcess(tscBin, ["-p", sharedTsconfig, "--watch"]);
spawnProcess(tscBin, ["-p", rempTsconfig, "--watch"]);
spawnProcess(tscBin, ["-p", "tsconfig.desktop.json", "--watch"]);
launchVite();
watchReady();
