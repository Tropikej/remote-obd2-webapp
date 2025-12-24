import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { activateGroup, createGroup, deactivateGroup, listGroupsForUser } from "../services/groups";
import { AppError } from "../errors/app-error";
import { ErrorCodes } from "@dashboard/shared";

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
    const groups = await listGroupsForUser(req.user!.id, Boolean(isAdmin));
    res.json({ groups });
  })
);

router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user?.role === "super_admin";
    const dongleAId = typeof req.body?.dongle_a_id === "string" ? req.body.dongle_a_id : "";
    const dongleBId = typeof req.body?.dongle_b_id === "string" ? req.body.dongle_b_id : "";
    if (!dongleAId || !dongleBId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Missing dongle ids.", 400);
    }
    const group = await createGroup(req.user!.id, { dongleAId, dongleBId }, Boolean(isAdmin));
    res.json(group);
  })
);

router.post(
  "/:id/activate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user?.role === "super_admin";
    const group = await activateGroup(req.params.id, req.user!.id, Boolean(isAdmin));
    res.json(group);
  })
);

router.post(
  "/:id/deactivate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user?.role === "super_admin";
    const group = await deactivateGroup(req.params.id, req.user!.id, Boolean(isAdmin));
    res.json(group);
  })
);

export const groupsRouter = router;
