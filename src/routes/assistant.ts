/**
 * 🔧 Routes Assistant - Endpoints RAG et utilitaires
 *
 * Ce fichier contient les routes utilisées par le frontend pour:
 * - Upload de fichiers (simple et RAG)
 * - Contexte RAG
 * - Wikipedia (recherche et traitement RAG)
 * - User pages RAG
 * - Conversion markdown → BlockNote
 *
 * NOTE: Les routes /ask et /ask/stream ont été remplacées par /api/agent/chat
 * qui utilise Vercel AI SDK v5 avec streaming SSE.
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { prismaEmbeddings } from "../lib/prismaEmbeddings.js";
import { wikipediaSearch } from "../controllers/assistant.js";
import { verifyWorkspaceAccess } from "../middlewares/workspaceAccess.js";
import { aiConcurrencyLimit } from "../middlewares/aiConcurrencyLimit.js";
import { dailyTokenQuota } from "../middlewares/dailyTokenQuota.js";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Wikipedia RAG enriched article structure */
interface EnrichedWikipediaArticle {
  title: string;
  url: string;
  fullContent: string;
  categories: string[];
  relevantSections: string[];
}

/** Wikipedia RAG process request body */
interface WikipediaRagProcessBody {
  pageIds: number[];
  query?: string;
  mode?: "ask" | "search" | "create";
  reflection?: "rapide" | "profond";
  workspaceId?: string;
}

/** Source reference for filtering */
interface SourceReference {
  id?: string;
  title: string;
  type?: string;
}

/** Selected sources for RAG context */
interface SelectedSources {
  wikipediaSources?: SourceReference[];
  mentionedPages?: SourceReference[];
  fileSources?: SourceReference[];
  sourcesScope?: "all" | "custom";
}

/** RAG context request body */
interface RagContextBody {
  query: string;
  workspaceId: string;
  sessionKey?: string;
  selectedSources?: SelectedSources;
}

/** User pages check embedding request body */
interface CheckEmbeddingBody {
  pageId: string;
  workspaceId: string;
}

/** User pages RAG process request body */
interface UserPagesRagProcessBody {
  pageIds: string[];
  workspaceId: string;
}

/** Upload RAG request body */
interface UploadRagBody {
  workspaceId: string;
}

/** BlockNote block content item */
interface BlockNoteContentItem {
  type?: string;
  text?: string;
}

/** BlockNote block structure */
interface BlockNoteBlock {
  type?: string;
  content?: BlockNoteContentItem[];
  children?: BlockNoteBlock[];
}

/** PDF parse result */
interface PdfParseResult {
  text?: string;
}

/** PDF parse function type */
type PdfParseFn = (buffer: Buffer) => Promise<PdfParseResult>;

const router = Router();

// NOTE: authenticateToken est appliqué au niveau de index.ts AVANT le rate limit
// pour que le rate limiter ait accès à req.user.id
router.use(aiConcurrencyLimit);
router.use(dailyTokenQuota);

// ============================================================================
// WIKIPEDIA
// ============================================================================

// Recherche Wikipedia
router.get("/wikipedia/search", wikipediaSearch);

// Traitement RAG Wikipedia
router.post(
  "/wikipedia/rag-process",
  verifyWorkspaceAccess,
  async (
    req: Request<unknown, unknown, WikipediaRagProcessBody>,
    res: Response,
  ) => {
    try {
      const { wikipediaRAG } = await import("../services/rag/wikipedia.js");
      const {
        pageIds,
        query = "Articles Wikipedia sélectionnés",
        mode = "search",
        reflection = "rapide",
        workspaceId,
      } = req.body;

      if (!Array.isArray(pageIds) || pageIds.length === 0) {
        return res
          .status(400)
          .json({ error: "pageIds must be a non-empty array" });
      }

      const enrichedResult = await wikipediaRAG.enrichWikipediaContent(
        pageIds,
        query,
        mode,
        reflection,
      );

      if (workspaceId && enrichedResult.articles.length > 0) {
        const articles = enrichedResult.articles.map(
          (article: EnrichedWikipediaArticle, index: number) => ({
            pageid: pageIds[index] || Math.random(),
            title: article.title,
            extract: article.fullContent.slice(0, 500) + "...",
            fullContent: article.fullContent,
            categories: article.categories,
            url: article.url,
          }),
        );

        try {
          await wikipediaRAG.processWikipediaArticles(
            req.user!.id,
            workspaceId,
            articles,
          );
        } catch (error) {
          console.warn("Erreur sauvegarde articles RAG:", error);
        }
      }

      res.json({
        success: true,
        articles: enrichedResult.articles,
        totalTokens: enrichedResult.totalTokens,
        processedForRAG: !!workspaceId,
      });
    } catch (error) {
      console.error("Erreur Wikipedia RAG:", error);
      res.status(500).json({
        error: "Erreur interne du serveur",
        details: "Une erreur est survenue",
      });
    }
  },
);

// ============================================================================
// RAG CONTEXT
// ============================================================================

router.post(
  "/rag/context",
  verifyWorkspaceAccess,
  async (req: Request<unknown, unknown, RagContextBody>, res: Response) => {
    try {
      const { ragSystem } = await import("../services/rag/index.js");
      const { sessionMemory } =
        await import("../services/rag/sessionMemory.js");
      const { query, workspaceId, sessionKey, selectedSources } = req.body;

      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }

      // Vérifier si des sources sont sélectionnées
      const hasSelectedSources =
        selectedSources &&
        ((selectedSources.wikipediaSources?.length ?? 0) > 0 ||
          (selectedSources.mentionedPages?.length ?? 0) > 0 ||
          (selectedSources.fileSources?.length ?? 0) > 0 ||
          selectedSources.sourcesScope === "all");

      // Vérifier session active
      let hasActiveSession = false;
      let activeSessionSources = null;
      if (!hasSelectedSources && req.user) {
        try {
          const activeSession = await sessionMemory.getActiveSession(
            req.user.id,
            workspaceId,
          );
          if (activeSession && activeSession.id) {
            hasActiveSession = true;
            activeSessionSources = await sessionMemory.getSessionSources(
              activeSession.id,
            );
          }
        } catch (error) {
          console.error("Erreur vérification session:", error);
        }
      }

      // Décider si on doit utiliser RAG
      let shouldUseRAG = false;
      const isSimpleGreeting =
        /^(salut|hello|hi|bonjour|bonsoir|coucou|hey)[\s!?]*$/i.test(
          query.trim(),
        );
      const isVeryShort = query.trim().length < 10;

      if (hasSelectedSources) {
        shouldUseRAG = true;
      } else if (isSimpleGreeting || isVeryShort) {
        shouldUseRAG = false;
      } else {
        if (
          hasActiveSession &&
          activeSessionSources &&
          activeSessionSources.length > 0
        ) {
          shouldUseRAG = await ragSystem.shouldUseRAG(
            query,
            activeSessionSources ?? undefined,
          );
        } else {
          shouldUseRAG = await ragSystem.shouldUseRAG(query);
        }
      }

      if (!shouldUseRAG) {
        return res.json({
          success: true,
          ragContext: "",
          sessionMemory: "",
          sessionId: null,
          sourcesUsed: [],
          searchResults: [],
          searchResultsCount: 0,
          skipReason: "Query trop simple/générale pour RAG",
        });
      }

      // Créer ou récupérer la session
      const sessionId = await sessionMemory.getOrCreateSession(
        req.user!.id,
        workspaceId,
        sessionKey,
      );

      // Rechercher les sources spécifiques
      const specificSourceIds: string[] = [];

      // Fichiers joints
      if (
        (selectedSources?.fileSources?.length ?? 0) > 0 &&
        selectedSources?.fileSources
      ) {
        for (const file of selectedSources.fileSources) {
          const fileId = file.id ?? "";
          const isValidUUID =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              fileId,
            );

          const fileRecord = await prismaEmbeddings.rAGSource.findFirst({
            where: isValidUUID
              ? {
                  id: fileId,
                  userId: req.user!.id,
                  workspaceId,
                  status: "COMPLETED",
                }
              : {
                  title: file.title,
                  userId: req.user!.id,
                  workspaceId,
                  status: "COMPLETED",
                },
            select: { id: true },
          });

          if (fileRecord) specificSourceIds.push(fileRecord.id);
        }
      }

      // Sources Wikipedia
      if (
        specificSourceIds.length === 0 &&
        (selectedSources?.wikipediaSources?.length ?? 0) > 0 &&
        selectedSources?.wikipediaSources
      ) {
        for (const source of selectedSources.wikipediaSources) {
          const sourceRecord = await prismaEmbeddings.rAGSource.findFirst({
            where: { title: source.title, isGlobal: true, status: "COMPLETED" },
            select: { id: true },
          });
          if (sourceRecord) specificSourceIds.push(sourceRecord.id);
        }
      }

      // Sources de session
      if (
        specificSourceIds.length === 0 &&
        activeSessionSources &&
        activeSessionSources.length > 0
      ) {
        for (const source of activeSessionSources) {
          const sourceRecord = await prismaEmbeddings.rAGSource.findFirst({
            where: { title: source.title, isGlobal: true, status: "COMPLETED" },
            select: { id: true },
          });
          if (sourceRecord) specificSourceIds.push(sourceRecord.id);
        }
      }

      // Recherche RAG
      let searchResults;
      if (specificSourceIds.length > 0) {
        const allResults = [];
        const chunksPerSource = Math.ceil(12 / specificSourceIds.length);

        for (const sourceId of specificSourceIds) {
          const sourceResults = await ragSystem.intelligentSearch(query, {
            userId: req.user!.id,
            workspaceId,
            limit: chunksPerSource,
            specificSourceIds: [sourceId],
          });
          allResults.push(...sourceResults);
        }
        searchResults = allResults.sort(() => Math.random() - 0.5);
      } else {
        searchResults = await ragSystem.intelligentSearch(query, {
          userId: req.user!.id,
          workspaceId,
          limit: 12,
        });
      }

      // Filtrer selon sourcesScope
      if (selectedSources?.sourcesScope === "custom") {
        const mentionedTitles = new Set([
          ...(selectedSources.wikipediaSources || []).map(
            (s: SourceReference) => s.title,
          ),
          ...(selectedSources.mentionedPages || []).map(
            (p: SourceReference) => p.title,
          ),
          ...(selectedSources.fileSources || []).map(
            (f: SourceReference) => f.title,
          ),
        ]);
        searchResults = searchResults.filter((r) =>
          mentionedTitles.has(r.source.title),
        );
      }

      // Construire le contexte
      const optimizedContext = await ragSystem.buildOptimizedContext(
        query,
        searchResults,
      );
      const sessionMemoryText = await sessionMemory.getRecentMemory(
        sessionId,
        5,
      );

      // Sauvegarder les sources utilisées
      if (sessionId && searchResults.length > 0) {
        const uniqueSourcesMap = new Map();
        searchResults.forEach((r) => {
          uniqueSourcesMap.set(r.source.id, {
            id: r.source.id,
            title: r.source.title,
            type: r.source.sourceType || "wikipedia",
          });
        });
        await sessionMemory.saveSessionSources(
          sessionId,
          Array.from(uniqueSourcesMap.values()),
        );
      }

      res.json({
        success: true,
        ragContext: optimizedContext,
        sessionMemory: sessionMemoryText,
        sessionId,
        sourcesUsed: searchResults.map((r) => r.source.title),
        searchResults,
        searchResultsCount: searchResults.length,
      });
    } catch (error) {
      console.error("Erreur RAG context:", error);
      res.status(500).json({
        error: "Erreur interne du serveur",
        details: "Une erreur est survenue",
      });
    }
  },
);

// ============================================================================
// USER PAGES RAG
// ============================================================================

router.post(
  "/user-pages/check-embedding",
  verifyWorkspaceAccess,
  async (req: Request<unknown, unknown, CheckEmbeddingBody>, res: Response) => {
    try {
      const { pageId, workspaceId } = req.body;

      if (!pageId || !workspaceId) {
        return res
          .status(400)
          .json({ error: "pageId and workspaceId are required" });
      }

      const page = await prisma.page.findFirst({
        where: { id: pageId, workspaceId, isArchived: false },
        select: { id: true, title: true, updatedAt: true },
      });

      if (!page) {
        return res.json({
          alreadyEmbedded: false,
          upToDate: false,
          message: "Page not found",
        });
      }

      try {
        const { userPagesRAG } = await import("../services/rag/userPages.js");
        const existingSource = await userPagesRAG.findExistingSource(
          pageId,
          req.user!.id,
          workspaceId,
        );

        if (!existingSource) {
          return res.json({
            alreadyEmbedded: false,
            upToDate: false,
            message: "No existing embedding found",
          });
        }

        const isUpToDate =
          new Date(existingSource.updatedAt) >= new Date(page.updatedAt) &&
          existingSource.status === "COMPLETED";

        res.json({
          alreadyEmbedded: true,
          upToDate: isUpToDate,
          message: isUpToDate
            ? `Page "${page.title}" already embedded and up-to-date`
            : `Page "${page.title}" embedded but outdated`,
        });
      } catch (error) {
        res.json({
          alreadyEmbedded: false,
          upToDate: false,
          message: "RAG service unavailable",
        });
      }
    } catch (error) {
      console.error("Erreur User Pages Check:", error);
      res.status(500).json({ error: "Erreur interne du serveur" });
    }
  },
);

router.post(
  "/user-pages/rag-process",
  verifyWorkspaceAccess,
  async (
    req: Request<unknown, unknown, UserPagesRagProcessBody>,
    res: Response,
  ) => {
    try {
      const { pageIds, workspaceId } = req.body;

      if (!Array.isArray(pageIds) || pageIds.length === 0) {
        return res
          .status(400)
          .json({ error: "pageIds must be a non-empty array" });
      }

      if (!workspaceId) {
        return res.status(400).json({ error: "workspaceId is required" });
      }

      const selectedPages = await prisma.page.findMany({
        where: { id: { in: pageIds }, workspaceId, isArchived: false },
        select: {
          id: true,
          title: true,
          blockNoteContent: true,
          updatedAt: true,
        },
      });

      if (selectedPages.length === 0) {
        return res.json({
          success: true,
          message: "Aucune page valide trouvée",
          processedPages: [],
        });
      }

      const { userPagesRAG } = await import("../services/rag/userPages.js");
      const processedPages = [];

      for (const page of selectedPages) {
        if (!page.title) continue;

        let textContent = page.title;
        try {
          if (page.blockNoteContent) {
            const content =
              typeof page.blockNoteContent === "string"
                ? JSON.parse(page.blockNoteContent)
                : page.blockNoteContent;

            if (content && Array.isArray(content)) {
              const textParts = content
                .filter(
                  (block: BlockNoteBlock) =>
                    block?.type === "paragraph" && block?.content,
                )
                .map((block: BlockNoteBlock) =>
                  Array.isArray(block.content)
                    ? block.content
                        .map((item: BlockNoteContentItem) => item?.text || "")
                        .join("")
                    : "",
                )
                .filter(Boolean);

              if (textParts.length > 0) {
                textContent = page.title + "\n\n" + textParts.join("\n\n");
              }
            }
          }
        } catch (error) {
          console.error(
            `Erreur extraction contenu page "${page.title}":`,
            error,
          );
        }

        const sourceId = await userPagesRAG.processUserPage({
          id: page.id,
          title: page.title,
          content: textContent,
          userId: req.user!.id,
          workspaceId,
          updatedAt: page.updatedAt,
        });

        if (sourceId) {
          processedPages.push({
            pageId: page.id,
            title: page.title,
            sourceId,
            contentLength: textContent.length,
          });
        }
      }

      res.json({
        success: true,
        message: `${processedPages.length} page(s) traitée(s) avec RAG`,
        processedPages,
        totalPages: selectedPages.length,
      });
    } catch (error) {
      console.error("Erreur User Pages RAG:", error);
      res.status(500).json({ error: "Erreur interne du serveur" });
    }
  },
);

// ============================================================================
// FILE UPLOAD
// ============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 Mo
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPdfParseFn(value: unknown): value is PdfParseFn {
  return typeof value === "function";
}

function getPdfParseFnFromModule(mod: unknown): PdfParseFn | null {
  if (isPdfParseFn(mod)) return mod;
  if (!isRecord(mod)) return null;
  if (isPdfParseFn(mod.default)) return mod.default;
  return null;
}

// Upload simple (extraction texte sans persistance)
router.post(
  "/upload",
  upload.array("files", 5),
  async (req: Request, res: Response) => {
    try {
      const files = (req.files as Express.Multer.File[]) || [];
      const results: Array<{
        name: string;
        mimetype: string;
        size: number;
        text: string;
      }> = [];

      for (const f of files) {
        let text = "";
        if (f.mimetype === "application/pdf") {
          try {
            let pdfParseFn: PdfParseFn;
            try {
              const mod: unknown = await import("pdf-parse/lib/pdf-parse.js");
              const parsed = getPdfParseFnFromModule(mod);
              if (!parsed) throw new Error("Invalid pdf-parse module");
              pdfParseFn = parsed;
            } catch {
              const mod: unknown = await import("pdf-parse");
              const parsed = getPdfParseFnFromModule(mod);
              if (!parsed) throw new Error("Invalid pdf-parse module");
              pdfParseFn = parsed;
            }
            const data = await pdfParseFn(f.buffer);
            text = data?.text || "";
          } catch (pdfError) {
            // 🛡️ SÉCURITÉ: Log l'échec du parsing PDF pour monitoring
            console.warn(
              `⚠️ [ASSISTANT] PDF parsing failed for "${f.originalname}" (${f.size} bytes):`,
              pdfError instanceof Error ? pdfError.message : "Unknown error",
            );
            text = "";
          }
        } else if (f.mimetype === "text/plain") {
          text = f.buffer.toString("utf-8");
        }
        results.push({
          name: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          text,
        });
      }

      res.json({ files: results });
    } catch (e) {
      console.error("upload error", e);
      res.status(500).json({ error: "Erreur upload fichiers" });
    }
  },
);

// Upload RAG (avec embedding)
router.post(
  "/upload-rag",
  verifyWorkspaceAccess,
  upload.single("file"),
  async (req: Request<unknown, unknown, UploadRagBody>, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Utilisateur non authentifié" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Aucun fichier fourni" });
      }

      const { workspaceId } = req.body;
      if (!workspaceId) {
        return res.status(400).json({ error: "workspaceId requis" });
      }

      const file = req.file;
      const supportedMimes = [
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "text/csv",
        "application/json",
        "text/markdown",
        "text/html",
      ];

      if (!supportedMimes.includes(file.mimetype)) {
        return res.status(400).json({
          error: "Format non supporté",
          supportedFormats: supportedMimes,
        });
      }

      const { userFilesRAG } = await import("../services/rag/userFiles.js");
      const sourceId = await userFilesRAG.processUserFile({
        buffer: file.buffer,
        fileName: file.originalname,
        mimeType: file.mimetype,
        userId: req.user.id,
        workspaceId,
      });

      if (!sourceId) {
        return res.status(500).json({ error: "Échec du traitement RAG" });
      }

      res.json({
        success: true,
        sources: [
          {
            sourceId,
            title: file.originalname,
            type: file.mimetype === "application/pdf" ? "PDF" : "TEXT_FILE",
          },
        ],
      });
    } catch (error) {
      console.error("Erreur upload-rag:", error);
      res.status(500).json({ error: "Erreur traitement fichier RAG" });
    }
  },
);

// ============================================================================
// MARKDOWN CONVERSION
// ============================================================================

router.post("/markdown-to-blocknote", async (req, res) => {
  try {
    const { markdown } = req.body;

    if (!markdown || typeof markdown !== "string") {
      return res.status(400).json({ error: "Markdown requis" });
    }

    const { toBlockNoteAuto } =
      await import("../controllers/assistant/helpers/blocknote.js");
    const blockNote = toBlockNoteAuto(markdown);

    res.json({ success: true, blockNote, blocksCount: blockNote.length });
  } catch (error) {
    console.error("Erreur conversion markdown->blocknote:", error);
    res.status(500).json({ error: "Erreur lors de la conversion" });
  }
});

export { router as assistantRouter };
