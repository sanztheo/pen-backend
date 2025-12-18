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

import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { prismaEmbeddings } from "../lib/prismaEmbeddings.js";
import { wikipediaSearch } from "../controllers/assistant.js";

const router = Router();

router.use(authenticateToken);

// ============================================================================
// WIKIPEDIA
// ============================================================================

// Recherche Wikipedia
router.get("/wikipedia/search", wikipediaSearch);

// Traitement RAG Wikipedia
router.post("/wikipedia/rag-process", async (req: any, res) => {
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
        (article: any, index: number) => ({
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
          req.user.id,
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
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
});

// ============================================================================
// RAG CONTEXT
// ============================================================================

router.post("/rag/context", async (req: any, res) => {
  try {
    const { ragSystem } = await import("../services/rag/index.js");
    const { sessionMemory } = await import("../services/rag/sessionMemory.js");
    const { query, workspaceId, sessionKey, selectedSources } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    // Vérifier si des sources sont sélectionnées
    const hasSelectedSources =
      selectedSources &&
      (selectedSources.wikipediaSources?.length > 0 ||
        selectedSources.mentionedPages?.length > 0 ||
        selectedSources.fileSources?.length > 0 ||
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
        if (activeSession) {
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
      if (hasActiveSession && activeSessionSources?.length > 0) {
        shouldUseRAG = await ragSystem.shouldUseRAG(
          query,
          activeSessionSources,
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
      req.user.id,
      workspaceId,
      sessionKey,
    );

    // Rechercher les sources spécifiques
    let specificSourceIds: string[] = [];

    // Fichiers joints
    if (selectedSources?.fileSources?.length > 0) {
      for (const file of selectedSources.fileSources) {
        const isValidUUID =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            file.id,
          );

        const fileRecord = await prismaEmbeddings.rAGSource.findFirst({
          where: isValidUUID
            ? {
                id: file.id,
                userId: req.user.id,
                workspaceId,
                status: "COMPLETED",
              }
            : {
                title: file.title,
                userId: req.user.id,
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
      selectedSources?.wikipediaSources?.length > 0
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
    if (specificSourceIds.length === 0 && activeSessionSources?.length > 0) {
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
          userId: req.user.id,
          workspaceId,
          limit: chunksPerSource,
          specificSourceIds: [sourceId],
        });
        allResults.push(...sourceResults);
      }
      searchResults = allResults.sort(() => Math.random() - 0.5);
    } else {
      searchResults = await ragSystem.intelligentSearch(query, {
        userId: req.user.id,
        workspaceId,
        limit: 12,
      });
    }

    // Filtrer selon sourcesScope
    if (selectedSources?.sourcesScope === "custom") {
      const mentionedTitles = new Set([
        ...(selectedSources.wikipediaSources || []).map((s: any) => s.title),
        ...(selectedSources.mentionedPages || []).map((p: any) => p.title),
        ...(selectedSources.fileSources || []).map((f: any) => f.title),
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
    const sessionMemoryText = await sessionMemory.getRecentMemory(sessionId, 5);

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
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
});

// ============================================================================
// USER PAGES RAG
// ============================================================================

router.post("/user-pages/check-embedding", async (req: any, res) => {
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
        req.user.id,
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
});

router.post("/user-pages/rag-process", async (req: any, res) => {
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
                (block: any) => block?.type === "paragraph" && block?.content,
              )
              .map((block: any) =>
                Array.isArray(block.content)
                  ? block.content.map((item: any) => item?.text || "").join("")
                  : "",
              )
              .filter(Boolean);

            if (textParts.length > 0) {
              textContent = page.title + "\n\n" + textParts.join("\n\n");
            }
          }
        }
      } catch (error) {
        console.error(`Erreur extraction contenu page "${page.title}":`, error);
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
});

// ============================================================================
// FILE UPLOAD
// ============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 Mo
});

// Upload simple (extraction texte sans persistance)
router.post("/upload", upload.array("files", 5), async (req: any, res) => {
  try {
    const files = (req.files as any[]) || [];
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
          let pdfParseFn: any;
          try {
            const mod = await import("pdf-parse/lib/pdf-parse.js");
            pdfParseFn = (mod as any).default || (mod as any);
          } catch {
            const mod = await import("pdf-parse");
            pdfParseFn = (mod as any).default || (mod as any);
          }
          const data = await pdfParseFn(f.buffer);
          text = data?.text || "";
        } catch {
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
});

// Upload RAG (avec embedding)
router.post("/upload-rag", upload.single("file"), async (req: any, res) => {
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
      return res
        .status(400)
        .json({
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
});

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

export default router;
