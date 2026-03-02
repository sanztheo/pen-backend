// ─── Constants ────────────────────────────────────────────
export const EXPORT_MAX_ITEMS = 1000;
export const DELETION_LOG_PREFIX = "[ACCOUNT_DELETION]";
export const DELETION_LOCK_KEY = "account_deletion:cleanup_lock";
export const DELETION_LOCK_TTL_SECONDS = 300;

// ─── Audit ────────────────────────────────────────────────
export interface DeletionAuditEntry {
  userId: string;
  maskedEmail: string;
  deletedAt: string;
  reason: "user_request" | "expired_account" | "admin_action";
}

// ─── Export Types ─────────────────────────────────────────
export interface ExportedProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  lastLoginAt: string | null;
  settings: unknown;
}

export interface ExportedPage {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  projectId: string | null;
}

export interface ExportedProject {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  workspaceId: string;
}

export interface ExportedQuiz {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface ExportedConversation {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string | null;
}

export interface ExportedActivityLog {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
}

export interface ExportedSubscription {
  plan: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export interface UserExportData {
  exportedAt: string;
  profile: ExportedProfile;
  pages: ExportedPage[];
  projects: ExportedProject[];
  quizzes: ExportedQuiz[];
  conversations: ExportedConversation[];
  activityLogs: ExportedActivityLog[];
  subscription: ExportedSubscription | null;
}
