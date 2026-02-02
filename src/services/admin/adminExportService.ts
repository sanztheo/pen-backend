/**
 * Admin Export Service
 * Generates CSV exports of user data for admin dashboard
 * Implements RGPD-compliant field selection and 10k row limit
 */

import { logger } from "../../utils/logger.js";
import Papa from "papaparse";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { UserListFilters, UserListItem } from "../../types/admin.types.js";

const MAX_EXPORT_ROWS = 10000;
const BATCH_SIZE = 500;

const CSV_HEADERS = [
  "Email",
  "Nom",
  "Plan",
  "Status",
  "Date inscription",
  "Dernière connexion",
  "Workspaces",
  "Pages",
] as const;

interface CSVRow {
  Email: string;
  Nom: string;
  Plan: string;
  Status: string;
  "Date inscription": string;
  "Dernière connexion": string;
  Workspaces: number;
  Pages: number;
}

export class AdminExportService {
  /**
   * Generate CSV string from user data
   * Fetches users in batches to avoid memory overload
   */
  static async generateUserCSV(
    filters: UserListFilters,
    adminEmail: string,
  ): Promise<{ csv: string; rowCount: number }> {
    logger.log(
      "[ADMIN_EXPORT] Starting CSV generation with filters:",
      filters,
    );

    const where = this.buildWhereClause(filters);
    const totalCount = await prisma.user.count({ where });
    const rowsToExport = Math.min(totalCount, MAX_EXPORT_ROWS);

    logger.log(
      `[ADMIN_EXPORT] Found ${totalCount} users, exporting ${rowsToExport}`,
    );

    const rows: CSVRow[] = [];

    for (let offset = 0; offset < rowsToExport; offset += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, rowsToExport - offset);
      const users = await this.fetchUserBatch(where, offset, batchSize);

      for (const user of users) {
        rows.push(this.formatUserRow(user));
      }

      logger.log(
        `[ADMIN_EXPORT] Processed ${offset + users.length}/${rowsToExport} users`,
      );
    }

    const disclaimer = this.getRGPDDisclaimer(adminEmail);
    const csvData = Papa.unparse(rows, {
      header: true,
      columns: [...CSV_HEADERS],
    });
    const fullCSV = disclaimer + csvData;

    logger.log(
      `[ADMIN_EXPORT] CSV generated: ${rowsToExport} rows, ${fullCSV.length} bytes`,
    );

    return { csv: fullCSV, rowCount: rowsToExport };
  }

  /**
   * Build Prisma where clause from filters
   */
  private static buildWhereClause(
    filters: UserListFilters,
  ): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    if (filters.search) {
      where.OR = [
        { email: { contains: filters.search, mode: "insensitive" } },
        { firstName: { contains: filters.search, mode: "insensitive" } },
        { lastName: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    return where;
  }

  /**
   * Fetch a batch of users with all required fields
   */
  private static async fetchUserBatch(
    where: Prisma.UserWhereInput,
    skip: number,
    take: number,
  ): Promise<UserListItem[]> {
    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isActive: true,
        isAdmin: true,
        createdAt: true,
        lastLoginAt: true,
        _count: {
          select: {
            ownedWorkspaces: true,
            pages: { where: { isArchived: false } },
          },
        },
        subscription: {
          select: { plan: true },
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      avatarUrl: u.avatarUrl,
      isActive: u.isActive,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      workspacesCount: u._count.ownedWorkspaces,
      pagesCount: u._count.pages,
      plan: (u.subscription?.plan as "free_user" | "premium") || "free_user",
    }));
  }

  /**
   * Format a single user row for CSV
   */
  private static formatUserRow(user: UserListItem): CSVRow {
    return {
      Email: user.email,
      Nom: `${user.firstName} ${user.lastName}`.trim(),
      Plan: user.plan === "premium" ? "Premium" : "Free",
      Status: user.isActive ? "Actif" : "Inactif",
      "Date inscription": user.createdAt.toISOString(),
      "Dernière connexion": user.lastLoginAt?.toISOString() || "Jamais",
      Workspaces: user.workspacesCount,
      Pages: user.pagesCount,
    };
  }

  /**
   * Generate RGPD compliance disclaimer
   */
  private static getRGPDDisclaimer(adminEmail: string): string {
    const now = new Date().toISOString();
    return `# Export généré le ${now} par ${adminEmail}\n# Données conformes RGPD - Usage strictement interne\n`;
  }
}
