-- CreateTable
CREATE TABLE "campaign_credentials" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_credentials_username_key" ON "campaign_credentials"("username");

-- CreateIndex
CREATE INDEX "campaign_credentials_team_id_event_id_idx" ON "campaign_credentials"("team_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_sessions_token_key" ON "campaign_sessions"("token");

-- CreateIndex
CREATE INDEX "campaign_sessions_token_idx" ON "campaign_sessions"("token");

-- CreateIndex
CREATE INDEX "campaign_sessions_expires_at_idx" ON "campaign_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "campaign_sessions" ADD CONSTRAINT "campaign_sessions_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "campaign_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
