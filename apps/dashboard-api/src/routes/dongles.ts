import { Router } from "express";
import { applyCanConfig } from "../services/can-config";
import { listDonglesForUser, getDongleForUser } from "../services/dongles";
import { startPairingSession, submitPairing, unpairDongle } from "../services/pairing";
import { requireAuth } from "../middleware/auth";
import { AppError } from "../errors/app-error";
import { ErrorCodes } from "@dashboard/shared";
import { enqueueCommand, getCommandForUser } from "../services/commands";

const router = Router();

const asyncHandler =
  (handler: (req: any, res: any, next: any) => Promise<void>) =>
  (req: any, res: any, next: any) => {
    handler(req, res, next).catch(next);
  };

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user?.role === "super_admin";
    const dongles = await listDonglesForUser(req.user!.id, isAdmin);
    res.json({
      dongles: dongles.map((dongle) => ({
        id: dongle.id,
        device_id: dongle.deviceId,
        ownership_state: dongle.ownershipState,
        last_seen_at: dongle.lastSeenAt?.toISOString() ?? null,
        lan_ip: dongle.lanIp ?? null,
        fw_build: dongle.fwBuild ?? null,
        udp_port: dongle.udpPort ?? null,
      })),
    });
  })
);

router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user?.role === "super_admin";
    const dongle = await getDongleForUser(req.params.id, req.user!.id, isAdmin);
    res.json({
      id: dongle.id,
      device_id: dongle.deviceId,
      owner_user_id: dongle.ownerUserId ?? null,
      ownership_state: dongle.ownershipState,
      last_seen_at: dongle.lastSeenAt?.toISOString() ?? null,
      lan_ip: dongle.lanIp ?? null,
      fw_build: dongle.fwBuild ?? null,
      udp_port: dongle.udpPort ?? null,
      can_config: dongle.canConfig
        ? {
            bitrate: dongle.canConfig.bitrate,
            sample_point_permille: dongle.canConfig.samplePointPermille,
            mode: dongle.canConfig.mode,
            use_raw: dongle.canConfig.useRaw,
            prescaler: dongle.canConfig.prescaler,
            sjw: dongle.canConfig.sjw,
            tseg1: dongle.canConfig.tseg1,
            tseg2: dongle.canConfig.tseg2,
            auto_retx: dongle.canConfig.autoRetx,
            tx_pause: dongle.canConfig.txPause,
            protocol_exc: dongle.canConfig.protocolExc,
          }
        : null,
    });
  })
);

router.put(
  "/:id/can-config",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user?.role === "super_admin";
    const result = await applyCanConfig(req.params.id, req.user!.id, isAdmin, req.body);
    res.json(result);
  })
);

router.post(
  "/:id/pairing-mode",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await startPairingSession(req.params.id, req.user!.id);
    res.json(result);
  })
);

router.post(
  "/:id/pairing-submit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const pairingSessionId =
      typeof req.body?.pairing_session_id === "string" ? req.body.pairing_session_id : "";
    const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
    const pairingNonce =
      typeof req.body?.pairing_nonce === "string" ? req.body.pairing_nonce : undefined;
    const dongleToken =
      typeof req.body?.dongle_token === "string" ? req.body.dongle_token : undefined;

    if (!pairingSessionId || !pin) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid pairing submit payload.", 400);
    }

    const result = await submitPairing(req.user!.id, {
      pairingSessionId,
      pin,
      pairingNonce,
      dongleToken,
      actorIp: req.ip,
      actorUserAgent: req.get("user-agent"),
    });

    res.json(result);
  })
);

router.post(
  "/:id/unpair",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await unpairDongle(req.params.id, req.user!.id, false);
    res.json(result);
  })
);

router.post(
  "/:id/commands",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user?.role === "super_admin";
    const result = await enqueueCommand(req.params.id, req.user!.id, isAdmin, req.body, {
      actorIp: req.ip,
      actorUserAgent: req.get("user-agent"),
    });
    res.json(result);
  })
);

router.get(
  "/:id/commands/:commandId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user?.role === "super_admin";
    const result = await getCommandForUser(
      req.params.id,
      req.params.commandId,
      req.user!.id,
      isAdmin
    );
    res.json(result);
  })
);

export const donglesRouter = router;
