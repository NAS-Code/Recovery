-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE 'pending_client_approval';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "proposed_meeting_time" TIMESTAMP(3);
