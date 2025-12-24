import { Router } from "express";
import { authRouter } from "./auth";
import { adminRouter } from "./admin";
import { agentsRouter } from "./agents";
import { donglesRouter } from "./dongles";
import { groupsRouter } from "./groups";
import { streamsRouter } from "./streams";

const router = Router();

router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/agents", agentsRouter);
router.use("/dongles", donglesRouter);
router.use("/groups", groupsRouter);
router.use("/streams", streamsRouter);

router.get("/", (_req, res) => {
  res.json({ status: "ok", service: "dashboard-api", version: "v1" });
});

export const apiRouter = router;
