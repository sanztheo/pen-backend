-- CreateEnum
CREATE TYPE "public"."AIMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "public"."ai_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" VARCHAR(255) NOT NULL,
    "workspace_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "role" "public"."AIMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "mentions" JSONB DEFAULT '[]',
    "files" JSONB DEFAULT '[]',
    "wikipedia_sources" JSONB DEFAULT '[]',
    "mode" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_idx" ON "public"."ai_conversations"("user_id");

-- CreateIndex
CREATE INDEX "ai_conversations_workspace_id_idx" ON "public"."ai_conversations"("workspace_id");

-- CreateIndex
CREATE INDEX "ai_conversations_is_active_last_message_at_idx" ON "public"."ai_conversations"("is_active", "last_message_at");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_is_active_updated_at_idx" ON "public"."ai_conversations"("user_id", "is_active", "updated_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_idx" ON "public"."ai_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "public"."ai_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
