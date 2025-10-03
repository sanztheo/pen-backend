-- CreateEnum
CREATE TYPE "SchoolLevel" AS ENUM ('COLLEGE', 'LYCEE_SECONDE', 'LYCEE_PREMIERE', 'LYCEE_TERMINALE', 'ETUDES_SUPERIEURES');

-- CreateEnum
CREATE TYPE "LyceeSpecialty" AS ENUM ('MATHEMATIQUES', 'PHYSIQUE_CHIMIE', 'SVT', 'HISTOIRE_GEO', 'SES', 'LANGUES_LITTERATURE', 'LLCER_ANGLAIS', 'LLCER_ESPAGNOL', 'LLCER_ALLEMAND', 'LLCER_ITALIEN', 'ARTS_PLASTIQUES', 'MUSIQUE', 'THEATRE', 'CINEMA_AUDIOVISUEL', 'DANSE', 'HISTOIRE_DES_ARTS', 'NSI', 'SI', 'SCIENCES_INGENIEUR', 'BIOLOGIE_ECOLOGIE', 'SPORT');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('OPEN_QUESTION', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'MATCHING');

-- AlterTable
ALTER TABLE "blocks" ADD COLUMN     "parent_id" UUID;

-- CreateTable
CREATE TABLE "user_quiz_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "school_level" "SchoolLevel" NOT NULL,
    "lycee_specialties" "LyceeSpecialty"[],
    "higher_ed_field" VARCHAR(255),
    "preferred_workspace" UUID,
    "target_grade" DOUBLE PRECISION,
    "question_types" "QuestionType"[] DEFAULT ARRAY['MULTIPLE_CHOICE', 'TRUE_FALSE']::"QuestionType"[],
    "default_question_count" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_quiz_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "school_level" "SchoolLevel" NOT NULL,
    "lycee_specialties" "LyceeSpecialty"[],
    "higher_ed_field" VARCHAR(255),
    "workspace_ids" UUID[],
    "question_types" "QuestionType"[],
    "question_count" INTEGER NOT NULL DEFAULT 20,
    "target_grade" DOUBLE PRECISION,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quiz_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "school_level" "SchoolLevel" NOT NULL,
    "questions" JSONB NOT NULL,
    "user_answers" JSONB,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "time_spent" INTEGER,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quiz_id" UUID NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL,
    "max_score" DOUBLE PRECISION NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "adapted_grade" DOUBLE PRECISION NOT NULL,
    "grade_scale" VARCHAR(20) NOT NULL,
    "detailed_scoring" JSONB NOT NULL,
    "ai_correction" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "strengths" JSONB NOT NULL DEFAULT '[]',
    "weaknesses" JSONB NOT NULL DEFAULT '[]',
    "time_analysis" JSONB,
    "difficulty_analysis" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_quiz_preferences_user_id_key" ON "user_quiz_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_results_quiz_id_key" ON "quiz_results"("quiz_id");

-- CreateIndex
CREATE INDEX "idx_blocks_parent_id" ON "blocks"("parent_id");

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "blocks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_quiz_preferences" ADD CONSTRAINT "user_quiz_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_templates" ADD CONSTRAINT "quiz_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "quiz_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_results" ADD CONSTRAINT "quiz_results_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
