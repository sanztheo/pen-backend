-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('free_user', 'premium');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'trialing', 'unpaid');

-- CreateTable
CREATE TABLE "user_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" VARCHAR(255) NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'free_user',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "clerk_subscription_id" VARCHAR(255),
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(6),
    "trial_start" TIMESTAMPTZ(6),
    "trial_end" TIMESTAMPTZ(6),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" VARCHAR(255) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_subscriptions_user_id_key" ON "user_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "user_subscriptions_clerk_subscription_id_idx" ON "user_subscriptions"("clerk_subscription_id");

-- CreateIndex
CREATE INDEX "usage_records_user_id_resource_type_idx" ON "usage_records"("user_id", "resource_type");

-- CreateIndex
CREATE INDEX "usage_records_created_at_idx" ON "usage_records"("created_at");

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
