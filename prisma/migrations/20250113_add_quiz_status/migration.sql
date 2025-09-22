-- Migration: Add status field to Quiz model for streaming support
-- Created: 2025-01-13

-- Add status column to Quiz table
ALTER TABLE "quizzes" ADD COLUMN "status" VARCHAR(20) DEFAULT 'ready';

-- Create index for efficient status queries
CREATE INDEX "idx_quizzes_status" ON "quizzes"("status");

-- Add comment for documentation
COMMENT ON COLUMN "quizzes"."status" IS 'Quiz generation status: generating, ready, error';