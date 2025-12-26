import { bootstrapRedis } from "../redis/bootstrap";
import { closeRedis, getRedis } from "../redis/client";

const run = async () => {
  const redis = getRedis();
  const { schemaVersion, setResult } = await bootstrapRedis(redis);
  const action = setResult ? "initialized" : "already-initialized";
  console.log(
    `[redis-bootstrap] schema_version=${schemaVersion} (${action})`
  );
};

run()
  .catch((error) => {
    console.error("[redis-bootstrap] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeRedis();
    } catch (error) {
      console.error("[redis-bootstrap] failed to close redis", error);
      process.exitCode = 1;
    }
  });
