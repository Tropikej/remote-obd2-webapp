import { Router } from "express";
import { streamManager } from "../services/streams";
import { requireAuth } from "../middleware/auth";
import { getDongleForUser } from "../services/dongles";
import { prisma } from "../db";

const router = Router();

const asyncHandler =
  (handler: (req: any, res: any, next: any) => Promise<void>) =>
  (req: any, res: any, next: any) => {
    handler(req, res, next).catch(next);
  };

const writeEvent = (res: any, event: { id: number; type: string; data: unknown }) => {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
};

const parseLastEventId = (value: string | undefined) => {
  if (!value) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
};

router.get(
  "/dongles/:id/console",
  requireAuth,
  asyncHandler(async (req, res) => {
    const dongle = await getDongleForUser(
      req.params.id,
      req.user!.id,
      req.user?.role === "super_admin"
    );
    if (!dongle) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const lastEventId = parseLastEventId(req.header("Last-Event-ID"));
    const streamKey = `dongle:${dongle.id}`;
    const subscription = streamManager.subscribe(streamKey, lastEventId, (event) =>
      writeEvent(res, event)
    );

    const heartbeat = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
    });
  })
);

router.get(
  "/groups/:id/console",
  requireAuth,
  asyncHandler(async (req, res) => {
    const group = await prisma.dongleGroup.findUnique({
      where: { id: req.params.id },
    });
    if (!group) {
      res.status(404).end();
      return;
    }
    const isAdmin = req.user?.role === "super_admin";
    if (!isAdmin && group.userId !== req.user!.id) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const lastEventId = parseLastEventId(req.header("Last-Event-ID"));
    const streamKey = `group:${group.id}`;
    const subscription = streamManager.subscribe(streamKey, lastEventId, (event) =>
      writeEvent(res, event)
    );

    const heartbeat = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
    });
  })
);

export const streamsRouter = router;
