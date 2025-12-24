import { ErrorCodes } from "@dashboard/shared";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";

export const listDonglesForUser = async (userId: string, isAdmin: boolean) => {
  const where = isAdmin ? {} : { ownerUserId: userId };

  return prisma.dongle.findMany({
    where,
    orderBy: { lastSeenAt: "desc" },
  });
};

export const getDongleForUser = async (dongleId: string, userId: string, isAdmin: boolean) => {
  const dongle = await prisma.dongle.findUnique({
    where: { id: dongleId },
    include: { canConfig: true },
  });

  if (!dongle) {
    throw new AppError(ErrorCodes.DONGLE_NOT_FOUND, "Dongle not found.", 404);
  }

  if (!isAdmin && dongle.ownerUserId !== userId) {
    throw new AppError(ErrorCodes.DONGLE_OWNED_BY_OTHER, "Dongle not owned by user.", 403);
  }

  return dongle;
};
