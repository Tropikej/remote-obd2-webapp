import { Router } from "express";
import { randomBytes } from "crypto";
import { ErrorCodes } from "@dashboard/shared";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";
import { requireAuth } from "../middleware/auth";
import { createRateLimiter } from "../middleware/rate-limit";
import { hashPassword, verifyPassword } from "../services/auth";
import { createPasswordResetToken, consumePasswordResetToken } from "../services/password-reset";

const router = Router();

const signupLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many signup attempts. Try again later.",
});

const loginLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Try again later.",
});

const passwordResetLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: "Too many password reset attempts. Try again later.",
});

const asyncHandler =
  (handler: (req: any, res: any, next: any) => Promise<void>) =>
  (req: any, res: any, next: any) => {
    handler(req, res, next).catch(next);
  };

const normalizeEmail = (value: string) => value.trim().toLowerCase();

router.get(
  "/csrf",
  asyncHandler(async (req, res) => {
    const token = randomBytes(32).toString("hex");
    req.session.csrfToken = token;
    res.json({ token });
  })
);

router.post(
  "/signup",
  signupLimiter,
  asyncHandler(async (req, res) => {
    const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email.includes("@") || password.length < 8) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid signup payload.", 400);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError(ErrorCodes.AUTH_EMAIL_TAKEN, "Email already in use.", 409);
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
      },
    });

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    req.session.userId = user.id;
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  })
);

router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Missing credentials.", 400);
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError(
        ErrorCodes.AUTH_INVALID_CREDENTIALS,
        "Email or password is incorrect.",
        401
      );
    }

    if (user.status !== "active") {
      throw new AppError(ErrorCodes.AUTH_USER_DISABLED, "User is disabled.", 403);
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      throw new AppError(
        ErrorCodes.AUTH_INVALID_CREDENTIALS,
        "Email or password is incorrect.",
        401
      );
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    req.session.userId = user.id;
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    if (!req.session) {
      res.json({ ok: true });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    res.clearCookie("dashboard_session");
    res.json({ ok: true });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) {
      throw new AppError(ErrorCodes.AUTH_SESSION_EXPIRED, "Session expired.", 401);
    }
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  })
);

router.post(
  "/password-reset/request",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";

    if (!email.includes("@")) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid email.", 400);
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== "active") {
      res.json({ ok: true });
      return;
    }

    const { token, expiresAt } = await createPasswordResetToken(user.id);

    if (process.env.NODE_ENV !== "production") {
      res.json({ ok: true, token, expires_at: expiresAt.toISOString() });
      return;
    }

    console.log(`[password-reset] issued token for ${email} expires_at=${expiresAt.toISOString()}`);
    res.json({ ok: true });
  })
);

router.post(
  "/password-reset/confirm",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!token || password.length < 8) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid reset payload.", 400);
    }

    const result = await consumePasswordResetToken(token);
    if (result.status === "invalid") {
      throw new AppError(ErrorCodes.PASSWORD_RESET_INVALID, "Invalid reset token.", 400);
    }
    if (result.status === "expired") {
      throw new AppError(ErrorCodes.PASSWORD_RESET_EXPIRED, "Reset token expired.", 400);
    }

    const user = await prisma.user.findUnique({ where: { id: result.record.userId } });
    if (!user) {
      throw new AppError(ErrorCodes.PASSWORD_RESET_INVALID, "Invalid reset token.", 400);
    }
    if (user.status !== "active") {
      throw new AppError(ErrorCodes.AUTH_USER_DISABLED, "User is disabled.", 403);
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.passwordResetToken.updateMany({
        where: { id: result.record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (updateResult.count === 0) {
        throw new AppError(ErrorCodes.PASSWORD_RESET_INVALID, "Reset token already used.", 400);
      }
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
    });

    res.json({ ok: true });
  })
);

export const authRouter = router;
