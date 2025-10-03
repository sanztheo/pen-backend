-- CreateEnum
CREATE TYPE "public"."RAGSourceType" AS ENUM ('PDF', 'WIKIPEDIA', 'WEB_PAGE', 'WORKSPACE_PAGE', 'TEXT_FILE');

-- CreateEnum
CREATE TYPE "public"."RAGSourceStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED', 'INDEXING');

-- CreateTable
CREATE TABLE "public"."rag_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" VARCHAR(255),
    "workspace_id" UUID,
    "source_type" "public"."RAGSourceType" NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "original_url" TEXT,
    "file_name" VARCHAR(255),
    "file_size" INTEGER,
    "mime_type" VARCHAR(100),
    "total_pages" INTEGER,
    "total_chunks" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "public"."RAGSourceStatus" NOT NULL DEFAULT 'PROCESSING',
    "error_message" TEXT,
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rag_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rag_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "clean_content" TEXT NOT NULL,
    "embedding" TEXT,
    "token_count" INTEGER NOT NULL,
    "page_number" INTEGER,
    "section_title" VARCHAR(255),
    "start_offset" INTEGER,
    "end_offset" INTEGER,
    "quality" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "language" VARCHAR(5) NOT NULL DEFAULT 'fr',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rag_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" VARCHAR(255) NOT NULL,
    "workspace_id" UUID,
    "session_key" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255),
    "queries" JSONB NOT NULL DEFAULT '[]',
    "responses" JSONB NOT NULL DEFAULT '[]',
    "context" JSONB NOT NULL DEFAULT '{}',
    "total_queries" INTEGER NOT NULL DEFAULT 0,
    "last_query_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rag_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_SessionSources" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_SessionSources_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "rag_sources_user_id_source_type_idx" ON "public"."rag_sources"("user_id", "source_type");

-- CreateIndex
CREATE INDEX "rag_sources_workspace_id_idx" ON "public"."rag_sources"("workspace_id");

-- CreateIndex
CREATE INDEX "rag_sources_status_idx" ON "public"."rag_sources"("status");

-- CreateIndex
CREATE INDEX "rag_sources_is_global_source_type_title_idx" ON "public"."rag_sources"("is_global", "source_type", "title");

-- CreateIndex
CREATE INDEX "rag_sources_title_source_type_idx" ON "public"."rag_sources"("title", "source_type");

-- CreateIndex
CREATE INDEX "rag_chunks_source_id_idx" ON "public"."rag_chunks"("source_id");

-- CreateIndex
CREATE INDEX "rag_chunks_quality_idx" ON "public"."rag_chunks"("quality");

-- CreateIndex
CREATE UNIQUE INDEX "rag_chunks_source_id_chunk_index_key" ON "public"."rag_chunks"("source_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "rag_sessions_session_key_key" ON "public"."rag_sessions"("session_key");

-- CreateIndex
CREATE INDEX "rag_sessions_user_id_idx" ON "public"."rag_sessions"("user_id");

-- CreateIndex
CREATE INDEX "rag_sessions_workspace_id_idx" ON "public"."rag_sessions"("workspace_id");

-- CreateIndex
CREATE INDEX "rag_sessions_session_key_idx" ON "public"."rag_sessions"("session_key");

-- CreateIndex
CREATE INDEX "rag_sessions_is_active_last_query_at_idx" ON "public"."rag_sessions"("is_active", "last_query_at");

-- CreateIndex
CREATE INDEX "_SessionSources_B_index" ON "public"."_SessionSources"("B");

-- AddForeignKey
ALTER TABLE "public"."rag_sources" ADD CONSTRAINT "rag_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rag_sources" ADD CONSTRAINT "rag_sources_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rag_chunks" ADD CONSTRAINT "rag_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."rag_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rag_sessions" ADD CONSTRAINT "rag_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rag_sessions" ADD CONSTRAINT "rag_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_SessionSources" ADD CONSTRAINT "_SessionSources_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."rag_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_SessionSources" ADD CONSTRAINT "_SessionSources_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."rag_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
