import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";

const PgSession = connectPgSimple(session);

export const createSessionMiddleware = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for session storage.");
  }

  const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret";
  const isProduction = process.env.NODE_ENV === "production";
  if (!process.env.SESSION_SECRET && !isProduction) {
    console.warn("[session] SESSION_SECRET not set, using development fallback.");
  }

  const pool = new Pool({ connectionString });

  return session({
    name: "dashboard_session",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
    store: new PgSession({
      pool,
      createTableIfMissing: true,
    }),
  });
};
