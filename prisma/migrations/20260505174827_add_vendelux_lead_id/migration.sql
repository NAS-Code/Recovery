-- AlterTable
ALTER TABLE "leads" ADD COLUMN "vendelux_lead_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "leads_vendelux_lead_id_key" ON "leads"("vendelux_lead_id");
