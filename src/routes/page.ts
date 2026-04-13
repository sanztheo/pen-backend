import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger.js";
import {
  createPage,
  getPage,
  getProjectPages,
  updatePage,
  deletePage,
  cleanupArchivedPages,
  getRecentPages,
  togglePagePin,
} from "../controllers/page.js";
import {
  archivePageHandler,
  restorePageHandler,
  listTrashHandler,
  bulkDeleteTrashHandler,
  emptyTrashHandler,
} from "../controllers/trash.js";
import { authenticateToken } from "../middlewares/auth.js";
import { validateUUID } from "../middlewares/validateUUID.js";
import { trashLimiter } from "../middlewares/rateLimiting.js";
import { verifyWorkspaceAccess } from "../middlewares/workspaceAccess.js";
import { prisma } from "../lib/prisma.js";
import { cacheBlockNoteContent, invalidateBlockNoteCache } from "../lib/redis.js";
import { resetYjsDocument } from "../lib/y-prisma.js";

// Type for authenticated requests with user
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

// Type for page with BlockNote content from Prisma
interface PageWithBlockNote {
  id: string;
  title: string;
  blockNoteContent: unknown;
}

// Type for Prisma error with code
interface PrismaError {
  code?: string;
}

function isPrismaError(error: unknown): error is PrismaError {
  return error !== null && typeof error === "object" && "code" in error;
}

const router = Router();

// 📄 Convertit HTML en blocs BlockNote
interface BlockNoteBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: Array<{
    type: string;
    text: string;
    styles?: Record<string, unknown>;
  }>;
  children?: BlockNoteBlock[];
}

function htmlToBlockNoteBlocks(html: string): BlockNoteBlock[] {
  const blocks: BlockNoteBlock[] = [];

  // 🔧 IMPORTANT: Nettoyer les caractères NULL (\u0000) qui causent une erreur PostgreSQL
  const cleanedHtml = html.replace(/\u0000/g, "");

  // Parser simple côté serveur (pas de DOM disponible)
  // On utilise des regex pour extraire les éléments HTML
  const lines = cleanedHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---PAGE_BREAK---\n")
    .split("\n");

  for (const line of lines) {
    // Nettoyer les tags HTML
    const text = line
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();

    if (!text) continue;

    // Détecter le type de bloc
    if (text === "---PAGE_BREAK---") {
      // Séparateur de page
      blocks.push({
        type: "paragraph",
        content: [{ type: "text", text: "───────────────", styles: {} }],
        children: [],
      });
    } else if (line.match(/<h1[^>]*>/i)) {
      blocks.push({
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text, styles: {} }],
        children: [],
      });
    } else if (line.match(/<h2[^>]*>/i)) {
      blocks.push({
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text, styles: {} }],
        children: [],
      });
    } else if (line.match(/<h3[^>]*>/i)) {
      blocks.push({
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text, styles: {} }],
        children: [],
      });
    } else if (line.match(/<li[^>]*>/i)) {
      // Détecter si c'est une liste ordonnée ou non
      const isOrdered = line.match(/<ol[^>]*>/i) !== null;
      blocks.push({
        type: isOrdered ? "numberedListItem" : "bulletListItem",
        content: [{ type: "text", text, styles: {} }],
        children: [],
      });
    } else {
      // Paragraphe par défaut
      blocks.push({
        type: "paragraph",
        content: [{ type: "text", text, styles: {} }],
        children: [],
      });
    }
  }

  // Si aucun bloc créé, ajouter un paragraphe vide
  if (blocks.length === 0) {
    blocks.push({
      type: "paragraph",
      content: [],
      children: [],
    });
  }

  return blocks;
}

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// Routes des pages
router.post("/", createPage);
router.get("/recent", getRecentPages);
// Recherche simple de pages par titre
router.get("/search", async (req, res) => {
  try {
    const { q } = req.query as { q?: string };
    const query = (q || "").toString();
    if (!query) return res.json({ pages: [] });
    const userId = (req as AuthenticatedRequest).user?.id;
    const pages = await prisma.page.findMany({
      where: {
        isArchived: false,
        title: { contains: query, mode: "insensitive" },
        workspace: {
          OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
        },
      },
      select: { id: true, title: true, projectId: true, workspaceId: true },
      take: 20,
    });
    res.json({ pages });
  } catch (error: unknown) {
    logger.error(
      "[PAGES] Erreur /pages/search:",
      error instanceof Error ? error.message : String(error),
    );
    res.status(500).json({ error: "Erreur recherche pages" });
  }
});

// 🔎 Recherche dans le contenu des pages — PostgreSQL-level ILIKE (no in-memory loading)
const SEARCH_CONTENT_MAX_RESULTS = 50;

interface SearchContentRow {
  id: string;
  title: string;
  excerpt: string;
}

router.get("/search-content", async (req, res) => {
  try {
    const { q } = req.query as { q?: string };
    const query = (q || "").toString().trim();
    if (!query) return res.json({ results: [] });

    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });

    // Filter at PostgreSQL level: cast JSON to text + ILIKE
    // Only matching rows are returned — no bulk memory loading
    const searchPattern = `%${query}%`;

    const results = await prisma.$queryRaw<SearchContentRow[]>`
      SELECT
        p.id,
        p.title,
        SUBSTRING(
          p."blockNoteContent"::text
          FROM GREATEST(1, POSITION(LOWER(${query}) IN LOWER(p."blockNoteContent"::text)) - 80)
          FOR ${query.length + 160}
        ) AS excerpt
      FROM pages p
      INNER JOIN workspaces w ON p."workspaceId" = w.id
      LEFT JOIN workspace_members wm
        ON wm."workspaceId" = w.id
        AND wm."userId" = ${userId}
        AND wm."isActive" = true
      WHERE p."isArchived" = false
        AND (w."ownerId" = ${userId} OR wm."userId" IS NOT NULL)
        AND (
          p.title ILIKE ${searchPattern}
          OR p."blockNoteContent"::text ILIKE ${searchPattern}
        )
      LIMIT ${SEARCH_CONTENT_MAX_RESULTS}
    `;

    res.json({ results });
  } catch (error: unknown) {
    logger.error(
      "[PAGES] Erreur /pages/search-content",
      error instanceof Error ? error.message : String(error),
    );
    res.status(500).json({ error: "Erreur recherche contenu pages" });
  }
});
router.get("/project/:projectId", getProjectPages);

// 🗑️ TRASH (Corbeille) — MUST be declared BEFORE any `/:id*` route so Express
// matches the literal `/trash` segment first. Reordering these lines below
// `/:id` would cause `DELETE /trash` to hit `deletePage` with id="trash".
router.get("/trash", trashLimiter, verifyWorkspaceAccess, listTrashHandler);
router.post("/trash/bulk-delete", trashLimiter, verifyWorkspaceAccess, bulkDeleteTrashHandler);
router.delete("/trash", trashLimiter, verifyWorkspaceAccess, emptyTrashHandler);
// Per-page archive / restore. Workspace authorization happens INSIDE the
// handler via loadPageWorkspaceOrThrow + assertUserCanAccessWorkspace because
// the URL only has the page id.
router.post("/:id/archive", validateUUID("id"), trashLimiter, archivePageHandler);
router.post("/:id/restore", validateUUID("id"), trashLimiter, restorePageHandler);

router.get("/:id", validateUUID("id"), getPage);
router.put("/:id", validateUUID("id"), updatePage);
router.delete("/:id", validateUUID("id"), deletePage);
router.patch("/:id/pin", validateUUID("id"), togglePagePin);

// Route de maintenance pour nettoyer les pages archivées
router.delete("/cleanup/archived", cleanupArchivedPages);

// 🆕 IMPORT HTML VERS BLOCKNOTE (pour import PDF)
router.post("/:pageId/import-html", validateUUID("pageId"), async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = (req as AuthenticatedRequest).user?.id;
    const { html } = req.body;

    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "HTML requis" });
    }

    // 🔒 AUTHORIZATION: Verify user has access to this page's workspace
    const pageAccess = await prisma.page.findFirst({
      where: {
        id: pageId,
        workspace: {
          OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
        },
      },
      select: { id: true },
    });
    if (!pageAccess) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    logger.log("📄 [API] Import HTML vers BlockNote:", {
      pageId,
      htmlLength: html.length,
      htmlPreview: html.substring(0, 200),
    });

    // Convertir HTML en blocs BlockNote
    let blocks: BlockNoteBlock[];
    try {
      blocks = htmlToBlockNoteBlocks(html);
      logger.log("📄 [API] Blocs générés:", blocks.length, "blocs");
    } catch (conversionError) {
      logger.error("❌ [API] Erreur conversion HTML:", conversionError);
      return res.status(500).json({
        error: "Erreur conversion HTML",
        details: String(conversionError),
      });
    }

    // Sauvegarder dans la page
    logger.log("📄 [API] Sauvegarde dans la page:", pageId);
    await prisma.page.update({
      where: { id: pageId },
      data: {
        blockNoteContent: blocks as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });

    // Invalider cache Redis
    invalidateBlockNoteCache(pageId).catch((err) =>
      logger.error("⚠️ [REDIS] Erreur invalidation cache:", err),
    );

    logger.log("✅ [API] HTML importé avec succès:", {
      pageId,
      blocksCount: blocks.length,
    });

    res.json({
      message: "HTML importé avec succès",
      pageId,
      blocksCount: blocks.length,
    });
  } catch (error: unknown) {
    if (isPrismaError(error) && error.code === "P2025") {
      return res.status(404).json({ error: "Page non trouvée" });
    }
    logger.error(
      "❌ [API] Erreur import HTML:",
      error instanceof Error ? error.message : String(error),
    );
    res.status(500).json({ error: "Erreur lors de l'import" });
  }
});

// 🆕 SAUVEGARDER CONTENU BLOCKNOTE OPTIMISÉ (Solution officielle + optimisations)
// Support POST et PUT pour compatibilité
router.post("/:pageId/blocknote-content", validateUUID("pageId"), saveBlockNoteContent);
router.put("/:pageId/blocknote-content", validateUUID("pageId"), saveBlockNoteContent);

async function saveBlockNoteContent(req: Request, res: Response): Promise<void> {
  try {
    const { pageId } = req.params;
    const userId = (req as AuthenticatedRequest).user?.id;
    const { content, changedBlocks, isDifferential } = req.body as {
      content?: unknown[];
      changedBlocks?: unknown[];
      isDifferential?: boolean;
    };

    if (!content || !Array.isArray(content)) {
      res.status(400).json({ error: "Contenu BlockNote requis" });
      return;
    }

    // 🔒 AUTHORIZATION: Verify user has access to this page's workspace
    const pageAccess = await prisma.page.findFirst({
      where: {
        id: pageId,
        workspace: {
          OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
        },
      },
      select: { id: true },
    });
    if (!pageAccess) {
      res.status(403).json({ error: "Accès refusé" });
      return;
    }

    // 🚀 GESTION OPTIMISÉE SELON LE TYPE DE SAUVEGARDE
    let logMessage;
    let saveStrategy;

    if (isDifferential && changedBlocks && changedBlocks.length > 0) {
      // 🎯 SAUVEGARDE DIFFÉRENTIELLE
      logMessage = `📝 [API] Sauvegarde différentielle (${changedBlocks.length}/${content.length} blocs)`;
      saveStrategy = "differential";
    } else {
      // 🎯 SAUVEGARDE COMPLÈTE
      logMessage = `📝 [API] Sauvegarde complète (${content.length} blocs)`;
      saveStrategy = "full";
    }

    const hasNestedBlocks = content.some((b: unknown) => {
      if (b && typeof b === "object" && "children" in b) {
        const children = (b as { children?: unknown[] }).children;
        return Array.isArray(children) && children.length > 0;
      }
      return false;
    });

    logger.log(logMessage, {
      pageId,
      hasNestedBlocks,
      strategy: saveStrategy,
    });

    // 🎯 TOUJOURS SAUVEGARDER LE CONTENU COMPLET (pour la cohérence)
    await prisma.page.update({
      where: { id: pageId },
      data: {
        ...(content && {
          blockNoteContent: content as Prisma.InputJsonValue,
        }),
        updatedAt: new Date(),
      },
    });

    // 🗑️ INVALIDER CACHE REDIS après sauvegarde
    invalidateBlockNoteCache(pageId).catch((err: unknown) =>
      logger.error(
        "⚠️ [REDIS] Erreur invalidation cache:",
        err instanceof Error ? err.message : String(err),
      ),
    );

    logger.log("✅ [API] Contenu BlockNote sauvegardé:", {
      pageId,
      blocksCount: content.length,
      strategy: saveStrategy,
    });

    res.json({
      message: "Contenu BlockNote sauvegardé avec succès",
      pageId,
      blocksCount: content.length,
      hasNestedBlocks,
      saveStrategy,
    });
  } catch (error: unknown) {
    // 🔧 Gestion spécifique de l'erreur P2025 (page supprimée)
    if (isPrismaError(error) && error.code === "P2025") {
      logger.log(
        `⚠️ [API] Page ${req.params.pageId} n'existe plus (supprimée). Sauvegarde ignorée.`,
      );
      res.status(404).json({
        error: "Page non trouvée",
        code: "PAGE_NOT_FOUND",
        message: "Cette page a été supprimée",
      });
      return;
    }

    logger.error(
      "❌ [API] Erreur sauvegarde BlockNote:",
      error instanceof Error ? error.message : String(error),
    );
    res.status(500).json({ error: "Erreur lors de la sauvegarde" });
  }
}

// 🆕 CHARGER CONTENU BLOCKNOTE DIRECTEMENT (Solution officielle + Redis Cache)
// 🔒 SECURITY: Requires authentication + workspace access OR admin privileges
router.get("/:pageId/blocknote-content", authenticateToken, async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = req.user!.id;

    // 🚨 VALIDATION UUID
    if (
      !pageId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pageId)
    ) {
      return res.status(400).json({
        error: "PageId doit être un UUID valide",
        received: pageId,
      });
    }

    // 🔒 AUTHORIZATION: Check if user has access to the page's workspace OR is admin
    const [pageAccess, userAdmin] = await Promise.all([
      prisma.page.findFirst({
        where: {
          id: pageId,
          workspace: {
            OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
          },
        },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      }),
    ]);

    if (!pageAccess && !userAdmin?.isAdmin) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    // 🚀 REDIS CACHE: Récupérer depuis cache (2min TTL)
    const page: PageWithBlockNote | null = await cacheBlockNoteContent(pageId);

    if (!page) {
      return res.status(404).json({ error: "Page non trouvée" });
    }

    const content: BlockNoteBlock[] = Array.isArray(page.blockNoteContent)
      ? page.blockNoteContent
      : [];

    const hasNestedBlocks = content.some((b: BlockNoteBlock) => {
      return Array.isArray(b.children) && b.children.length > 0;
    });

    res.json({
      content,
      pageId,
      title: page.title,
      blocksCount: content.length,
      hasNestedBlocks,
    });
  } catch (error: unknown) {
    logger.error(
      "[PAGE_ROUTES] Erreur chargement BlockNote:",
      error instanceof Error ? error.message : String(error),
    );
    res.status(500).json({ error: "Erreur lors du chargement" });
  }
});

// 🎨 METTRE À JOUR L'ICÔNE D'UNE PAGE
router.patch("/:id/icon", validateUUID("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req as AuthenticatedRequest).user?.id;
    const { icon, iconColor } = req.body;

    // 🔒 AUTHORIZATION: Verify user has access to this page's workspace
    const pageAccess = await prisma.page.findFirst({
      where: {
        id,
        workspace: {
          OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
        },
      },
      select: { id: true },
    });
    if (!pageAccess) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    logger.log("🎨 [API] Mise à jour icône page:", {
      pageId: id,
      icon,
      iconColor,
      hasIcon: !!icon,
      hasColor: !!iconColor,
    });

    // Validation des données d'icône
    if (icon && typeof icon !== "string") {
      return res.status(400).json({ error: "L'icône doit être une chaîne de caractères" });
    }

    if (iconColor && (typeof iconColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(iconColor))) {
      return res.status(400).json({ error: "La couleur doit être au format hexadécimal #RRGGBB" });
    }

    // Mise à jour de la page
    const updatedPage = await prisma.page.update({
      where: { id },
      data: {
        icon: icon || null,
        iconColor: iconColor || null,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        title: true,
        icon: true,
        iconColor: true,
      },
    });

    logger.log("✅ [API] Icône page mise à jour:", {
      pageId: id,
      icon: updatedPage.icon,
      iconColor: updatedPage.iconColor,
    });

    res.json({
      message: "Icône mise à jour avec succès",
      page: updatedPage,
    });
  } catch (error: unknown) {
    if (isPrismaError(error) && error.code === "P2025") {
      logger.log(`⚠️ [API] Page ${req.params.id} n'existe plus lors de la mise à jour de l'icône`);
      return res.status(404).json({
        error: "Page non trouvée",
        code: "PAGE_NOT_FOUND",
        message: "Cette page a été supprimée",
      });
    }

    logger.error(
      "❌ [API] Erreur mise à jour icône page:",
      error instanceof Error ? error.message : String(error),
    );
    res.status(500).json({ error: "Erreur lors de la mise à jour de l'icône" });
  }
});

// Rollback last AI edit — restores the most recent snapshot
router.post("/:pageId/rollback", validateUUID("pageId"), async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = (req as AuthenticatedRequest).user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Non authentifié", code: "MISSING_TOKEN" });
    }

    // Verify user has access to the page's workspace
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        workspace: {
          OR: [{ ownerId: userId }, { members: { some: { userId, isActive: true } } }],
        },
      },
      select: { id: true, workspaceId: true },
    });

    if (!page) {
      return res.status(404).json({ error: "Page non trouvée", code: "NOT_FOUND" });
    }

    // Get the latest snapshot
    const snapshot = await prisma.pageEditSnapshot.findFirst({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true, createdAt: true, toolName: true },
    });

    if (!snapshot) {
      return res.status(404).json({
        error: "Aucun snapshot disponible pour cette page",
        code: "NO_SNAPSHOT",
      });
    }

    const blocks = snapshot.content as unknown as Prisma.InputJsonValue;

    // Restore blocks directly (no toolName = no snapshot of the rollback itself)
    await prisma.page.updateMany({
      where: { id: pageId, workspaceId: page.workspaceId },
      data: {
        blockNoteContent: blocks,
        updatedAt: new Date(),
      },
    });

    // Invalidate caches + reset Yjs document so editor reloads from DB
    try {
      await Promise.all([invalidateBlockNoteCache(pageId), resetYjsDocument(pageId)]);
    } catch (cacheErr) {
      logger.warn("[ROLLBACK] Cache/Yjs invalidation failed:", cacheErr);
    }

    // Delete the used snapshot
    await prisma.pageEditSnapshot.delete({ where: { id: snapshot.id } });

    logger.log("[ROLLBACK] Page restored", {
      userId,
      pageId,
      snapshotId: snapshot.id,
      toolName: snapshot.toolName,
      restoredFrom: snapshot.createdAt,
    });

    return res.json({
      success: true,
      pageId,
      restoredFrom: snapshot.createdAt,
    });
  } catch (error: unknown) {
    logger.error("[ROLLBACK] Error:", error instanceof Error ? error.message : String(error));
    return res.status(500).json({ error: "Erreur lors du rollback", code: "ROLLBACK_ERROR" });
  }
});

export { router as pageRouter };
