-- CreateEnum
CREATE TYPE "CollegeGrade" AS ENUM ('SIXIEME', 'CINQUIEME', 'QUATRIEME', 'TROISIEME');

-- CreateEnum
CREATE TYPE "QuizPreset" AS ENUM ('NONE', 'BREVET', 'BAC', 'PARTIELS');

-- CreateEnum
CREATE TYPE "ExamSubject" AS ENUM ('FRANCAIS', 'MATHEMATIQUES', 'HISTOIRE_GEOGRAPHIE_EMC', 'SCIENCES', 'PHILOSOPHIE', 'GRAND_ORAL', 'MATHEMATIQUES_SPE', 'PHYSIQUE_CHIMIE_SPE', 'SVT_SPE', 'SES_SPE', 'HGGSP_SPE', 'NSI_SPE', 'SI_SPE', 'LLCER_ANGLAIS_SPE', 'LLCER_ESPAGNOL_SPE', 'LLCER_ALLEMAND_SPE', 'LLCER_ITALIEN_SPE', 'ARTS_PLASTIQUES_SPE', 'MUSIQUE_SPE', 'THEATRE_SPE', 'CINEMA_AUDIOVISUEL_SPE', 'DANSE_SPE', 'HISTOIRE_DES_ARTS_SPE', 'BIOLOGIE_ECOLOGIE_SPE', 'SPORT_SPE');

-- AlterTable
ALTER TABLE "quiz_templates" ADD COLUMN     "college_grade" "CollegeGrade";

-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "ai_generated_title" VARCHAR(255),
ADD COLUMN     "college_grade" "CollegeGrade",
ADD COLUMN     "exam_subject" "ExamSubject",
ADD COLUMN     "higher_ed_field" VARCHAR(255),
ADD COLUMN     "is_sequential" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preset" "QuizPreset" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "selected_specialties" "LyceeSpecialty"[],
ADD COLUMN     "sequence_id" UUID,
ADD COLUMN     "sequence_order" INTEGER;

-- AlterTable
ALTER TABLE "user_quiz_preferences" ADD COLUMN     "college_grade" "CollegeGrade";
