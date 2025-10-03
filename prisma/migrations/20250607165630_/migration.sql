/*
  Warnings:

  - You are about to drop the column `is_deleted` on the `blocks` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "blocks" DROP COLUMN "is_deleted";
