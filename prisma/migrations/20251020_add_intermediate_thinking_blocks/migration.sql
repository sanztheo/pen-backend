-- AlterTable: Add intermediate_thinking_blocks JSON field to ai_messages
ALTER TABLE "ai_messages" ADD COLUMN "intermediate_thinking_blocks" JSONB DEFAULT '[]';

-- Create index for faster queries on messages with intermediate thinking
CREATE INDEX "idx_ai_messages_has_intermediate_thinking" ON "ai_messages" USING GIN ("intermediate_thinking_blocks");
