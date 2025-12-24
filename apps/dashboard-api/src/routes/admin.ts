import { Router } from "express";
import { requireRole } from "../middleware/auth";
import { unpairDongle } from "../services/pairing";

const router = Router();

router.get("/ping", requireRole("super_admin"), (req, res) => {
  res.json({ ok: true, role: req.user?.role });
});

router.post(
  "/dongles/:id/force-unpair",
  requireRole("super_admin"),
  async (req, res, next) => {
    try {
      const result = await unpairDongle(req.params.id, req.user!.id, true);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const adminRouter = router;
