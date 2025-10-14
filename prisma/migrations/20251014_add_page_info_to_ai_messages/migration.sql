-- AlterTable
ALTER TABLE "ai_messages" 
ADD COLUMN "page_id" UUID,
ADD COLUMN "page_title" VARCHAR(255);

-- CreateIndex
CREATE INDEX "ai_messages_page_id_idx" ON "ai_messages"("page_id");

-- AddForeignKey
ALTER TABLE "ai_messages" 
ADD CONSTRAINT "ai_messages_page_id_fkey" 
FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

