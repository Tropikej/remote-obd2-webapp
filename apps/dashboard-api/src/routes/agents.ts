import { Router } from "express";
import { ErrorCodes } from "@dashboard/shared";
import { registerAgent, reportDevices, updateHeartbeat } from "../services/agents";
import { requireAuth } from "../middleware/auth";
import { requireAgent } from "../middleware/agent-auth";
import { AppError } from "../errors/app-error";

const router = Router();

const asyncHandler =
  (handler: (req: any, res: any, next: any) => Promise<void>) =>
  (req: any, res: any, next: any) => {
    handler(req, res, next).catch(next);
  };

router.post(
  "/register",
  requireAuth,
  asyncHandler(async (req, res) => {
    const hostname = typeof req.body?.hostname === "string" ? req.body.hostname : "";
    const os = typeof req.body?.os === "string" ? req.body.os : "";
    const version = typeof req.body?.version === "string" ? req.body.version : "";
    const agentName =
      typeof req.body?.agent_name === "string" ? req.body.agent_name : undefined;
    const networkInterfaces = req.body?.network_interfaces;

    if (!hostname || !os || !version) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid agent payload.", 400);
    }

    const { agent, token } = await registerAgent({
      userId: req.user!.id,
      agentName,
      hostname,
      os,
      version,
      networkInterfaces,
    });

    console.log(`[agent] registered agent_id=${agent.id} user_id=${req.user!.id}`);

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const wsUrl = baseUrl.replace(/^http/i, "ws") + "/ws/agent";

    res.json({
      agent_id: agent.id,
      agent_token: token,
      ws_url: wsUrl,
    });
  })
);

router.post(
  "/heartbeat",
  requireAgent,
  asyncHandler(async (req, res) => {
    await updateHeartbeat(req.agent!.id, {
      agentName: typeof req.body?.agent_name === "string" ? req.body.agent_name : undefined,
      hostname: typeof req.body?.hostname === "string" ? req.body.hostname : undefined,
      os: typeof req.body?.os === "string" ? req.body.os : undefined,
      version: typeof req.body?.version === "string" ? req.body.version : undefined,
      networkInterfaces: req.body?.network_interfaces,
    });

    console.log(`[agent] heartbeat agent_id=${req.agent!.id}`);
    res.json({ ok: true });
  })
);

router.post(
  "/devices/report",
  requireAgent,
  asyncHandler(async (req, res) => {
    const devices = Array.isArray(req.body?.devices) ? req.body.devices : [];
    if (!Array.isArray(devices)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid devices payload.", 400);
    }

    const records = await reportDevices(req.agent!.id, devices);
    console.log(`[agent] devices_report agent_id=${req.agent!.id} count=${records.length}`);
    res.json({
      devices: records.map((record) => ({
        id: record.id,
        device_id: record.deviceId,
        ownership_state: record.ownershipState,
        owner_user_id: record.ownerUserId ?? null,
      })),
    });
  })
);

export const agentsRouter = router;
