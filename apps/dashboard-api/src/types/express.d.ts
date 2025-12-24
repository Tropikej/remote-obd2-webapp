import type { UserRole, UserStatus } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: {
        id: string;
        email: string;
        role: UserRole;
        status: UserStatus;
      };
      agent?: {
        id: string;
        userId: string;
      };
    }
  }
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}
