import { randomBytes } from "crypto";
import { prisma } from "../db";
import { createEncryptedDongleToken, getDecryptedDongleToken } from "../services/dongle-tokens";
import { decryptDongleToken } from "../crypto/dongle-token";
import { runRotation } from "../jobs/rotate-dongle-keys";

const requireEnv = (key: string) => {
  if (!process.env[key]) {
    throw new Error(`${key} is required for this script.`);
  }
};

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  requireEnv("DATABASE_URL");
  requireEnv("DONGLE_TOKEN_MASTER_KEY_V1");
  requireEnv("DONGLE_TOKEN_MASTER_KEY_V2");
  process.env.DONGLE_TOKEN_MASTER_KEY_DEFAULT_VERSION =
    process.env.DONGLE_TOKEN_MASTER_KEY_DEFAULT_VERSION || "1";

  const email = `crypto+${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "hash",
    },
  });

  const dongle = await prisma.dongle.create({
    data: {
      deviceId: `${Math.random().toString(16).slice(2, 18).padEnd(16, "0")}`.slice(0, 16),
      ownerUserId: user.id,
      ownershipState: "CLAIMED_ACTIVE",
    },
  });

  const token = randomBytes(32).toString("base64");
  await createEncryptedDongleToken({ dongleId: dongle.id, userId: user.id, token });

  const decrypted = await getDecryptedDongleToken(dongle.id, user.id);
  assert(decrypted === token, "Decrypted token did not match original.");

  const record = await prisma.dongleToken.findUnique({ where: { dongleId: dongle.id } });
  if (!record) {
    throw new Error("Dongle token record missing.");
  }
  assert(record.keyVersion === 1, "Expected key version 1 before rotation.");

  let aadMismatch = false;
  try {
    decryptDongleToken(
      {
        keyVersion: record.keyVersion,
        nonce: record.nonce,
        ciphertext: record.ciphertext,
        tag: record.tag,
      },
      {
        dongleId: dongle.id,
        userId: "00000000-0000-0000-0000-000000000000",
        createdAt: record.createdAt.toISOString(),
      }
    );
  } catch (error) {
    aadMismatch = true;
  }
  assert(aadMismatch, "AAD mismatch did not fail decryption.");

  process.env.DONGLE_TOKEN_MASTER_KEY_TARGET_VERSION = "2";
  await runRotation(2);

  const rotated = await prisma.dongleToken.findUnique({ where: { dongleId: dongle.id } });
  if (!rotated) {
    throw new Error("Rotated token missing.");
  }
  assert(rotated.keyVersion === 2, "Expected key version 2 after rotation.");

  const decryptedAfterRotation = await getDecryptedDongleToken(dongle.id, user.id);
  assert(decryptedAfterRotation === token, "Rotated token did not decrypt to original.");

  await prisma.dongleToken.deleteMany({ where: { dongleId: dongle.id } });
  await prisma.dongle.delete({ where: { id: dongle.id } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log("Dongle token crypto validation passed.");
};

main()
  .catch((error) => {
    console.error("Dongle token crypto validation failed.");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
