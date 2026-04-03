-- CreateTable
CREATE TABLE "page_edit_snapshots" (
    "id" TEXT NOT NULL,
    "page_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "tool_name" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_edit_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_edit_snapshots_page_id_created_at_idx" ON "page_edit_snapshots"("page_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "page_edit_snapshots" ADD CONSTRAINT "page_edit_snapshots_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
