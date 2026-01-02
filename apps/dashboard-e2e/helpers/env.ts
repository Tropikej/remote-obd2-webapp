import path from "path";
import { E2E_DONGLES, E2E_USERS } from "./fixtures";

type UserCredentials = { email: string; password: string };

type DongleFixture = { id: string; deviceId: string };

const envOr = (key: string, fallback: string) => process.env[key] ?? fallback;

export const BASE_URL = envOr("E2E_BASE_URL", "http://localhost:8080");
export const STORAGE_STATE_PATH = envOr(
  "E2E_STORAGE_STATE_PATH",
  path.join(__dirname, "..", ".auth", "storageState.json")
);

export const USERS: Record<string, UserCredentials> = {
  standard: {
    email: envOr("E2E_USER_EMAIL", E2E_USERS.standard.email),
    password: envOr("E2E_USER_PASSWORD", E2E_USERS.standard.password),
  },
  admin: {
    email: envOr("E2E_ADMIN_EMAIL", E2E_USERS.admin.email),
    password: envOr("E2E_ADMIN_PASSWORD", E2E_USERS.admin.password),
  },
  disabled: {
    email: envOr("E2E_DISABLED_EMAIL", E2E_USERS.disabled.email),
    password: envOr("E2E_DISABLED_PASSWORD", E2E_USERS.disabled.password),
  },
};

export const DONGLES: Record<string, DongleFixture> = {
  ownedA: {
    id: envOr("E2E_DONGLE_A_ID", E2E_DONGLES.ownedA.id),
    deviceId: envOr("E2E_DONGLE_A_DEVICE_ID", E2E_DONGLES.ownedA.deviceId),
  },
  ownedB: {
    id: envOr("E2E_DONGLE_B_ID", E2E_DONGLES.ownedB.id),
    deviceId: envOr("E2E_DONGLE_B_DEVICE_ID", E2E_DONGLES.ownedB.deviceId),
  },
  offline: {
    id: envOr("E2E_DONGLE_OFFLINE_ID", E2E_DONGLES.offline.id),
    deviceId: envOr("E2E_DONGLE_OFFLINE_DEVICE_ID", E2E_DONGLES.offline.deviceId),
  },
};
