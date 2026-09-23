-- AlterTable
ALTER TABLE "leads" ADD COLUMN "source_lead_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "leads_source_lead_id_key" ON "leads"("source_lead_id");
