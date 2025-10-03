-- CreateTable
CREATE TABLE "public"."updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "date" TIMESTAMPTZ(6) NOT NULL,
    "image_url" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "updates_pkey" PRIMARY KEY ("id")
);
