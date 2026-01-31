/**
 * Utilitaires pour le traitement JSON dans le contexte des quiz IA
 */
export class JsonUtils {
  /**
   * Nettoie le contenu JSON pour gérer les équations LaTeX qui peuvent casser le parsing
   */
  static cleanJsonContent(content: string): string {
    // Nettoyer les équations LaTeX problématiques dans les strings
    // Remplacer temporairement les accolades dans les valeurs de string
    let cleaned = content;

    // 1. Protéger les équations LaTeX entre quotes
    const stringMatches = cleaned.match(/"[^"]*"/g);
    if (stringMatches) {
      stringMatches.forEach((match) => {
        // Échapper les accolades dans les strings pour éviter les conflits JSON
        const cleaned_match = match.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
        cleaned = cleaned.replace(match, cleaned_match);
      });
    }

    // 2. Gérer les JSON tronqués en essayant de les compléter
    if (!cleaned.endsWith("}") && !cleaned.endsWith("]}")) {
      console.log("🔧 Tentative de réparation JSON tronqué...");

      // Compter les accolades ouvertes non fermées
      const openBraces = (cleaned.match(/\{/g) || []).length;
      const closeBraces = (cleaned.match(/\}/g) || []).length;
      const missing = openBraces - closeBraces;

      if (missing > 0) {
        // Fermer les strings ouvertes si nécessaire
        const quotes = (cleaned.match(/"/g) || []).length;
        if (quotes % 2 !== 0) {
          cleaned += '"';
        }

        // Ajouter les accolades manquantes
        cleaned += "}".repeat(missing);
      }
    }

    return cleaned;
  }

  /**
   * Parse JSON avec méthodes de récupération avancées
   */
  static parseJsonWithRecovery(content: string): unknown {
    // Nettoyer d'abord le contenu
    const cleanedContent = this.cleanJsonContent(content);

    try {
      return JSON.parse(cleanedContent);
    } catch (error) {
      console.log(
        "🔧 Parsing JSON direct échoué, tentatives de récupération...",
      );

      // Tentative 1 : Extraire le JSON principal avec une approche différente
      try {
        // Chercher le début et la fin de l'objet principal
        const firstBrace = cleanedContent.indexOf("{");
        const lastBrace = cleanedContent.lastIndexOf("}");

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const extracted = cleanedContent.substring(firstBrace, lastBrace + 1);
          return JSON.parse(extracted);
        }
      } catch (e) {
        // 🛡️ Log l'erreur au lieu de l'ignorer silencieusement
        console.warn(
          "⚠️ [JSON-UTILS] Tentative extraction JSON échouée:",
          e instanceof Error ? e.message : "Erreur inconnue",
        );
      }

      // Tentative 2 : Chercher des patterns de questions individuelles
      try {
        const questionPattern =
          /"id"\s*:\s*"[^"]*"[^}]*"type"\s*:\s*"[^"]*"[^}]*"question"\s*:\s*"[^"]*"/g;
        const matches = cleanedContent.match(questionPattern);

        if (matches) {
          console.log(`🔧 Trouvé ${matches.length} patterns de questions`);
          // Essayer de reconstruire le JSON
          const questions = [];
          for (const match of matches) {
            try {
              // Chercher l'objet complet autour de ce pattern
              const startIndex = cleanedContent.indexOf(match);
              const beforeMatch = cleanedContent
                .substring(0, startIndex)
                .lastIndexOf("{");

              if (beforeMatch !== -1) {
                let braceCount = 1;
                let endIndex = beforeMatch + 1;

                while (endIndex < cleanedContent.length && braceCount > 0) {
                  if (cleanedContent[endIndex] === "{") braceCount++;
                  if (cleanedContent[endIndex] === "}") braceCount--;
                  endIndex++;
                }

                if (braceCount === 0) {
                  const questionJson = cleanedContent.substring(
                    beforeMatch,
                    endIndex,
                  );
                  const question = JSON.parse(questionJson);
                  if (question.id && question.type && question.question) {
                    questions.push(question);
                  }
                }
              }
            } catch (e) {
              console.warn("⚠️ Impossible de parser une question individuelle");
            }
          }

          if (questions.length > 0) {
            return {
              title: "Quiz généré",
              description: "",
              questions: questions,
            };
          }
        }
      } catch (e) {
        // 🛡️ Log l'erreur au lieu de l'ignorer silencieusement
        console.warn(
          "⚠️ [JSON-UTILS] Tentative reconstruction questions échouée:",
          e instanceof Error ? e.message : "Erreur inconnue",
        );
      }

      throw new Error(
        `Impossible de parser le JSON même avec les méthodes de récupération: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
      );
    }
  }

  /**
   * Tente d'extraire le JSON du contenu markdown ou texte
   */
  static extractJsonFromText(content: string): unknown {
    try {
      // Essayer de parser directement
      return JSON.parse(content);
    } catch (error) {
      try {
        // Tenter d'extraire le JSON du contenu markdown ou texte
        let jsonContent = content;

        // 1. Extraire JSON des blocs markdown ```json
        const markdownJsonMatch = jsonContent.match(
          /```json\s*([\s\S]*?)\s*```/,
        );
        if (markdownJsonMatch) {
          jsonContent = markdownJsonMatch[1];
          return this.parseJsonWithRecovery(jsonContent);
        } else {
          // 2. Extraire JSON des blocs de code génériques
          const codeBlockMatch = jsonContent.match(/```\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch) {
            jsonContent = codeBlockMatch[1];
            return this.parseJsonWithRecovery(jsonContent);
          } else {
            // 3. Parsing direct du contenu avec récupération
            return this.parseJsonWithRecovery(jsonContent);
          }
        }
      } catch (secondError) {
        console.error("❌ Contenu IA non parsable:", content.substring(0, 500));
        console.error("❌ Erreur de parsing détaillée:", secondError);
        throw new Error("Erreur de parsing du JSON généré par l'IA");
      }
    }
  }
}
