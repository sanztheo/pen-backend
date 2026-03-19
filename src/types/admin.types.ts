/**
 * Admin Dashboard Types
 * Types for admin metrics, revenue, usage, and moderation endpoints
 */

export interface UserMetrics {
  totalUsers: number;
  activeUsers: number; // Last 30 days
  newUsers: number; // Last 7 days
  churnRate: number; // % users inactive > 30 days
  growthRate: number; // % change from previous period
}

export interface RevenueMetrics {
  mrr: number; // Monthly Recurring Revenue
  totalRevenue: number;
  freeUsers: number;
  premiumUsers: number;
  conversionRate: number; // Free to premium %
  arpu: number; // Average Revenue Per User
}

export interface UsageMetrics {
  totalAICreditsUsed: number;
  avgCreditsPerUser: number;
  totalQuizzesGenerated: number;
  avgQuizzesPerUser: number;
  topUsers: Array<{ userId: string; email: string; creditsUsed: number }>;
}

export interface ActivityLogEntry {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId?: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface ModerationFilters {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface PaginatedLogs {
  logs: ActivityLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminDashboardResponse {
  users: UserMetrics;
  revenue: RevenueMetrics;
  usage: UsageMetrics;
}

// User list for admin management
export interface UserListFilters {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
}

export interface UserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  workspacesCount: number;
  pagesCount: number;
  plan: "free_user" | "premium";
}

export interface PaginatedUsers {
  users: UserListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// User pages for admin viewing
export interface UserPageItem {
  id: string;
  title: string;
  icon: string | null;
  iconColor: string | null;
  createdAt: Date;
  updatedAt: Date;
  workspaceName: string;
  projectName: string | null;
}

export interface PaginatedUserPages {
  pages: UserPageItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Export job types
export interface AdminExportJobData {
  type: "admin-user-export";
  userId: string;
  adminEmail: string;
  filters: UserListFilters;
}

export interface AdminExportJobResult {
  success: boolean;
  downloadKey?: string;
  rowCount?: number;
  error?: string;
}

// ─── Beta Admin Types ───────────────────────────────────────────────────

export interface BetaMetricsCards {
  spotsUsed: number;
  totalSpots: number;
  waitlistCount: number;
  activeThisWeek: number;
  inactive7d: number;
  expired: number;
}

export interface BetaTrendPoint {
  date: string;
  active: number;
  waitlist: number;
  newActivations: number;
}

export interface BetaMetricsResponse {
  cards: BetaMetricsCards;
  trend: BetaTrendPoint[];
}

export interface BetaUserListFilters {
  page?: number;
  limit?: number;
  search?: string;
  betaStatus?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface BetaUserListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  betaStatus: string;
  lastHeartbeatAt: Date | null;
  weeklyActiveTimeSeconds: number;
  totalActiveTimeSeconds: number;
  betaJoinedAt: Date | null;
  betaDeactivatedAt: Date | null;
  betaReactivationDeadline: Date | null;
}

export interface PaginatedBetaUsers {
  users: BetaUserListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BetaActionResult {
  success: boolean;
  error?: string;
}

export interface BetaBulkResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
}

// ─── User Bulk Action Types ─────────────────────────────────────────────

export type UserBulkAction = "activate" | "deactivate";

export interface UserBulkResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
}

// ─── LTV Types ─────────────────────────────────────────────────────────────

export interface LtvSegment {
  name: string;
  userCount: number;
  arpu: number; // Average Revenue Per User (monthly)
  churnRate: number; // % of users who churned in last 90 days
  ltv: number; // ARPU × (1 / churnRate) — estimated lifetime value
}

export interface LtvMetricsResponse {
  segments: LtvSegment[];
  computedAt: string; // ISO date
}

// ─── Trends Metrics Types ─────────────────────────────────────────────────

export type TrendPeriod = "7d" | "30d" | "90d";

export interface TrendDataPoint {
  date: string; // ISO date string (YYYY-MM-DD or YYYY-WXX for weeks)
  value: number;
}

export interface TrendsMetricsResponse {
  period: TrendPeriod;
  granularity: "day" | "week";
  metrics: {
    users: TrendDataPoint[];
    mrr: TrendDataPoint[];
    credits: TrendDataPoint[];
    quizzes: TrendDataPoint[];
  };
}

// ─── Admin Alerts Types ───────────────────────────────────────────────────

export type AlertType = "CHURN_SPIKE" | "ERROR_RATE_HIGH" | "REVENUE_DROP" | "SIGNUPS_SPIKE";
export type AlertSeverityLevel = "INFO" | "WARNING" | "CRITICAL";

export interface AdminAlertItem {
  id: string;
  type: AlertType;
  severity: AlertSeverityLevel;
  message: string;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

export interface PaginatedAlerts {
  alerts: AdminAlertItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AlertFilters {
  page?: number;
  limit?: number;
  type?: AlertType;
  acknowledged?: boolean;
}

// ─── Admin Notes Types ──────────────────────────────────────────────────

export interface AdminNoteItem {
  id: string;
  userId: string;
  adminId: string;
  adminEmail: string;
  adminName: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedAdminNotes {
  notes: AdminNoteItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Retention Cohorts Types ──────────────────────────────────────────────

export interface CohortRetention {
  week: string; // "2026-W09"
  totalUsers: number;
  retention: number[]; // [100, 72, 58, 45] — percentage per week
}

export interface RetentionCohortsResponse {
  cohorts: CohortRetention[];
  maxWeeks: number;
}

// ─── AI Costs Types ─────────────────────────────────────────────────────

export interface AICostByModel {
  model: string;
  provider: string;
  totalCost: number;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  avgCostPerRequest: number;
}

export interface AICostByProvider {
  provider: string;
  totalCost: number;
  totalRequests: number;
  models: AICostByModel[];
}

export interface AICostTopUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  totalCost: number;
  totalRequests: number;
  aiCreditsUsed: number;
  topModel: string;
}

export interface ProviderBalance {
  provider: string;
  available: boolean;
  balance?: number;
  currency?: string;
  error?: string;
}

export interface AICostTrendPoint {
  date: string;
  cost: number;
  requests: number;
}

export interface AICostBySource {
  source: string;
  totalCost: number;
  totalRequests: number;
  avgCostPerRequest: number;
}

export interface CreditsBySource {
  source: string;
  totalCredits: number;
  totalRecords: number;
}

export interface PeriodComparison {
  currentCost: number;
  previousCost: number;
  costChangePercent: number;
  currentCredits: number;
  previousCredits: number;
  creditsChangePercent: number;
  currentRequests: number;
  previousRequests: number;
  requestsChangePercent: number;
}

export interface AICostTrendBySourcePoint {
  date: string;
  sources: Record<string, number>;
}

export interface AICostsResponse {
  byModel: AICostByModel[];
  byProvider: AICostByProvider[];
  topUsers: AICostTopUser[];
  trend: AICostTrendPoint[];
  balances: ProviderBalance[];
  bySource: AICostBySource[];
  creditsBySource: CreditsBySource[];
  comparison: PeriodComparison;
  trendBySource: AICostTrendBySourcePoint[];
}
