import { createAgentController } from "./agent-core";

const run = async () => {
  const controller = createAgentController({ autoRegisterFromEnv: true });
  controller.on("status", (status) => {
    console.log(
      `[bridge-agent] status ws=${status.wsStatus} discovery=${status.discoveryActive ? "on" : "off"}`
    );
  });

  await controller.start();

  const shutdown = async (signal: string) => {
    console.log(`[bridge-agent] received ${signal}, shutting down`);
    await controller.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

run().catch((error) => {
  console.error(`[bridge-agent] fatal: ${(error as Error).message}`);
  process.exit(1);
});
