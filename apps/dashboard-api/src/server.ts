import fs from "fs";
import path from "path";
import { config as loadEnv } from "dotenv";
import express from "express";
import http from "http";
import { apiRouter } from "./routes";
import { attachUser } from "./middleware/auth";
import { requireCsrf } from "./middleware/csrf";
import { errorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";
import { requestLogger } from "./middleware/request-logger";
import { createSessionMiddleware } from "./session/store";
import { ErrorCodes } from "@dashboard/shared";
import { attachControlWs } from "./ws/control";
import { attachDataPlaneWs } from "./ws/data-plane";
import { healthHandler, readyHandler } from "./routes/health";

const envCandidates = [
  path.resolve(__dirname, "..", ".env.local"),
  path.resolve(__dirname, "..", ".env"),
  path.resolve(__dirname, "..", "..", ".env.local"),
  path.resolve(__dirname, "..", "..", ".env"),
  path.resolve(__dirname, "..", "..", "..", ".env.local"),
  path.resolve(__dirname, "..", "..", "..", ".env"),
];

envCandidates.forEach((p) => {
  if (fs.existsSync(p)) {
    loadEnv({ path: p });
  }
});

const app = express();
const basePort = Number(process.env.PORT) || 3000;
const allowFallback =
  !process.env.PORT || (process.env.NODE_ENV && process.env.NODE_ENV !== "production");
const portCandidates = allowFallback
  ? Array.from({ length: 10 }, (_, idx) => basePort + idx)
  : [basePort];

app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));
app.use(requestId);
app.use(requestLogger);
app.use(createSessionMiddleware());
app.use(attachUser);

app.get("/healthz", healthHandler);
app.get("/readyz", readyHandler);

app.use("/api/v1", requireCsrf, apiRouter);

app.use((req, res) => {
  res.status(404).json({
    code: ErrorCodes.NOT_FOUND,
    message: "Route not found.",
    details: { request_id: req.requestId },
  });
});

app.use(errorHandler);

const server = http.createServer(app);
attachControlWs(server);
attachDataPlaneWs(server);

const listenWithFallback = (index = 0) => {
  const port = portCandidates[index];
  server.removeAllListeners("error");
  server.removeAllListeners("listening");

  server.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && index + 1 < portCandidates.length) {
      console.warn(`[dashboard-api] port ${port} in use, trying ${portCandidates[index + 1]}`);
      listenWithFallback(index + 1);
      return;
    }
    throw error;
  });

  server.once("listening", () => {
    console.log(`[dashboard-api] listening on http://localhost:${port}`);
  });
  server.listen(port);
};

listenWithFallback();
