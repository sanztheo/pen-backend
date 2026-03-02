import type { BetaStatus, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

// ─── Constants ────────────────────────────────────────────
export const DELETION_MAX_RETRIES = 3;
export const DELETION_BASE_DELAY_MS = 50;

// ─── Deletion Audit ───────────────────────────────────────
export interface DeletionAuditData {
  /** Redacted email — never store raw PII in audit logs */
  maskedEmail: string;
  betaStatus: BetaStatus;
  createdAt: Date;
  plan: SubscriptionPlan | null;
  deletedAt: Date;
}

// ─── Deletion Result ──────────────────────────────────────
export interface DeletionResult {
  success: boolean;
  deletedUserId: string;
  audit: DeletionAuditData;
}

// ─── User Export Data ─────────────────────────────────────
export interface UserExportProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  betaStatus: BetaStatus;
  betaJoinedAt: Date | null;
  onboardingCompleted: boolean;
  settings: unknown;
}

export interface UserExportWorkspace {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  createdAt: Date;
  isArchived: boolean;
  members: Array<{
    userId: string;
    role: string;
    joinedAt: Date | null;
  }>;
}

export interface UserExportPage {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  workspaceId: string;
  projectId: string | null;
  blockNoteContent: unknown;
}

export interface UserExportQuiz {
  id: string;
  title: string;
  createdAt: Date;
  isCompleted: boolean;
  completedAt: Date | null;
  questions: unknown;
  userAnswers: unknown;
}

export interface UserExportConversation {
  id: string;
  title: string;
  createdAt: Date;
  messageCount: number;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
  }>;
}

export interface UserExportActivityLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  details: unknown;
}

export interface UserExportSubscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

export interface UserExportData {
  profile: UserExportProfile;
  workspaces: UserExportWorkspace[];
  pages: UserExportPage[];
  quizzes: UserExportQuiz[];
  conversations: UserExportConversation[];
  activityLogs: UserExportActivityLog[];
  subscription: UserExportSubscription | null;
  /** True when any collection was truncated to EXPORT_MAX_ITEMS */
  truncated?: boolean;
}
