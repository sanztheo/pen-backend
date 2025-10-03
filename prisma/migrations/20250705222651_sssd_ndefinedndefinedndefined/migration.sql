/*
  Warnings:

  - You are about to drop the column `block_id` on the `activity_logs` table. All the data in the column will be lost.
  - You are about to drop the `blocks` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_block_id_fkey";

-- DropForeignKey
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_created_by_fkey";

-- DropForeignKey
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_page_id_fkey";

-- DropForeignKey
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_parent_id_fkey";

-- AlterTable
ALTER TABLE "activity_logs" DROP COLUMN "block_id";

-- DropTable
DROP TABLE "blocks";
