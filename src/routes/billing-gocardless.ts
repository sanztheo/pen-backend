import express from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { gcClient } from "../lib/gocardless.js";
import { prisma } from "../lib/prisma.js";

export const billingGocardlessRouter = express.Router();

// POST /api/billing-gocardless/create-subscription-flow
billingGocardlessRouter.post(
  "/create-subscription-flow",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Extract user data from authenticated user (req.user) - NOT from req.body for security
      const email = req.user?.email;
      const given_name =
        req.user?.user_metadata?.firstName || email?.split("@")[0] || "";
      const family_name = req.user?.user_metadata?.lastName || "";

      if (!email) {
        return res.status(400).json({
          error: "Incomplete user profile",
          message:
            "Email is required. Please complete your profile in settings.",
        });
      }

      // 1. Check if customer already exists in our DB
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          gocardlessCustomerId: true,
          subscription: {
            select: {
              gocardlessCustomerId: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // 2. Get existing customer ID or create new customer
      let customerId = user.gocardlessCustomerId;

      if (!customerId) {
        // Check if customer ID exists in subscription
        customerId = user.subscription?.gocardlessCustomerId || null;
      }

      if (!customerId) {
        // Create new customer in GoCardless
        console.log(
          "[Billing GoCardless] Creating new customer for user:",
          userId,
        );

        const customer = await gcClient.customers.create({
          email: email,
          given_name: given_name,
          family_name: family_name,
          metadata: {
            clerk_user_id: userId,
            created_at: new Date().toISOString(),
          },
        });

        customerId = customer.id;
        console.log(
          "[Billing GoCardless] Customer created with ID:",
          customerId,
        );

        // Store customer ID in User table
        await prisma.user.update({
          where: { id: userId },
          data: { gocardlessCustomerId: customerId },
        });

        // Create or update UserSubscription record
        await prisma.userSubscription.upsert({
          where: { userId },
          create: {
            userId,
            plan: "free_user",
            status: "active",
            gocardlessCustomerId: customerId,
            paymentMethod: "gocardless",
            metadata: {
              customer_created_at: new Date().toISOString(),
            },
          },
          update: {
            gocardlessCustomerId: customerId,
            paymentMethod: "gocardless",
            updatedAt: new Date(),
          },
        });
      } else {
        console.log(
          "[Billing GoCardless] Using existing customer ID:",
          customerId,
        );
      }

      // 3. Create Billing Request for SEPA Direct Debit
      console.log(
        "[Billing GoCardless] Creating billing request for customer:",
        customerId,
      );

      const billingRequest = await gcClient.billingRequests.create({
        mandate_request: {
          scheme: "sepa_core", // SEPA Direct Debit scheme
          metadata: {
            user_id: userId,
            created_via: "subscription_flow",
          },
        },
        links: {
          customer: customerId,
        },
      });

      console.log(
        "[Billing GoCardless] Billing request created:",
        billingRequest.id,
      );

      // 4. Create Billing Request Flow
      const redirectUri = process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL}/billing/success`
        : "http://localhost:3000/billing/success";

      const exitUri = process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL}/billing/cancel`
        : "http://localhost:3000/billing/cancel";

      console.log("[Billing GoCardless] Creating billing request flow...");

      const flow = await gcClient.billingRequestFlows.create({
        redirect_uri: redirectUri,
        exit_uri: exitUri,
        links: {
          billing_request: billingRequest.id,
        },
        show_redirect_buttons: true,
        show_success_redirect_button: true,
      });

      console.log("[Billing GoCardless] Flow created:", {
        flowId: flow.id,
        authorisationUrl: flow.authorisation_url,
      });

      // 5. Return flow details to frontend
      return res.json({
        flowId: flow.id,
        authorisationUrl: flow.authorisation_url,
      });
    } catch (error: any) {
      console.error("[Billing GoCardless] Error creating subscription flow:", {
        message: error.message,
        statusCode: error.statusCode,
        errors: error.errors,
        stack: error.stack,
      });

      return res.status(500).json({
        error: "Failed to create subscription flow",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },
);

// GET /api/billing-gocardless/subscription-status
billingGocardlessRouter.get(
  "/subscription-status",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Fetch subscription with relevant GoCardless fields
      const subscription = await prisma.userSubscription.findUnique({
        where: { userId },
        select: {
          plan: true,
          gocardlessCustomerId: true,
          gocardlessMandateId: true,
          mandateStatus: true,
          nextPaymentDate: true,
          status: true,
          paymentMethod: true,
        },
      });

      // Return subscription status according to specs
      if (!subscription) {
        // User has no subscription, return free plan
        return res.json({
          plan: "free",
          gocardlessCustomerId: undefined,
          gocardlessMandateId: undefined,
          mandateStatus: undefined,
          nextPaymentDate: undefined,
        });
      }

      // Map plan to match response specs (free or premium)
      const planMapping: Record<string, "free" | "premium"> = {
        free_user: "free",
        premium_user: "premium",
        premium: "premium",
      };

      const mappedPlan = planMapping[subscription.plan] || "free";

      return res.json({
        plan: mappedPlan,
        gocardlessCustomerId: subscription.gocardlessCustomerId || undefined,
        gocardlessMandateId: subscription.gocardlessMandateId || undefined,
        mandateStatus: subscription.mandateStatus || undefined,
        nextPaymentDate:
          subscription.nextPaymentDate?.toISOString() || undefined,
      });
    } catch (error: any) {
      console.error(
        "[Billing GoCardless] Error fetching subscription status:",
        {
          message: error.message,
          stack: error.stack,
        },
      );

      return res.status(500).json({
        error: "Failed to fetch subscription status",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },
);

// POST /api/billing-gocardless/cancel-subscription
billingGocardlessRouter.post(
  "/cancel-subscription",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Fetch subscription with mandate information
      const subscription = await prisma.userSubscription.findUnique({
        where: { userId },
        select: {
          userId: true,
          gocardlessMandateId: true,
          gocardlessSubscriptionId: true,
          mandateStatus: true,
          plan: true,
          status: true,
        },
      });

      if (!subscription) {
        return res.status(404).json({
          error: "No subscription found for this user",
        });
      }

      // Check if there's an active mandate to cancel
      if (!subscription.gocardlessMandateId) {
        return res.status(400).json({
          error: "No GoCardless mandate found to cancel",
        });
      }

      // Check if mandate is already cancelled
      if (
        subscription.mandateStatus === "cancelled" ||
        subscription.mandateStatus === "failed"
      ) {
        return res.status(400).json({
          error: "Mandate is already cancelled or failed",
        });
      }

      console.log(
        "[Billing GoCardless] Cancelling mandate:",
        subscription.gocardlessMandateId,
      );

      try {
        // Cancel the mandate in GoCardless
        await gcClient.mandates.cancel(subscription.gocardlessMandateId, {
          metadata: {
            cancelled_by: userId,
            cancelled_at: new Date().toISOString(),
            reason: "user_requested",
          },
        });

        console.log("[Billing GoCardless] Mandate cancelled successfully");
      } catch (gcError: any) {
        // If mandate is already cancelled in GoCardless, continue with DB update
        if (
          gcError.statusCode === 409 ||
          gcError.message?.includes("already cancelled")
        ) {
          console.log(
            "[Billing GoCardless] Mandate was already cancelled in GoCardless",
          );
        } else {
          throw gcError;
        }
      }

      // Cancel subscription if exists
      if (subscription.gocardlessSubscriptionId) {
        try {
          await gcClient.subscriptions.cancel(
            subscription.gocardlessSubscriptionId,
            {
              metadata: {
                cancelled_by: userId,
                cancelled_at: new Date().toISOString(),
              },
            },
          );
          console.log(
            "[Billing GoCardless] Subscription cancelled successfully",
          );
        } catch (subError: any) {
          // Log but don't fail if subscription cancellation fails
          console.warn(
            "[Billing GoCardless] Could not cancel subscription:",
            subError.message,
          );
        }
      }

      // Update UserSubscription in database
      await prisma.userSubscription.update({
        where: { userId },
        data: {
          plan: "free_user",
          mandateStatus: "cancelled",
          status: "canceled",
          canceledAt: new Date(),
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
          metadata: {
            ...((subscription as any).metadata || {}),
            cancellation_date: new Date().toISOString(),
            cancellation_method: "user_requested",
          },
        },
      });

      // Reset user limits to free tier
      await prisma.userLimits.upsert({
        where: { userId },
        create: {
          userId,
          aiCreditsLimit: 50,
          workspacesLimit: 2,
          projectsLimit: 5,
          pagesLimit: 50,
          customQuizzesLimit: 5,
          presetSequencesLimit: 1,
          historyQuizzesLimit: 5,
          pagesSelectionLimit: 2,
          questionsPerQuizLimit: 10,
          advancedQuizzesLimit: 10,
          statsChartsLimit: ["progression-area", "difficulty-radar"],
          resetType: "monthly",
        },
        update: {
          aiCreditsLimit: 50,
          workspacesLimit: 2,
          projectsLimit: 5,
          pagesLimit: 50,
          customQuizzesLimit: 5,
          presetSequencesLimit: 1,
          historyQuizzesLimit: 5,
          pagesSelectionLimit: 2,
          questionsPerQuizLimit: 10,
          advancedQuizzesLimit: 10,
          statsChartsLimit: ["progression-area", "difficulty-radar"],
          resetType: "monthly",
          updatedAt: new Date(),
        },
      });

      console.log(
        "[Billing GoCardless] Subscription cancelled and user reverted to free plan",
      );

      return res.json({
        success: true,
        message: "Subscription cancelled successfully",
      });
    } catch (error: any) {
      console.error("[Billing GoCardless] Error cancelling subscription:", {
        message: error.message,
        statusCode: error.statusCode,
        errors: error.errors,
        stack: error.stack,
      });

      return res.status(500).json({
        error: "Failed to cancel subscription",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },
);

export default billingGocardlessRouter;
