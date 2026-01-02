-- CreateEnum
CREATE TYPE "CommandTarget" AS ENUM ('agent', 'dongle');

-- CreateEnum
CREATE TYPE "CommandSource" AS ENUM ('web', 'agent', 'system');

-- AlterTable
ALTER TABLE "commands"
ADD COLUMN "command_target" "CommandTarget" NOT NULL DEFAULT 'agent',
ADD COLUMN "command_source" "CommandSource" NOT NULL DEFAULT 'web',
ADD COLUMN "truncated" BOOLEAN NOT NULL DEFAULT false;
