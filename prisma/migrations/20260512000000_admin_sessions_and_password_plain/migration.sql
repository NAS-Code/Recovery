-- AlterTable: add password_plain column to campaign_credentials
ALTER TABLE "campaign_credentials" ADD COLUMN "password_plain" TEXT NOT NULL DEFAULT '';

-- DropIndex: remove the old single-column index on (team_id, event_id) if it exists
DROP INDEX IF EXISTS "campaign_credentials_team_id_event_id_idx";

-- CreateIndex: add unique constraint on (team_id, event_id)
CREATE UNIQUE INDEX "campaign_credentials_team_id_event_id_key" ON "campaign_credentials"("team_id", "event_id");

-- CreateTable: admin_sessions
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_key" ON "admin_sessions"("token");

-- CreateIndex
CREATE INDEX "admin_sessions_token_idx" ON "admin_sessions"("token");
