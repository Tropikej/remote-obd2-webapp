const baseUrl = process.env.E2E_BASE_URL || "http://localhost:8080";
const timeoutMs = Number(process.env.E2E_WAIT_TIMEOUT_MS || 120000);
const intervalMs = Number(process.env.E2E_WAIT_INTERVAL_MS || 2000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForReady = async () => {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/readyz`, { method: "GET" });
      if (res.ok) {
        console.log(`[e2e-wait] readyz ok at ${baseUrl}`);
        return;
      }
      lastError = `readyz status ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown error";
    }

    await sleep(intervalMs);
  }

  throw new Error(`[e2e-wait] timeout waiting for ${baseUrl}/readyz: ${lastError}`);
};

waitForReady().catch((error) => {
  console.error(error);
  process.exit(1);
});
