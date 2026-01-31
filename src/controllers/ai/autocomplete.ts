import { Request, Response } from "express";
import { z } from "zod";
import { AIService } from "../../services/ai/index.js";
import WebSocket from "ws";
import { UserSyncService } from "../../services/userSync.js";
import { IncomingMessage } from "http";

// Interface pour WebSocket authentifié
interface AuthenticatedWebSocket extends WebSocket {
  user?: { id: string; email?: string };
}

// Interface pour les résultats de streaming
interface AutocompleteStreamResult {
  suggestions: string[];
  context: {
    beforeCursor: string;
    afterCursor: string;
    detectedIntent: string;
  };
  isComplete: boolean;
  currentSuggestionIndex?: number;
}

// Schéma de validation pour l'autocomplétion
const autocompleteSchema = z.object({
  content: z.string().min(1, "Le contenu est requis"),
  cursorPosition: z.number().int().min(0),
  blockType: z
    .enum(["text", "heading2", "heading3", "list", "quote", "code"])
    .optional(),
  maxSuggestions: z.number().int().min(1).max(5).optional().default(3),
});

// 🚀 NOUVEAU : Fonction utilitaire pour vérifier les préférences utilisateur
const checkAutocompletionEnabled = async (userId: string): Promise<boolean> => {
  try {
    const user = await UserSyncService.getUser(userId);
    const isEnabled = user?.autocompletionEnabled ?? true;

    console.log(`👤 [AUTOCOMPLETION] Préférences utilisateur ${userId}:`, {
      autocompletionEnabled: isEnabled,
    });

    return isEnabled;
  } catch (error) {
    console.error(
      "❌ Erreur lors de la vérification des préférences utilisateur:",
      error,
    );
    // En cas d'erreur, autoriser par défaut
    return true;
  }
};

// Autocomplétion intelligente
export const autocomplete = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    // 🚀 NOUVEAU : Vérifier si l'autocomplétion est activée pour cet utilisateur
    const isEnabled = await checkAutocompletionEnabled(req.user.id);
    if (!isEnabled) {
      return res.status(403).json({
        error: "Autocomplétion désactivée",
        message:
          "L'autocomplétion est désactivée dans vos préférences utilisateur",
        code: "AUTOCOMPLETION_DISABLED",
      });
    }

    const validatedData = autocompleteSchema.parse(req.body);

    // 🚫 Créer un AbortController pour pouvoir annuler la requête côté serveur
    const abortController = new AbortController();

    // 🚫 Annuler la requête si la connexion client se ferme
    req.on("close", () => {
      if (!abortController.signal.aborted) {
        console.log(
          "🚫 [AUTOCOMPLETE] Connexion client fermée, annulation de la requête",
        );
        abortController.abort();
      }
    });

    const startTime = Date.now();
    const result = await AIService.autocomplete(
      validatedData.content,
      validatedData.cursorPosition,
      validatedData.blockType,
      validatedData.maxSuggestions,
      abortController.signal, // 🚫 Passer le signal d'annulation
    );
    const responseTime = Date.now() - startTime;

    res.json({
      message: "Suggestions d'autocomplétion générées",
      result: {
        ...result,
        responseTime,
        originalContent: validatedData.content,
        cursorPosition: validatedData.cursorPosition,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Données invalides",
        details: error.errors,
      });
    }

    // 🚫 Gérer spécifiquement les erreurs d'annulation
    if (
      error instanceof Error &&
      (error.message.includes("annulée") || error.name === "AbortError")
    ) {
      console.log("🚫 [AUTOCOMPLETE] Requête annulée côté contrôleur");
      return res.status(499).json({
        error: "Requête annulée",
        message: "La requête d'autocomplétion a été annulée",
      });
    }

    console.error("Erreur autocomplétion:", error);
    res.status(500).json({
      error: "Erreur lors de l'autocomplétion",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

// 🚀 NOUVEAU : Gestionnaire WebSocket pour l'autocomplétion en streaming
export const handleAutocompleteWebSocket = (
  ws: AuthenticatedWebSocket,
  req: IncomingMessage,
) => {
  console.log("🔌 [WS-AUTOCOMPLETE] Nouvelle connexion WebSocket");

  let currentAbortController: AbortController | null = null;
  let lastRequestId: string | null = null;

  // 🚀 NOUVEAU : Extraire l'utilisateur du WebSocket
  const user = ws.user;
  if (!user) {
    console.error("❌ [WS-AUTOCOMPLETE] Utilisateur non trouvé sur WebSocket");
    ws.close(1008, "Utilisateur non authentifié");
    return;
  }

  // 🚫 Fonction pour annuler proprement une requête
  const cancelCurrentRequest = (reason: string) => {
    if (currentAbortController && !currentAbortController.signal.aborted) {
      console.log(`🚫 [WS-AUTOCOMPLETE] ${reason}`);
      currentAbortController.abort();
      currentAbortController = null;
      lastRequestId = null;
    }
  };

  ws.on("message", async (message: string) => {
    try {
      // 🛡️ Sécurisation du parsing JSON pour éviter les crashes
      let data;
      try {
        data = JSON.parse(message);
      } catch (parseError) {
        console.error("❌ [WS-AUTOCOMPLETE] Message JSON invalide:", {
          message: message.substring(0, 100),
          error:
            parseError instanceof Error
              ? parseError.message
              : "Erreur de parsing inconnue",
          userId: user.id,
        });

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Format de message invalide - JSON attendu",
              code: "INVALID_JSON_FORMAT",
              timestamp: Date.now(),
            }),
          );
        }
        return;
      }
      console.log("📨 [WS-AUTOCOMPLETE] Message reçu:", {
        type: data.type,
        content: data.content?.substring(0, 50) + "...",
        cursorPosition: data.cursorPosition,
        requestId: data.requestId,
        userId: user.id,
      });

      if (data.type === "autocomplete") {
        // 🚀 NOUVEAU : Vérifier les préférences utilisateur avant de traiter
        const isEnabled = await checkAutocompletionEnabled(user.id);
        if (!isEnabled) {
          console.log(
            `🚫 [WS-AUTOCOMPLETE] Autocomplétion désactivée pour l'utilisateur ${user.id}`,
          );

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "error",
                error:
                  "Autocomplétion désactivée dans vos préférences utilisateur",
                code: "AUTOCOMPLETION_DISABLED",
                timestamp: Date.now(),
              }),
            );
          }
          return;
        }

        // Annuler toute requête précédente immédiatement
        cancelCurrentRequest(
          "Nouvelle requête reçue, annulation de la précédente",
        );

        // Valider les données
        const validatedData = autocompleteSchema.parse(data);

        // Créer un nouveau AbortController pour cette requête
        currentAbortController = new AbortController();
        const requestId = data.requestId || Date.now().toString();
        lastRequestId = requestId;

        console.log(
          `🚀 [WS-AUTOCOMPLETE] Démarrage autocomplétion streaming [${requestId}] pour utilisateur ${user.id}...`,
        );

        try {
          // Utiliser le service d'autocomplétion avec streaming
          await AIService.autocompleteStream(
            validatedData.content,
            validatedData.cursorPosition,
            validatedData.blockType,
            validatedData.maxSuggestions || 3,
            (streamResult: AutocompleteStreamResult) => {
              // 🚫 Vérifier que cette requête n'a pas été annulée
              if (
                currentAbortController?.signal.aborted ||
                lastRequestId !== requestId
              ) {
                console.log(
                  `🚫 [WS-AUTOCOMPLETE] Chunk ignoré - requête [${requestId}] annulée`,
                );
                return;
              }

              // Envoyer chaque chunk au client
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: "autocomplete_chunk",
                    data: streamResult,
                    requestId: requestId,
                    timestamp: Date.now(),
                  }),
                );
              }
            },
            currentAbortController.signal,
          );

          // 🚫 Vérifier une dernière fois que la requête n'a pas été annulée
          if (
            !currentAbortController?.signal.aborted &&
            lastRequestId === requestId
          ) {
            console.log(
              `✅ [WS-AUTOCOMPLETE] Autocomplétion terminée [${requestId}]`,
            );
            currentAbortController = null;
            lastRequestId = null;
          }
        } catch (error) {
          // 🚫 Gérer spécifiquement les erreurs d'annulation
          if (
            error instanceof Error &&
            (error.message.includes("annulée") ||
              error.name === "AbortError" ||
              currentAbortController?.signal.aborted)
          ) {
            console.log(
              `🚫 [WS-AUTOCOMPLETE] Requête [${requestId}] annulée avec succès`,
            );

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "autocomplete_cancelled",
                  requestId: requestId,
                  timestamp: Date.now(),
                }),
              );
            }
          } else {
            console.error(
              `❌ [WS-AUTOCOMPLETE] Erreur requête [${requestId}]:`,
              error,
            );

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error:
                    error instanceof Error ? error.message : "Erreur inconnue",
                  requestId: requestId,
                  timestamp: Date.now(),
                }),
              );
            }
          }
        }
      } else if (data.type === "cancel") {
        // Annuler la requête en cours
        cancelCurrentRequest("Requête annulée par le client");

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "autocomplete_cancelled",
              timestamp: Date.now(),
            }),
          );
        }
      }
    } catch (error) {
      console.error("❌ [WS-AUTOCOMPLETE] Erreur:", error);

      // Gérer spécifiquement les erreurs d'annulation
      if (
        error instanceof Error &&
        (error.message.includes("annulée") || error.name === "AbortError")
      ) {
        console.log("🚫 [WS-AUTOCOMPLETE] Requête annulée (erreur gérée)");
        return; // Ne pas envoyer d'erreur pour les annulations
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Erreur inconnue",
            timestamp: Date.now(),
          }),
        );
      }
    }
  });

  ws.on("close", () => {
    console.log(
      `🔌 [WS-AUTOCOMPLETE] Connexion fermée pour utilisateur ${user.id}`,
    );
    // Annuler toute requête en cours
    if (currentAbortController) {
      currentAbortController.abort();
    }
  });

  ws.on("error", (error) => {
    console.error(
      `❌ [WS-AUTOCOMPLETE] Erreur WebSocket pour utilisateur ${user.id}:`,
      error,
    );
    // Annuler toute requête en cours
    if (currentAbortController) {
      currentAbortController.abort();
    }
  });
};
