/**
 * Impersonation Service
 * Generates temporary JWT tokens that let admins act as another user.
 * All actions are logged. Token expires after 15 minutes (hard).
 */

import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { logger } from "../../utils/logger.js";

const IMPERSONATION_TTL_SECONDS = 900; // 15 minutes
const IMPERSONATION_PREFIX = "admin:impersonate:";

interface ImpersonationPayload {
  sub: string; // target userId
  adminId: string;
  type: "impersonation";
  iat: number;
  exp: number;
}

interface ImpersonationSession {
  adminId: string;
  adminEmail: string;
  targetUserId: string;
  targetEmail: string;
  createdAt: string;
  expiresAt: string;
}

interface StartImpersonationResult {
  success: boolean;
  token?: string;
  targetUser?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  expiresAt?: string;
  error?: string;
}

function getImpersonationSecret(): string {
  const secret = process.env.IMPERSONATION_JWT_SECRET;
  if (!secret) {
    throw new Error("IMPERSONATION_JWT_SECRET missing — check Infisical /Backend");
  }
  return secret;
}

export class ImpersonationService {
  /**
   * Start an impersonation session.
   * Only admins can impersonate. Cannot impersonate another admin.
   */
  static async startImpersonation(
    adminUserId: string,
    targetUserId: string,
  ): Promise<StartImpersonationResult> {
    // Prevent self-impersonation
    if (adminUserId === targetUserId) {
      return { success: false, error: "Impossible de s'impersonate soi-même" };
    }

    // Load both users in parallel
    const [admin, target] = await Promise.all([
      prisma.user.findUnique({
        where: { id: adminUserId },
        select: { id: true, email: true, isAdmin: true },
      }),
      prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, email: true, firstName: true, lastName: true, isAdmin: true },
      }),
    ]);

    if (!admin?.isAdmin) {
      return { success: false, error: "Droits admin requis" };
    }

    if (!target) {
      return { success: false, error: "Utilisateur cible non trouvé" };
    }

    if (target.isAdmin) {
      return { success: false, error: "Impossible d'impersonate un autre admin" };
    }

    // Check if admin already has an active impersonation
    const existingKey = `${IMPERSONATION_PREFIX}${adminUserId}`;
    const existing = await redis.exists(existingKey);
    if (existing) {
      return { success: false, error: "Session d'impersonation déjà active — terminez-la d'abord" };
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((now + IMPERSONATION_TTL_SECONDS) * 1000);

    // Generate JWT
    const payload: ImpersonationPayload = {
      sub: targetUserId,
      adminId: adminUserId,
      type: "impersonation",
      iat: now,
      exp: now + IMPERSONATION_TTL_SECONDS,
    };

    const token = jwt.sign(payload, getImpersonationSecret());

    // Store session in Redis (for tracking/revocation)
    const session: ImpersonationSession = {
      adminId: adminUserId,
      adminEmail: admin.email,
      targetUserId,
      targetEmail: target.email,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await redis.setex(existingKey, IMPERSONATION_TTL_SECONDS, JSON.stringify(session));

    // Audit log
    await prisma.activityLog.create({
      data: {
        userId: adminUserId,
        action: "ADMIN_IMPERSONATION_START",
        entityType: "user",
        entityId: targetUserId,
        details: JSON.parse(
          JSON.stringify({
            targetEmail: target.email,
            expiresAt: expiresAt.toISOString(),
          }),
        ),
      },
    });

    logger.log(
      `[IMPERSONATION] Admin ${admin.email} started impersonating ${target.email} (expires ${expiresAt.toISOString()})`,
    );

    return {
      success: true,
      token,
      targetUser: {
        id: target.id,
        email: target.email,
        firstName: target.firstName,
        lastName: target.lastName,
      },
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * End an impersonation session.
   */
  static async endImpersonation(
    adminUserId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const key = `${IMPERSONATION_PREFIX}${adminUserId}`;
    const sessionRaw = await redis.get(key);

    if (!sessionRaw) {
      return { success: false, error: "Aucune session d'impersonation active" };
    }

    const session: ImpersonationSession = JSON.parse(sessionRaw);

    // Remove from Redis
    await redis.del(key);

    // Audit log
    await prisma.activityLog.create({
      data: {
        userId: adminUserId,
        action: "ADMIN_IMPERSONATION_END",
        entityType: "user",
        entityId: session.targetUserId,
        details: JSON.parse(
          JSON.stringify({
            targetEmail: session.targetEmail,
            duration: Math.round((Date.now() - new Date(session.createdAt).getTime()) / 1000),
          }),
        ),
      },
    });

    logger.log(
      `[IMPERSONATION] Admin ${session.adminEmail} stopped impersonating ${session.targetEmail}`,
    );

    return { success: true };
  }

  /**
   * Verify an impersonation token.
   * Returns the payload if valid, null otherwise.
   */
  static verifyImpersonationToken(token: string): ImpersonationPayload | null {
    try {
      const decoded = jwt.verify(token, getImpersonationSecret());
      if (
        typeof decoded === "object" &&
        decoded !== null &&
        "type" in decoded &&
        decoded.type === "impersonation"
      ) {
        return decoded as ImpersonationPayload;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if an impersonation session is still active in Redis.
   * Prevents use of token after manual session end.
   */
  static async isSessionActive(adminUserId: string): Promise<boolean> {
    const key = `${IMPERSONATION_PREFIX}${adminUserId}`;
    return (await redis.exists(key)) === 1;
  }
}
