import { Request, Response } from "express";
import { prisma } from "../../../lib/prisma.js";
import { AIService } from "../../../services/ai/index.js";
import { GeminiService } from "../../../services/ai/gemini.js";
import {
  detectPreferredLanguage,
  buildLangInstruction,
} from "../helpers/language.js";
import { isMathLatexIntent, LATEX_STRICT_RULES } from "../helpers/latex.js";
import { sseWriteData } from "../helpers/sse.js";
import {
  toBlockNoteAuto,
  sanitizeAIGeneratedContent,
} from "../helpers/blocknote.js";
import { buildPagesContextChunked } from "../helpers/context.js";
import {
  sanitizeUserInput,
  analyzeQuery,
  optimizePrompt,
} from "../helpers/promptOptimizer.js";
import { mapRagSourcesToRealUUIDs } from "../helpers/sourceMapping.js";

// 🚀 NOUVEAUX SERVICES (refactoring architecture)
import { DebugLogger } from "../config/debug.js";
import { ValidationUtils } from "../utils/validation.js";
import { AssistantHandlerService } from "../services/HandlerService.js";
import {
  readPersonalizationFromReq,
  buildPersonaSnippet,
} from "../helpers/personalization.js";

// Normalisation Markdown pour garantir la conversion fiable des titres (#, ##, ###)
function normalizeMarkdownForHeadings(input: string): string {
  let s = (input || "").replace(/\r\n?/g, "\n");
  const lines = s.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line) || /^~~~/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let l = line;
    l = l.replace(
      /^\s*(#{1,6})(\s*)/,
      (m, hashes, space) => `${hashes}${space}`,
    );
    l = l.replace(/^#{4,}\s*/, "### ");
    l = l.replace(/^(#{1,3})([^\s#])/, "$1 $2");
    l = l.replace(/^(#{1,3}\s.*?)(\s*#+\s*)$/, "$1");
    lines[i] = l;
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,3}\s/.test(l) && i > 0 && lines[i - 1].trim() !== "") {
      out.push("");
    }
    out.push(l);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const assistantCreateStream = async (req: Request, res: Response) => {
  try {
    if (!req.user)
      return res.status(401).json({ error: "Utilisateur non authentifié" });

    // 🚀 Parsing spécialisé pour CREATE (instruction au lieu de query)
    const {
      instruction,
      title,
      workspaceId,
      projectId,
      pageIds = [],
      reflection = "rapide",
      useWeb = true,
      sourcesScope = "custom",
      ragSources = [],
    } = req.body;

    if (!instruction || !workspaceId) {
      return res.status(400).json({ error: "instruction, workspaceId requis" });
    }

    // 🔍 Debug unifié avec le nouveau système
    DebugLogger.web(
      `[CREATE] useWeb reçu: ${useWeb} (type: ${typeof useWeb}) - DEFAULT: true`,
    );
    DebugLogger.rag(
      `[CREATE] ENTRÉE - workspaceId: ${workspaceId}, pageIds: ${pageIds.length}, ragSources: ${ragSources.length}, reflection: ${reflection}`,
    );

    // 🛡️ SÉCURITÉ: Nettoyage de l'input utilisateur
    const sanitizedInstruction = sanitizeUserInput(instruction);

    // 🧠 INTELLIGENCE: Analyse de la requête
    const analysis = analyzeQuery(sanitizedInstruction, req);
    const userId = req.user?.id || "anonymous";

    // 🧠 RAG: Gestion intelligente des sources avec validation unifiée
    let contextPageIds: string[] = [];

    // 🔥 PRIORITÉ: Pages mentionnées > Sources RAG externes
    if (workspaceId && pageIds.length > 0) {
      contextPageIds = ValidationUtils.validatePageIds(pageIds);

      if (contextPageIds.length !== pageIds.length) {
        DebugLogger.rag(
          `IDs invalides filtrés: ${pageIds.length - contextPageIds.length} IDs ignorés`,
        );
      }
    }

    // 🚀 Configuration SSE headers AVANT la Phase 1
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Cache-Control");
    res.flushHeaders();

    // 🔥 PHASE 1: Function Calling pour rassembler l'information
    console.log(`🔧 [CREATE-PHASE-1] Démarrage avec reflection: ${reflection}`);

    const { FunctionCallingService } = await import(
      "../../../services/ai/functionCalling/index.js"
    );
    const { indexAndPreparePagesForAI } = await import(
      "../helpers/pageIndexing.js"
    );

    // 🔥 Préparer les sources pour l'IA (comme searchStream.ts)
    const hasSpecificPages = contextPageIds.length > 0;
    let sourcesForAI: any[] = [];

    // 🚀 Construction contexte avec le service unifié SEULEMENT pour avoir les pageObjects
    const contextResult = await AssistantHandlerService.buildContextStrategy(
      "create",
      {
        query: sanitizedInstruction,
        workspaceId,
        pageIds: contextPageIds,
        useWeb: false, // Pas de web ici, le Function Calling le fera si besoin
        ragSources: [],
        userId,
      },
    );

    if (
      hasSpecificPages &&
      contextResult.pageObjects &&
      Array.isArray(contextResult.pageObjects) &&
      contextResult.pageObjects.length > 0
    ) {
      console.log(
        `📖 [CREATE] Pages spécifiques détectées - utiliser SEULEMENT ces pages`,
      );
      sourcesForAI = await indexAndPreparePagesForAI(
        contextResult.pageObjects,
        userId,
        workspaceId,
      );
    } else if (ragSources && ragSources.length > 0) {
      console.log(
        `🔧 [CREATE] Pas de pages spécifiques - utiliser les sources RAG externes`,
      );

      // 🔥 FIX: Utiliser la fonction helper pour mapper les IDs vers vrais UUIDs
      sourcesForAI = await mapRagSourcesToRealUUIDs(ragSources);
    }

    // 🔥 Limites selon reflection: rapide = mode standard (0-2 tools), profond = mode search (3-5+ tools)
    const useSearchMode = reflection === "profond";
    console.log(
      `🔧 [CREATE] useSearchMode: ${useSearchMode} (reflection: ${reflection})`,
    );

    let toolResults = "";
    let currentThinking = "";
    let currentToolCalls: any[] = []; // 🔥 NOUVEAU: Stocker les tool calls pour metadata
    let intermediateThinkingBlocks: any[] = []; // 🔥 NOUVEAU: Stocker intermediate thinking pour metadata

    try {
      const persona = await readPersonalizationFromReq(req);
      const personaSnippet = buildPersonaSnippet(persona, 400);

      const toolDecision = await FunctionCallingService.decideAndExecuteTools({
        query: sanitizedInstruction,
        availableSources: sourcesForAI,
        workspaceId,
        userId: req.user!.id,
        useWeb,
        systemPrompt: `System: Tu dois créer un COURS DÉTAILLÉ et structuré basé sur l'instruction de l'utilisateur.

⚠️ FORMAT COURS - INTERDICTIONS STRICTES:
- ❌ INTERDIT: Phrases conversationnelles ("Absolument !", "Je suis ravi", "N'hésite pas")
- ❌ INTERDIT: Références à toi-même ("je", "je vais")
- ✅ OBLIGATOIRE: Format de cours professionnel uniquement

${personaSnippet}

'''${LATEX_STRICT_RULES}'''`,
        isSearch: useSearchMode, // 🔥 Profond = plus de tools (comme search), rapide = moins de tools

        // Callbacks pour streaming temps réel
        onThinking: (thinkingChunk) => {
          const timestamp = new Date().toISOString();
          currentThinking += thinkingChunk;
          res.write(
            `event: thinking\ndata: ${JSON.stringify({ content: thinkingChunk, timestamp })}\n\n`,
          );
          if (typeof (res as any).flush === "function") {
            (res as any).flush();
          }
        },

        onToolCall: (toolName, args) => {
          const timestamp = new Date().toISOString();
          res.write(
            `event: tool_call\ndata: ${JSON.stringify({ tool: toolName, args, timestamp })}\n\n`,
          );
          if (typeof (res as any).flush === "function") {
            (res as any).flush();
          }
        },

        onToolResult: (toolName, toolResult) => {
          const timestamp = new Date().toISOString();
          const truncated =
            toolResult.length > 200
              ? toolResult.slice(0, 200) + "..."
              : toolResult;
          res.write(
            `event: tool_result\ndata: ${JSON.stringify({ tool: toolName, result: truncated, timestamp })}\n\n`,
          );
          if (typeof (res as any).flush === "function") {
            (res as any).flush();
          }
        },

        onIntermediateThinking: (thinkingChunk) => {
          const timestamp = new Date().toISOString();
          res.write(
            `event: intermediate_thinking\ndata: ${JSON.stringify({ content: thinkingChunk, timestamp })}\n\n`,
          );
          if (typeof (res as any).flush === "function") {
            (res as any).flush();
          }
        },
      });

      console.log(
        `✅ [CREATE-PHASE-1] Terminé: ${toolDecision.toolCalls.length} tools exécutés`,
      );

      // 🔥 Stocker les tool calls et intermediate thinking pour metadata
      currentToolCalls = toolDecision.toolCalls || [];
      intermediateThinkingBlocks =
        toolDecision.intermediateThinkingBlocks || [];

      // 🔥 Construire le contexte à partir des résultats des tools
      toolResults = FunctionCallingService.buildContextFromToolResults(
        toolDecision.toolCalls,
      );
    } catch (error) {
      console.error("❌ [CREATE-FUNCTION-CALLING] Erreur:", error);
      toolResults = ""; // Continuer sans tools en cas d'erreur
    }

    // 🔥 PHASE 2: Génération de la page avec les résultats des tools
    console.log(`🔧 [CREATE-PHASE-2] Génération de la page...`);

    if (reflection === "profond") {
      try {
        // 🎯 Mode profond: Utiliser Gemini avec thinking
        const optimizedPrompt = optimizePrompt(
          "create",
          sanitizedInstruction,
          toolResults,
          "",
          req,
        );
        const persona = await readPersonalizationFromReq(req);
        const personaSnippet = buildPersonaSnippet(persona, 600);

        let full = "";
        let thinkingContent = currentThinking;
        await GeminiService.generateWithThinking({
          prompt: optimizedPrompt.userMessage,
          context: `${personaSnippet ? personaSnippet + "\n\n" : ""}${optimizedPrompt.systemMessage}`,
          temperature: optimizedPrompt.temperature,
          maxTokens: 40000, // 🔥 CORRECTION: 40000 pour mode profond CREATE (comme create.ts)
          onStream: (chunk: string) => {
            const normalized = String(chunk || "");
            full += normalized;
            sseWriteData(res, normalized);
          },
          onThinking: (thinking: string) => {
            thinkingContent += thinking;
            res.write(`event: status\n`);
            res.write(`data: 🤔 ${thinking}\n\n`);
            if ((res as any).flush) {
              (res as any).flush();
            }
          },
        });

        let finalTitle = (typeof title === "string" ? title : "").trim();
        if (!finalTitle || finalTitle.toLowerCase() === "nouvelle page") {
          try {
            const t = await AIService.generateContent({
              prompt: `Génère un titre court et clair (6 mots max) pour une page basée sur: ${sanitizedInstruction}. Réponds uniquement par le titre, sans guillemets.`,
              context: buildLangInstruction(detectPreferredLanguage(req)),
              temperature: 0.3,
              maxTokens: 40,
            });
            finalTitle = (t.content || "Nouvelle page")
              .replace(/^\"|\"$/g, "")
              .trim();
          } catch {
            finalTitle = "Nouvelle page";
          }
        }

        const page = await prisma.page.create({
          data: {
            title: finalTitle,
            slug:
              finalTitle
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") +
              "-" +
              Math.floor(Math.random() * 10000),
            projectId: projectId || null,
            workspaceId,
            createdBy: req.user!.id,
          },
        });
        const blockNote = toBlockNoteAuto(
          normalizeMarkdownForHeadings(sanitizeAIGeneratedContent(full)),
        );
        await prisma.page.update({
          where: { id: page.id },
          data: { blockNoteContent: blockNote },
        });

        res.write(`event: page\n`);
        res.write(
          `data: ${JSON.stringify({ pageId: page.id, title: page.title, projectId: page.projectId, thinking: thinkingContent })}\n\n`,
        );

        // 🔥 NOUVEAU: Envoyer les métadonnées avec scores pour CREATE mode
        res.write(`event: metadata\n`);
        res.write(
          `data: ${JSON.stringify({
            toolCalls: currentToolCalls,
            thinking: currentThinking,
            usedFallback: false,
            intermediateThinkingBlocks: intermediateThinkingBlocks,
          })}\n\n`,
        );

        res.write("event: done\n\n");
        res.end();
        return;
      } catch (error) {
        console.warn("⚠️ Gemini failed, fallback to OpenAI:", error);
      }
    }

    // 🎯 Mode rapide: Utiliser OpenAI avec tool results
    const optimizedPrompt = optimizePrompt(
      "create",
      sanitizedInstruction,
      toolResults,
      "",
      req,
    );
    const persona = await readPersonalizationFromReq(req);
    const personaSnippet = buildPersonaSnippet(persona, 600);

    let full = "";
    await AIService.generateContent({
      prompt: optimizedPrompt.userMessage,
      context: `${personaSnippet ? personaSnippet + "\n\n" : ""}${optimizedPrompt.systemMessage}`,
      temperature: optimizedPrompt.temperature,
      maxTokens: optimizedPrompt.maxTokens,
      onStream: (chunk: string) => {
        const normalized = String(chunk || "");
        full += normalized;
        sseWriteData(res, normalized);
      },
    });

    let finalTitle = (typeof title === "string" ? title : "").trim();
    if (!finalTitle || finalTitle.toLowerCase() === "nouvelle page") {
      try {
        const t = await AIService.generateContent({
          prompt: `Génère un titre court et clair (6 mots max) pour une page basée sur: ${sanitizedInstruction}. Réponds uniquement par le titre, sans guillemets.`,
          context: buildLangInstruction(detectPreferredLanguage(req)),
          temperature: 0.3,
          maxTokens: 40,
        });
        finalTitle = (t.content || "Nouvelle page")
          .replace(/^"|"$/g, "")
          .trim();
      } catch {
        finalTitle = "Nouvelle page";
      }
    }

    const page = await prisma.page.create({
      data: {
        title: finalTitle,
        slug:
          finalTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") +
          "-" +
          Math.floor(Math.random() * 10000),
        projectId: projectId || null,
        workspaceId,
        createdBy: req.user!.id,
      },
    });
    const blockNote = toBlockNoteAuto(
      normalizeMarkdownForHeadings(sanitizeAIGeneratedContent(full)),
    );
    await prisma.page.update({
      where: { id: page.id },
      data: { blockNoteContent: blockNote },
    });

    res.write(`event: page\n`);
    res.write(
      `data: ${JSON.stringify({ pageId: page.id, title: page.title })}\n\n`,
    );

    // 🔥 NOUVEAU: Envoyer les métadonnées avec scores pour CREATE mode
    res.write(`event: metadata\n`);
    res.write(
      `data: ${JSON.stringify({
        toolCalls: currentToolCalls,
        thinking: currentThinking,
        usedFallback: false,
        intermediateThinkingBlocks: intermediateThinkingBlocks,
      })}\n\n`,
    );

    res.write("event: done\n\n");
    res.end();
  } catch (e) {
    console.error("assistantCreateStream error", e);
    try {
      res.write(`event: error\ndata: ${(e as any)?.message || "Erreur"}\n\n`);
    } catch {}
    res.end();
  }
};
