import { prisma } from "../db";
import { decryptDongleToken, encryptDongleToken } from "../crypto/dongle-token";
import { getKeyring } from "../config/keys";

const parseTargetVersion = () => {
  const arg = process.argv[2];
  const env = process.env.DONGLE_TOKEN_MASTER_KEY_TARGET_VERSION;
  const raw = arg ?? env;
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

export const runRotation = async (targetVersion: number) => {
  const tokens = await prisma.dongleToken.findMany({
    where: { keyVersion: { not: targetVersion } },
    include: { dongle: { select: { ownerUserId: true } } },
  });

  let rotated = 0;
  let skipped = 0;

  for (const record of tokens) {
    const ownerUserId = record.dongle.ownerUserId;
    if (!ownerUserId) {
      skipped += 1;
      console.warn(`[rotate] skipping dongle ${record.dongleId} (no owner_user_id)`);
      continue;
    }

    const aad = {
      dongleId: record.dongleId,
      userId: ownerUserId,
      createdAt: record.createdAt.toISOString(),
    };

    const plaintext = decryptDongleToken(
      {
        keyVersion: record.keyVersion,
        nonce: record.nonce,
        ciphertext: record.ciphertext,
        tag: record.tag,
      },
      aad
    );

    const envelope = encryptDongleToken(plaintext, aad, targetVersion);

    await prisma.dongleToken.update({
      where: { id: record.id },
      data: {
        keyVersion: envelope.keyVersion,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
        tag: envelope.tag,
      },
    });

    rotated += 1;
  }

  console.log(`[rotate] target_version=${targetVersion} rotated=${rotated} skipped=${skipped}`);

  await prisma.auditLog.create({
    data: {
      action: "DONGLE_TOKEN_ROTATED",
      targetType: "dongle_tokens",
      targetId: String(targetVersion),
      details: {
        target_version: targetVersion,
        rotated,
        skipped,
      },
    },
  });
};

const main = async () => {
  const keyring = getKeyring();
  const targetVersion = parseTargetVersion() ?? keyring.defaultVersion;
  await runRotation(targetVersion);
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("[rotate] failed", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
