/**
 * Admin Notes Service
 * CRUD operations for internal admin annotations on users.
 */

import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import { AdminNoteItem, PaginatedAdminNotes } from "../../types/admin.types.js";

const MAX_CONTENT_LENGTH = 2000;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class AdminNotesService {
  /**
   * List notes for a user, most recent first.
   */
  static async getNotes(
    userId: string,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT,
  ): Promise<PaginatedAdminNotes> {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const skip = (safePage - 1) * safeLimit;

    const [notes, total] = await Promise.all([
      prisma.adminNote.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: safeLimit,
        include: {
          admin: {
            select: { email: true, firstName: true, lastName: true },
          },
        },
      }),
      prisma.adminNote.count({ where: { userId } }),
    ]);

    const items: AdminNoteItem[] = notes.map((n) => ({
      id: n.id,
      userId: n.userId,
      adminId: n.adminId,
      adminEmail: n.admin.email,
      adminName: `${n.admin.firstName} ${n.admin.lastName}`,
      content: n.content,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));

    return {
      notes: items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Create a note on a user.
   */
  static async createNote(
    userId: string,
    adminId: string,
    content: string,
  ): Promise<{ success: true; note: AdminNoteItem } | { success: false; error: string }> {
    if (content.length === 0) {
      return { success: false, error: "Le contenu ne peut pas être vide" };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return {
        success: false,
        error: `Le contenu ne peut pas dépasser ${MAX_CONTENT_LENGTH} caractères`,
      };
    }

    // Verify target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!targetUser) {
      return { success: false, error: "Utilisateur introuvable" };
    }

    const note = await prisma.adminNote.create({
      data: { userId, adminId, content },
      include: {
        admin: {
          select: { email: true, firstName: true, lastName: true },
        },
      },
    });

    logger.log(`[ADMIN_NOTES] Note created by ${adminId} on user ${userId}`);

    return {
      success: true,
      note: {
        id: note.id,
        userId: note.userId,
        adminId: note.adminId,
        adminEmail: note.admin.email,
        adminName: `${note.admin.firstName} ${note.admin.lastName}`,
        content: note.content,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
    };
  }

  /**
   * Delete a note. Only the author or any admin can delete.
   */
  static async deleteNote(
    noteId: string,
    adminId: string,
  ): Promise<{ success: true } | { success: false; error: string }> {
    const note = await prisma.adminNote.findUnique({
      where: { id: noteId },
      select: { id: true, adminId: true },
    });

    if (!note) {
      return { success: false, error: "Note introuvable" };
    }

    // Any admin who passes requireAdmin middleware can delete
    // (spec says "seulement l'auteur ou super-admin" — all users on admin routes are admins)
    await prisma.adminNote.delete({ where: { id: noteId } });

    logger.log(`[ADMIN_NOTES] Note ${noteId} deleted by ${adminId}`);

    return { success: true };
  }
}
