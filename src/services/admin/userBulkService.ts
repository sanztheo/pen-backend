/**
 * User Bulk Actions Service
 * Handles bulk activate/deactivate operations for general users.
 * Follows the same pattern as BetaAdminService.bulkAction.
 */

import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { UserBulkAction, UserBulkResult } from "../../types/admin.types.js";

export class UserBulkService {
  /**
   * Execute bulk action on multiple users using batch queries in a single transaction.
   * Pre-validates users then applies updateMany + createMany to minimize round-trips.
   */
  static async bulkAction(
    userIds: string[],
    action: UserBulkAction,
    adminId: string,
  ): Promise<UserBulkResult> {
    const result: UserBulkResult = {
      total: userIds.length,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    // Pre-fetch all targeted users in one query
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, isActive: true, isAdmin: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Partition into eligible and rejected
    const eligible: string[] = [];
    for (const userId of userIds) {
      const user = userMap.get(userId);
      if (!user) {
        result.failed++;
        result.errors.push({ userId, error: "Utilisateur introuvable" });
        continue;
      }

      if (action === "activate" && user.isActive) {
        result.failed++;
        result.errors.push({ userId, error: "Utilisateur déjà actif" });
        continue;
      }

      if (action === "deactivate" && user.isAdmin) {
        result.failed++;
        result.errors.push({ userId, error: "Impossible de désactiver un administrateur" });
        continue;
      }

      if (action === "deactivate" && !user.isActive) {
        result.failed++;
        result.errors.push({ userId, error: "Utilisateur déjà inactif" });
        continue;
      }

      eligible.push(userId);
    }

    if (eligible.length > 0) {
      const isActive = action === "activate";
      const actionLabel = action === "activate" ? "ADMIN_BULK_ACTIVATE" : "ADMIN_BULK_DEACTIVATE";

      await prisma.$transaction(async (tx) => {
        await tx.user.updateMany({
          where: { id: { in: eligible } },
          data: { isActive },
        });

        await tx.activityLog.createMany({
          data: eligible.map((userId) => ({
            userId: adminId,
            action: actionLabel,
            entityType: "user",
            entityId: userId,
            details: JSON.parse(JSON.stringify({ adminId, targetUserId: userId })),
          })),
        });
      });

      result.succeeded = eligible.length;
    }

    logger.log(`[USER_BULK] ${action} completed: ${result.succeeded}/${result.total} succeeded`);

    return result;
  }
}
