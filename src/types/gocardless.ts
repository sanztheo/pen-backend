export interface GoCardlessWebhookEvent {
  id: string;
  created_at: string;
  resource_type:
    | "payments"
    | "mandates"
    | "subscriptions"
    | "refunds"
    | "payouts"
    | "billing_requests";
  action: string;
  links: {
    payment?: string;
    mandate?: string;
    subscription?: string;
    customer?: string;
    refund?: string;
    payout?: string;
    creditor?: string;
    instalment_schedule?: string;
    // Billing Request Flow specific links
    billing_request?: string;
    customer_bank_account?: string;
    mandate_request_mandate?: string;
  };
  details?: {
    origin?: string;
    cause?: string;
    description?: string;
    scheme?: string;
    reason_code?: string;
    will_attempt_retry?: boolean;
  };
  metadata?: Record<string, any>;
}

export interface GoCardlessWebhookPayload {
  events: GoCardlessWebhookEvent[];
}

export interface GoCardlessWebhookHeaders {
  "webhook-signature": string;
}

// Types d'actions par ressource
export type PaymentActions =
  | "created"
  | "customer_approval_granted"
  | "customer_approval_denied"
  | "submitted"
  | "confirmed"
  | "cancelled"
  | "failed"
  | "paid_out"
  | "late_failure_settled"
  | "chargeback_cancelled"
  | "chargeback_settled"
  | "resubmission_requested";

export type MandateActions =
  | "created"
  | "customer_approval_granted"
  | "customer_approval_skipped"
  | "active"
  | "cancelled"
  | "failed"
  | "transferred"
  | "expired"
  | "submitted"
  | "resubmission_requested"
  | "reinstated"
  | "replaced"
  | "consumed";

export type SubscriptionActions =
  | "created"
  | "customer_approval_granted"
  | "customer_approval_denied"
  | "payment_created"
  | "cancelled"
  | "finished"
  | "resumed"
  | "paused"
  | "amended";

export type RefundActions =
  | "created"
  | "pending"
  | "paid"
  | "funds_returned"
  | "failed";

export type PayoutActions = "paid";

// Type helper pour identifier le type d'événement
export interface TypedWebhookEvent<
  T extends GoCardlessWebhookEvent["resource_type"],
  A extends string = string,
> extends GoCardlessWebhookEvent {
  resource_type: T;
  action: A;
}

// Types spécifiques pour chaque type d'événement important
export type PaymentConfirmedEvent = TypedWebhookEvent<"payments", "confirmed">;
export type PaymentFailedEvent = TypedWebhookEvent<"payments", "failed">;
export type MandateCreatedEvent = TypedWebhookEvent<"mandates", "created">;
export type MandateActiveEvent = TypedWebhookEvent<"mandates", "active">;
export type MandateCancelledEvent = TypedWebhookEvent<"mandates", "cancelled">;
export type MandateFailedEvent = TypedWebhookEvent<"mandates", "failed">;
export type SubscriptionCreatedEvent = TypedWebhookEvent<
  "subscriptions",
  "created"
>;
export type SubscriptionFinishedEvent = TypedWebhookEvent<
  "subscriptions",
  "finished"
>;

// Billing Request Flow events
export type BillingRequestFulfilledEvent = TypedWebhookEvent<
  "billing_requests",
  "fulfilled"
>;
