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

      const { planId } = req.body; // 'premium'

      // 1. Récupérer user
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(404).json({ error: "User not found" });

      // 2. Déterminer montant selon plan
      const planAmounts: Record<string, number> = {
        premium: 900, // 9.00 EUR (montant en centimes)
      };

      const amount = planAmounts[planId];
      if (!amount) return res.status(400).json({ error: "Invalid plan" });

      // 3. Créer Customer GoCardless si inexistant
      let customerId = user.gocardlessCustomerId;

      if (!customerId) {
        const customer = await gcClient.customers.create({
          email: user.email,
          given_name: user.firstName,
          family_name: user.lastName,
          metadata: {
            clerk_user_id: userId,
          },
        });

        customerId = customer.id;

        // Sauvegarder dans DB
        await prisma.user.update({
          where: { id: userId },
          data: { gocardlessCustomerId: customerId },
        });
      }

      // 4. Créer Billing Request (subscription)
      const billingRequest = await gcClient.billingRequests.create({
        mandate_request: {
          scheme: "sepa_core", // ou 'bacs' pour UK
          metadata: {
            plan: planId,
          },
        },
        payment_request: {
          amount: amount,
          currency: "EUR",
          description: `Pennote ${planId} - Premier paiement`,
          metadata: {
            plan: planId,
            user_id: userId,
          },
        },
      });

      // 5. Créer Billing Request Flow (pour le frontend)
      const flow = await gcClient.billingRequestFlows.create({
        redirect_uri: `${process.env.FRONTEND_URL}/billing/success`,
        exit_uri: `${process.env.FRONTEND_URL}/billing/cancel`,
        links: {
          billing_request: billingRequest.id,
        },
      });

      // 6. Retourner Flow ID au frontend
      return res.json({
        flowId: flow.id,
        authorisationUrl: flow.authorisation_url,
      });
    } catch (error: any) {
      console.error("[Billing GoCardless] Error creating flow:", error);
      return res.status(500).json({
        error: "Failed to create billing flow",
        details: error.message,
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

      const subscription = await prisma.userSubscription.findUnique({
        where: { userId },
      });

      if (!subscription) {
        return res.json({ status: "none", plan: "free_user" });
      }

      return res.json({
        status: subscription.status,
        plan: subscription.plan,
        paymentMethod: subscription.paymentMethod,
        nextPaymentDate: subscription.nextPaymentDate,
        mandateStatus: subscription.mandateStatus,
      });
    } catch (error: any) {
      console.error("[Billing GoCardless] Error fetching status:", error);
      return res.status(500).json({ error: "Failed to fetch status" });
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

      const subscription = await prisma.userSubscription.findUnique({
        where: { userId },
      });

      if (!subscription?.gocardlessSubscriptionId) {
        return res.status(404).json({ error: "No active subscription" });
      }

      // Annuler dans GoCardless
      await gcClient.subscriptions.cancel(
        subscription.gocardlessSubscriptionId,
      );

      // Mettre à jour DB
      await prisma.userSubscription.update({
        where: { userId },
        data: {
          status: "canceled",
          updatedAt: new Date(),
        },
      });

      return res.json({ success: true, message: "Subscription cancelled" });
    } catch (error: any) {
      console.error("[Billing GoCardless] Error cancelling:", error);
      return res.status(500).json({ error: "Failed to cancel subscription" });
    }
  },
);

export default billingGocardlessRouter;
