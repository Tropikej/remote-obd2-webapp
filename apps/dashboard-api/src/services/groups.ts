import { ErrorCodes } from "@dashboard/shared";
import type { GroupMode } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors/app-error";

const toResponse = (group: any) => ({
  id: group.id,
  user_id: group.userId,
  dongle_a_id: group.dongleAId,
  dongle_b_id: group.dongleBId,
  mode: group.mode,
  created_at: group.createdAt?.toISOString?.() ?? group.createdAt,
  updated_at: group.updatedAt?.toISOString?.() ?? group.updatedAt,
});

export const listGroupsForUser = async (userId: string, isAdmin: boolean) => {
  const groups = await prisma.dongleGroup.findMany({
    where: isAdmin ? {} : { userId },
    orderBy: { createdAt: "desc" },
  });
  return groups.map(toResponse);
};

const assertOwnership = async (dongleId: string, userId: string, isAdmin: boolean) => {
  const dongle = await prisma.dongle.findUnique({ where: { id: dongleId } });
  if (!dongle) {
    throw new AppError(ErrorCodes.DONGLE_NOT_FOUND, "Dongle not found.", 404);
  }
  if (!isAdmin && dongle.ownerUserId !== userId) {
    throw new AppError(ErrorCodes.DONGLE_OWNED_BY_OTHER, "Dongle is owned by another user.", 403);
  }
  return dongle;
};

const assertNotGrouped = async (dongleId: string) => {
  const inGroup = await prisma.dongleGroup.findFirst({
    where: { OR: [{ dongleAId: dongleId }, { dongleBId: dongleId }] },
  });
  if (inGroup) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      "Dongle is already part of a group.",
      400
    );
  }
};

export const createGroup = async (
  userId: string,
  input: { dongleAId: string; dongleBId: string },
  isAdmin: boolean
) => {
  if (!input.dongleAId || !input.dongleBId || input.dongleAId === input.dongleBId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid dongle ids for group.", 400);
  }

  await assertOwnership(input.dongleAId, userId, isAdmin);
  await assertOwnership(input.dongleBId, userId, isAdmin);
  await assertNotGrouped(input.dongleAId);
  await assertNotGrouped(input.dongleBId);

  const group = await prisma.dongleGroup.create({
    data: {
      userId,
      dongleAId: input.dongleAId,
      dongleBId: input.dongleBId,
      mode: "INACTIVE",
    },
  });

  return toResponse(group);
};

const loadGroupForUser = async (groupId: string, userId: string, isAdmin: boolean) => {
  const group = await prisma.dongleGroup.findUnique({ where: { id: groupId } });
  if (!group) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Group not found.", 404);
  }
  if (!isAdmin && group.userId !== userId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Group not found.", 404);
  }
  return group;
};

export const deactivateGroup = async (groupId: string, userId: string, isAdmin: boolean) => {
  const group = await loadGroupForUser(groupId, userId, isAdmin);
  if (group.mode === "INACTIVE") {
    return toResponse(group);
  }
  const updated = await prisma.dongleGroup.update({
    where: { id: group.id },
    data: { mode: "INACTIVE" },
  });
  return toResponse(updated);
};

export const activateGroup = async (groupId: string, userId: string, isAdmin: boolean) => {
  const group = await loadGroupForUser(groupId, userId, isAdmin);
  if (group.mode === "ACTIVE") {
    return toResponse(group);
  }
  const updated = await prisma.dongleGroup.update({
    where: { id: group.id },
    data: { mode: "ACTIVE" },
  });
  return toResponse(updated);
};

export const markGroupMode = async (groupId: string, mode: GroupMode) => {
  const current = await prisma.dongleGroup.findUnique({ where: { id: groupId } });
  if (!current || current.mode === mode) {
    return current ? toResponse(current) : null;
  }
  const updated = await prisma.dongleGroup.update({
    where: { id: groupId },
    data: { mode },
  });
  return toResponse(updated);
};
