-- CreateTable
CREATE TABLE "quiz_sequences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "preset" "QuizPreset" NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "current_subject_index" INTEGER NOT NULL DEFAULT 0,
    "total_subjects" INTEGER NOT NULL,
    "subjects" JSONB NOT NULL,
    "subjectResults" JSONB NOT NULL,
    "global_score" DOUBLE PRECISION,
    "global_max_score" DOUBLE PRECISION,
    "specialties" "LyceeSpecialty"[] DEFAULT ARRAY[]::"LyceeSpecialty"[],
    "higher_ed_field" VARCHAR(255),
    "workspace_ids" UUID[],
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quiz_sequences_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "quiz_sequences" ADD CONSTRAINT "quiz_sequences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
