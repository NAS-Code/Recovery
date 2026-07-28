-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('initial_outreach', 'auto_reply', 'inbound_reply', 'eod_checkin', 'virtual_offer');

-- AlterTable
ALTER TABLE "campaign_credentials" ALTER COLUMN "password_plain" DROP DEFAULT;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "message_type" "MessageType";
