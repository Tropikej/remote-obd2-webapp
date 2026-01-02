const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForReady = async (baseUrl: string, timeoutMs = 120000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/readyz`, { method: "GET" });
      if (res.ok) {
        return;
      }
      lastError = `readyz status ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown error";
    }

    await sleep(2000);
  }

  throw new Error(`Timed out waiting for ${baseUrl}/readyz (${lastError ?? "no response"})`);
};
