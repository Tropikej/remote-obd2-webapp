-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'super_admin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "OwnershipState" AS ENUM ('UNCLAIMED', 'CLAIMED_ACTIVE', 'RESET_DETECTED', 'SECURITY_HOLD');

-- CreateEnum
CREATE TYPE "GroupMode" AS ENUM ('INACTIVE', 'ACTIVE', 'DEGRADED');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('queued', 'running', 'done', 'error', 'timeout');

-- CreateEnum
CREATE TYPE "CanMode" AS ENUM ('normal', 'listen_only', 'loopback', 'ext_loop');

-- CreateEnum
CREATE TYPE "EmailOutboxStatus" AS ENUM ('queued', 'sent', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "agent_name" VARCHAR(128),
    "hostname" VARCHAR(255) NOT NULL,
    "os" VARCHAR(128) NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "last_seen_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tokens" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(6),

    CONSTRAINT "agent_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dongles" (
    "id" UUID NOT NULL,
    "device_id" CHAR(16) NOT NULL,
    "owner_user_id" UUID,
    "ownership_state" "OwnershipState" NOT NULL DEFAULT 'UNCLAIMED',
    "last_seen_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "dongles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dongle_tokens" (
    "id" UUID NOT NULL,
    "dongle_id" UUID NOT NULL,
    "key_version" INTEGER NOT NULL,
    "nonce" BYTEA NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "tag" BYTEA NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dongle_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dongle_groups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "dongle_a_id" UUID NOT NULL,
    "dongle_b_id" UUID NOT NULL,
    "mode" "GroupMode" NOT NULL DEFAULT 'INACTIVE',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "dongle_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "can_configs" (
    "id" UUID NOT NULL,
    "dongle_id" UUID NOT NULL,
    "bitrate" INTEGER NOT NULL,
    "sample_point_permille" INTEGER NOT NULL,
    "mode" "CanMode" NOT NULL,
    "use_raw" BOOLEAN NOT NULL,
    "prescaler" INTEGER NOT NULL,
    "sjw" INTEGER NOT NULL,
    "tseg1" INTEGER NOT NULL,
    "tseg2" INTEGER NOT NULL,
    "auto_retx" BOOLEAN NOT NULL,
    "tx_pause" BOOLEAN NOT NULL,
    "protocol_exc" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "can_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commands" (
    "id" UUID NOT NULL,
    "dongle_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "command" VARCHAR(255) NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'queued',
    "stdout" TEXT NOT NULL DEFAULT '',
    "stderr" TEXT NOT NULL DEFAULT '',
    "exit_code" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(6),
    "finished_at" TIMESTAMP(6),

    CONSTRAINT "commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(128) NOT NULL,
    "target_type" VARCHAR(64) NOT NULL,
    "target_id" VARCHAR(255) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "details" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(6),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL,
    "to_email" VARCHAR(320) NOT NULL,
    "template" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EmailOutboxStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "agents_user_id_idx" ON "agents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tokens_token_hash_key" ON "agent_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "agent_tokens_agent_id_idx" ON "agent_tokens"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "dongles_device_id_key" ON "dongles"("device_id");

-- CreateIndex
CREATE INDEX "dongles_owner_user_id_idx" ON "dongles"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dongle_tokens_dongle_id_key" ON "dongle_tokens"("dongle_id");

-- CreateIndex
CREATE UNIQUE INDEX "dongle_groups_dongle_a_id_key" ON "dongle_groups"("dongle_a_id");

-- CreateIndex
CREATE UNIQUE INDEX "dongle_groups_dongle_b_id_key" ON "dongle_groups"("dongle_b_id");

-- CreateIndex
CREATE INDEX "dongle_groups_user_id_idx" ON "dongle_groups"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dongle_groups_dongle_a_id_dongle_b_id_key" ON "dongle_groups"("dongle_a_id", "dongle_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "can_configs_dongle_id_key" ON "can_configs"("dongle_id");

-- CreateIndex
CREATE INDEX "commands_dongle_id_created_at_idx" ON "commands"("dongle_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dongles" ADD CONSTRAINT "dongles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dongle_tokens" ADD CONSTRAINT "dongle_tokens_dongle_id_fkey" FOREIGN KEY ("dongle_id") REFERENCES "dongles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dongle_groups" ADD CONSTRAINT "dongle_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dongle_groups" ADD CONSTRAINT "dongle_groups_dongle_a_id_fkey" FOREIGN KEY ("dongle_a_id") REFERENCES "dongles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dongle_groups" ADD CONSTRAINT "dongle_groups_dongle_b_id_fkey" FOREIGN KEY ("dongle_b_id") REFERENCES "dongles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "can_configs" ADD CONSTRAINT "can_configs_dongle_id_fkey" FOREIGN KEY ("dongle_id") REFERENCES "dongles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_dongle_id_fkey" FOREIGN KEY ("dongle_id") REFERENCES "dongles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheck
ALTER TABLE "dongle_groups" ADD CONSTRAINT "dongle_groups_dongle_a_id_dongle_b_id_check" CHECK ("dongle_a_id" <> "dongle_b_id");
