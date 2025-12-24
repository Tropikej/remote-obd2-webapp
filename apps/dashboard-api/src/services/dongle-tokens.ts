import { prisma } from "../db";
import { decryptDongleToken, encryptDongleToken } from "../crypto/dongle-token";

type CreateEncryptedDongleTokenInput = {
  dongleId: string;
  userId: string;
  token: string;
};

export const createEncryptedDongleToken = async ({
  dongleId,
  userId,
  token,
}: CreateEncryptedDongleTokenInput) => {
  const createdAt = new Date();
  const aad = { dongleId, userId, createdAt: createdAt.toISOString() };
  const envelope = encryptDongleToken(token, aad);

  return prisma.dongleToken.upsert({
    where: { dongleId },
    create: {
      dongleId,
      keyVersion: envelope.keyVersion,
      nonce: envelope.nonce,
      ciphertext: envelope.ciphertext,
      tag: envelope.tag,
      createdAt,
    },
    update: {
      keyVersion: envelope.keyVersion,
      nonce: envelope.nonce,
      ciphertext: envelope.ciphertext,
      tag: envelope.tag,
      createdAt,
    },
  });
};

export const getDecryptedDongleToken = async (dongleId: string, userId: string) => {
  const record = await prisma.dongleToken.findUnique({ where: { dongleId } });
  if (!record) {
    return null;
  }

  const aad = {
    dongleId,
    userId,
    createdAt: record.createdAt.toISOString(),
  };

  return decryptDongleToken(
    {
      keyVersion: record.keyVersion,
      nonce: record.nonce,
      ciphertext: record.ciphertext,
      tag: record.tag,
    },
    aad
  );
};
