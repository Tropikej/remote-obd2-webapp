-- AlterTable
ALTER TABLE "dongles" ADD COLUMN     "capabilities" INTEGER,
ADD COLUMN     "fw_build" VARCHAR(64),
ADD COLUMN     "lan_ip" VARCHAR(64),
ADD COLUMN     "last_seen_agent_id" UUID,
ADD COLUMN     "pairing_nonce" BYTEA,
ADD COLUMN     "pairing_state" INTEGER,
ADD COLUMN     "proto_ver" INTEGER,
ADD COLUMN     "udp_port" INTEGER;

-- CreateIndex
CREATE INDEX "dongles_last_seen_agent_id_idx" ON "dongles"("last_seen_agent_id");

-- AddForeignKey
ALTER TABLE "dongles" ADD CONSTRAINT "dongles_last_seen_agent_id_fkey" FOREIGN KEY ("last_seen_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
