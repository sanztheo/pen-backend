-- CreateTable
CREATE TABLE "yjs_documents" (
    "id" TEXT NOT NULL,
    "page_id" UUID NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yjs_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yjs_updates" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yjs_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "yjs_documents_page_id_key" ON "yjs_documents"("page_id");

-- AddForeignKey
ALTER TABLE "yjs_documents" ADD CONSTRAINT "yjs_documents_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yjs_updates" ADD CONSTRAINT "yjs_updates_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "yjs_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
