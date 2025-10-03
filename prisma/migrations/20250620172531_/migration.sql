/*
  Warnings:

  - You are about to drop the column `created_at` on the `blocks` table. All the data in the column will be lost.
  - You are about to drop the column `deleted_at` on the `blocks` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `blocks` table. All the data in the column will be lost.
  - You are about to drop the column `email_verified` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `password_hash` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "blocks" DROP COLUMN "created_at",
DROP COLUMN "deleted_at",
DROP COLUMN "updated_at";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "email_verified",
DROP COLUMN "password_hash",
ADD COLUMN     "autocompletion_enabled" BOOLEAN NOT NULL DEFAULT true;
