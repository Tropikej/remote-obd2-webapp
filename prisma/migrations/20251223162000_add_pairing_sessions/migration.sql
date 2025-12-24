-- CreateEnum
CREATE TYPE "PairingStatus" AS ENUM ('ACTIVE', 'SUCCESS', 'FAILED', 'EXPIRED', 'HOLD');

-- CreateTable
CREATE TABLE "pairing_sessions" (
    "id" UUID NOT NULL,
    "dongle_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "PairingStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "hold_until" TIMESTAMP(6),
    "hold_reason" VARCHAR(128),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "pairing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pairing_sessions_dongle_id_status_idx" ON "pairing_sessions"("dongle_id", "status");

-- CreateIndex
CREATE INDEX "pairing_sessions_user_id_idx" ON "pairing_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "pairing_sessions" ADD CONSTRAINT "pairing_sessions_dongle_id_fkey" FOREIGN KEY ("dongle_id") REFERENCES "dongles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_sessions" ADD CONSTRAINT "pairing_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
