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

const envCandidates = [
  path.resolve(__dirname, "..", ".env.local"),
  path.resolve(__dirname, "..", ".env"),
  path.resolve(__dirname, "..", "..", ".env.local"),
  path.resolve(__dirname, "..", "..", ".env"),
];

envCandidates.forEach((p) => {
  if (fs.existsSync(p)) {
    loadEnv({ path: p });
  }
});

const app = express();
const port = Number(process.env.PORT) || 3000;

app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));
app.use(requestId);
app.use(requestLogger);
app.use(createSessionMiddleware());
app.use(attachUser);

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "dashboard-api" });
});

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

server.listen(port, () => {
  console.log(`[dashboard-api] listening on http://localhost:${port}`);
});
