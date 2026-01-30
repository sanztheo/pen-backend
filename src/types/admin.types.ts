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
