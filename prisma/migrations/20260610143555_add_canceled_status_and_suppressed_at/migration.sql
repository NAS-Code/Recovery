-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE 'canceled';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "suppressed_at" TIMESTAMP(3);
