/**
 * GraphicBasedQuizGenerator - Générateur de quiz intégrant des graphiques IA
 * Workflow : 1) Génère le graphique d'abord 2) Donne le JSON à l'IA 3) L'IA crée les questions basées sur ce graphique
 */

import {
  QuizGenerationRequest,
  GeneratedQuiz,
  Question,
  QuestionType,
  GeneratedGraphicData,
} from "../types.js";
import { AIService } from "../../ai/base.js";
import { AIGraphicGenerator } from "../graphics/aiGraphicGenerator.js";

export interface GraphicBasedQuizMetadata {
  hasGraphics: boolean;
  generatedGraphics: GeneratedGraphicData[];
  graphicsGenerationTime: number;
  graphicsRatio: number; // Pourcentage de questions avec graphiques
  totalQuestions: number;
}

// Re-export du type pour compatibilité
export type GeneratedGraphic = GeneratedGraphicData;

export interface GraphicBasedQuizResult {
  quiz: GeneratedQuiz;
  graphicMetadata: GraphicBasedQuizMetadata;
}

// Configuration par matière pour la génération graphique
const SUBJECT_GRAPHIC_MAPPING: {
  [key: string]: {
    topics: string[];
    probability: number;
    preferredLibrary: string;
  };
} = {
  Physique: {
    topics: ["oscillations", "cinématique", "optique", "forces", "ondes"],
    probability: 0.8,
    preferredLibrary: "apexcharts",
  },
  Mathématiques: {
    topics: [
      "fonctions",
      "géométrie",
      "statistiques",
      "probabilités",
      "dérivées",
    ],
    probability: 0.9,
    preferredLibrary: "apexcharts",
  },
  Chimie: {
    topics: [
      "cinétique",
      "équilibres",
      "orbitales",
      "spectroscopie",
      "thermochimie",
    ],
    probability: 0.7,
    preferredLibrary: "plotly",
  },
  SVT: {
    topics: ["physiologie", "génétique", "écologie", "anatomie", "évolution"],
    probability: 0.6,
    preferredLibrary: "plotly",
  },
  "Physique-Chimie": {
    topics: ["oscillations", "cinétique", "forces", "équilibres", "ondes"],
    probability: 0.75,
    preferredLibrary: "auto",
  },
};

/**
 * Générateur de quiz basé sur des graphiques générés par l'IA
 */
export class GraphicBasedQuizGenerator {
  private static aiGraphicGenerator = new AIGraphicGenerator();

  /**
   * Génère un quiz complet basé sur des graphiques IA
   */
  static async generateGraphicBasedQuiz(
    request: QuizGenerationRequest,
    subjectName: string,
    questionCount: number = 3,
  ): Promise<GraphicBasedQuizResult> {
    const startTime = Date.now();

    console.log(
      `🎨 [GRAPHIC-QUIZ] Génération quiz basé sur graphiques pour ${subjectName}`,
    );

    try {
      // 1. Déterminer si cette matière bénéficie des graphiques
      const graphicConfig = this.getGraphicConfigForSubject(subjectName);
      if (!graphicConfig) {
        throw new Error(
          `Matière ${subjectName} ne supporte pas les graphiques`,
        );
      }

      // 2. Générer 1-2 graphiques seulement (pas 1 par question)
      const graphicsCount = Math.min(
        2,
        Math.max(1, Math.ceil(questionCount / 2)),
      ); // 1-2 graphiques max
      const graphics = await this.generateGraphicsFirst(
        subjectName,
        graphicConfig,
        request.schoolLevel,
        graphicsCount,
      );

      if (graphics.length === 0) {
        throw new Error("Aucun graphique généré");
      }

      console.log(`🎨 [GRAPHIC-QUIZ] ${graphics.length} graphiques générés`);

      // 3. Générer les questions basées sur ces graphiques
      const questions = await this.generateQuestionsFromGraphics(
        graphics,
        request,
        subjectName,
      );

      // 4. Construire le quiz final
      const quiz: GeneratedQuiz = {
        id: `graphic_quiz_${Date.now()}`,
        title: `Quiz ${subjectName} avec graphiques IA`,
        aiGeneratedTitle: `🎨 Quiz ${subjectName} - Analyse graphique`,
        description: `Quiz basé sur ${graphics.length} graphiques générés par l'IA`,
        schoolLevel: request.schoolLevel,
        questions,
        totalPoints: questions.reduce((sum, q) => sum + q.points, 0),
        estimatedTime: questions.length * 3, // 3 min par question avec graphique
        hasGraphics: true,
        graphicsData: graphics, // Nouveauté : graphiques intégrés
        metadata: {
          generatedAt: new Date(),
          aiModel: "gpt-4o-mini",
          generationTime: Date.now() - startTime,
        },
      };

      const graphicMetadata: GraphicBasedQuizMetadata = {
        hasGraphics: true,
        generatedGraphics: graphics,
        graphicsGenerationTime: Date.now() - startTime,
        graphicsRatio: 1.0, // 100% des questions ont des graphiques
        totalQuestions: questions.length,
      };

      console.log(
        `✅ [GRAPHIC-QUIZ] Quiz généré avec ${questions.length} questions graphiques`,
      );

      return {
        quiz,
        graphicMetadata,
      };
    } catch (error) {
      console.error("❌ [GRAPHIC-QUIZ] Erreur génération:", error);
      throw error;
    }
  }

  /**
   * Étape 1 : Génère les graphiques d'abord
   */
  private static async generateGraphicsFirst(
    subject: string,
    config: any,
    level: string,
    count: number,
  ): Promise<GeneratedGraphic[]> {
    console.log(
      `🎨 [GRAPHIC-FIRST] Génération de ${count} graphiques pour ${subject}`,
    );

    const graphics: GeneratedGraphic[] = [];

    for (let i = 0; i < count; i++) {
      try {
        // Choisir un topic aléatoire
        const topic =
          config.topics[Math.floor(Math.random() * config.topics.length)];

        // Générer le graphique via l'IA
        const graphicResult =
          await this.aiGraphicGenerator.generateGraphicWithAI({
            subject,
            topic,
            level,
            questionContext: `Question ${i + 1} de ${subject} sur ${topic} niveau ${level}`,
            library: config.preferredLibrary,
          });

        const graphic: GeneratedGraphic = {
          id: `graphic_${Date.now()}_${i}`,
          subject,
          topic,
          level,
          library: graphicResult.library as "apexcharts" | "plotly",
          type: graphicResult.type,
          description: graphicResult.description,
          config: graphicResult.config,
          dataValues: graphicResult.dataValues || [],
          questionContext: `Analyser le graphique ${graphicResult.type} représentant ${topic} en ${subject}`,
        };

        graphics.push(graphic);
        console.log(
          `✅ [GRAPHIC-FIRST] Graphique ${i + 1}/${count} généré: ${graphicResult.type} (${graphicResult.library})`,
        );
      } catch (error) {
        console.error(`❌ [GRAPHIC-FIRST] Erreur graphique ${i + 1}:`, error);
        // Continuer avec les autres graphiques
      }
    }

    return graphics;
  }

  /**
   * Étape 2 : Génère TOUTES les questions en une seule fois avec tous les graphiques en contexte
   * (Approche optimisée inspirée du système documentaire)
   */
  private static async generateQuestionsFromGraphics(
    graphics: GeneratedGraphic[],
    request: QuizGenerationRequest,
    subjectName: string,
  ): Promise<Question[]> {
    const totalQuestions = request.questionCount || 3;

    console.log(
      `📝 [QUESTIONS-FROM-GRAPHICS] Génération groupée de ${totalQuestions} questions basées sur ${graphics.length} graphiques (approche optimisée)`,
    );

    try {
      // Construire le contexte complet avec TOUS les graphiques
      const allGraphicsContext = this.buildAllGraphicsContextForAI(graphics);

      // Calculer la distribution des questions par graphique
      const questionDistribution = this.calculateQuestionDistribution(
        totalQuestions,
        graphics.length,
      );

      const prompt = `Tu es un expert en conception d'examens pour ${subjectName} niveau ${request.schoolLevel}.

${allGraphicsContext}

INSTRUCTIONS DE GÉNÉRATION:
- Crée EXACTEMENT ${totalQuestions} questions basées sur les graphiques fournis
- Distribution suggérée : ${questionDistribution.map((count, i) => `${count} question(s) pour Graphique ${i + 1}`).join(", ")}
- Tu peux adapter cette distribution selon la pertinence des graphiques
- Varie les aspects analysés : lecture directe, tendances, calculs, comparaisons
- Chaque question doit être analysable en lisant les données du graphique
- Inclus les valeurs précises des graphiques dans les questions ou réponses
- Type: MULTIPLE_CHOICE avec exactement 4 options chacune
- Points: 3 par question

RÈGLES JSON STRICTES - TRÈS IMPORTANT:
- Réponds UNIQUEMENT avec du JSON valide
- AUCUN texte avant ou après le JSON
- AUCUN commentaire dans le JSON
- Array de ${totalQuestions} questions exactement : [ {question1}, {question2}, {question3} ]
- Utilise uniquement des doubles guillemets (")
- ATTENTION : Pour les apostrophes, utilise "D'après" et PAS "D\\'après"
- Échappe seulement les guillemets internes avec \\"
- Vérifie que toutes les accolades {} et crochets [] sont fermés
- CHAQUE objet question doit être séparé par une virgule
- PAS de virgule après le dernier objet
- Assure-toi que graphicConfig est un objet JSON valide (pas de fonctions)
- Teste mentalement : le JSON doit être parsable par JSON.parse()

STRUCTURE JSON EXACTE (array de ${totalQuestions} questions):
[
  {
    "id": "q_${Date.now()}_1",
    "question": "Question sur le graphique (utilise 'D'après' et non 'D\\\\'après')",
    "type": "MULTIPLE_CHOICE",
    "difficulty": "moyen",
    "options": [
      {"id": "A", "text": "Option A", "isCorrect": true},
      {"id": "B", "text": "Option B", "isCorrect": false},
      {"id": "C", "text": "Option C", "isCorrect": false},
      {"id": "D", "text": "Option D", "isCorrect": false}
    ],
    "points": 3,
    "hasGraphic": true,
    "graphicId": "ID_DU_GRAPHIQUE_CORRESPONDANT",
    "graphicLibrary": "apexcharts_ou_plotly",
    "graphicType": "2d_ou_3d",
    "graphicDescription": "Description du graphique utilisé",
    "graphicConfig": {...configuration_du_graphique...},
    "graphicDataValues": [...valeurs_du_graphique...]
  }
  // ... répéter pour ${totalQuestions} questions au total
]

ATTENTION CRITIQUE:
- Génère EXACTEMENT ${totalQuestions} questions
- Assure-toi qu'UNE SEULE option par question a "isCorrect": true
- Référence le bon graphique pour chaque question (graphicId, graphicConfig, etc.)
- Utilise "D'après" et "l'axe" normalement (pas d'échappement excessif)
- Teste mentalement que ton JSON array est valide avant de répondre`;

      console.log(
        `🤖 [QUESTIONS-FROM-GRAPHICS] Appel IA unique pour ${totalQuestions} questions`,
      );

      const response = await AIService.generateContent({
        prompt,
        maxTokens: 16000, // Augmenté pour contexte riche avec tous les graphiques
        temperature: 0.3,
      });

      // Parser la réponse JSON (array de questions)
      const questionsArray = this.parseQuestionsArrayJSON(
        response.content.trim(),
      );

      console.log(
        `✅ [QUESTIONS-FROM-GRAPHICS] ${questionsArray.length} questions générées en une fois`,
      );
      return questionsArray;
    } catch (error) {
      console.error(
        `❌ [QUESTIONS-FROM-GRAPHICS] Erreur génération groupée:`,
        error,
      );

      // Fallback : créer des questions de base
      console.log(
        `🔄 [QUESTIONS-FROM-GRAPHICS] Fallback vers génération individuelle`,
      );
      return this.generateFallbackQuestions(graphics, totalQuestions);
    }
  }

  /**
   * Parse le JSON de question de manière ultra-robuste avec récupération intelligente
   */
  private static parseQuestionJSON(content: string): any {
    try {
      // Nettoyer le contenu d'abord
      let cleanContent = content.trim();

      // Supprimer les blocs de code markdown si présents
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent
          .replace(/^```json\s*/, "")
          .replace(/\s*```$/, "");
      } else if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent
          .replace(/^```\s*/, "")
          .replace(/\s*```$/, "");
      }

      // Nettoyer les caractères problématiques
      cleanContent = this.cleanJSONString(cleanContent);

      // Essayer de parser directement
      return JSON.parse(cleanContent);
    } catch (error) {
      console.error("❌ Erreur parsing JSON question:", error);
      console.log(
        "🔧 Contenu reçu (100 premiers chars):",
        content.substring(0, 100) + "...",
      );

      return this.recoverQuestionFromContent(content);
    }
  }

  /**
   * Nettoie une chaîne JSON pour éviter les erreurs de parsing
   */
  private static cleanJSONString(jsonStr: string): string {
    // Enlever les commentaires JavaScript
    jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, "");
    jsonStr = jsonStr.replace(/\/\/.*$/gm, "");

    // Supprimer les fonctions JavaScript qui cassent le JSON
    jsonStr = jsonStr.replace(
      /"formatter"\s*:\s*function\s*\([^)]*\)\s*\{[^}]*\}/g,
      '"formatter": null',
    );
    jsonStr = jsonStr.replace(
      /"labels"\s*:\s*\{\s*"formatter"\s*:\s*function\s*\([^)]*\)\s*\{[^}]*\}\s*\}/g,
      '"labels": {}',
    );

    // Supprimer d'autres propriétés avec des fonctions
    jsonStr = jsonStr.replace(
      /"\w+"\s*:\s*function\s*\([^)]*\)\s*\{[^}]*\}/g,
      "",
    );

    // Enlever les virgules traînantes
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, "$1");
    jsonStr = jsonStr.replace(/,(\s*,)/g, "$1"); // Virgules multiples

    // Corriger les objets vides mal formés après suppression des fonctions
    jsonStr = jsonStr.replace(/\{\s*,/g, "{");
    jsonStr = jsonStr.replace(/,\s*\}/g, "}");

    // Corriger les guillemets non échappés dans le contenu des propriétés
    jsonStr = jsonStr.replace(
      /"([^"]*)":\s*"([^"]*)"([^,}\]]*)"([^,}\]]*)/g,
      (match, key, value, extra1, extra2) => {
        // Si on trouve des guillemets non échappés, les échapper
        const cleanValue = value + extra1 + extra2;
        const escapedValue = cleanValue.replace(/"/g, '\\"');
        return `"${key}": "${escapedValue}"`;
      },
    );

    // Nettoyer les caractères de contrôle
    jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, "");

    return jsonStr;
  }

  /**
   * Tentative de récupération d'une question à partir du contenu brut
   */
  private static recoverQuestionFromContent(content: string): any {
    try {
      // Tentative 1 : Extraire le JSON principal entre accolades
      const mainJsonMatch = content.match(/\{[\s\S]*\}/);
      if (mainJsonMatch) {
        const extractedJson = this.cleanJSONString(mainJsonMatch[0]);
        console.log("🔧 Tentative extraction JSON principal...");
        return JSON.parse(extractedJson);
      }
    } catch (recoveryError) {
      console.log("❌ Échec extraction JSON principal:", recoveryError);
    }

    try {
      // Tentative 2 : Extraction par étapes des champs essentiels
      console.log("🔧 Tentative extraction manuelle des champs...");

      const questionMatch = content.match(/"question"\s*:\s*"([^"]+)"/);
      const typeMatch = content.match(/"type"\s*:\s*"([^"]+)"/);
      const difficultyMatch = content.match(/"difficulty"\s*:\s*"([^"]+)"/);
      const pointsMatch = content.match(/"points"\s*:\s*(\d+)/);

      // Extraire les options
      const optionsPattern = /"options"\s*:\s*\[([\s\S]*?)\]/;
      const optionsMatch = content.match(optionsPattern);
      let options = [
        { id: "A", text: "Option A générée automatiquement", isCorrect: true },
        { id: "B", text: "Option B générée automatiquement", isCorrect: false },
        { id: "C", text: "Option C générée automatiquement", isCorrect: false },
        { id: "D", text: "Option D générée automatiquement", isCorrect: false },
      ];

      if (optionsMatch) {
        try {
          const optionsText = optionsMatch[1];
          const optionMatches = [
            ...optionsText.matchAll(
              /"id"\s*:\s*"([^"]+)"[\s\S]*?"text"\s*:\s*"([^"]+)"[\s\S]*?"isCorrect"\s*:\s*(true|false)/g,
            ),
          ];

          if (optionMatches.length > 0) {
            options = optionMatches.map((match) => ({
              id: match[1],
              text: match[2],
              isCorrect: match[3] === "true",
            }));
          }
        } catch (optionError) {
          console.log(
            "❌ Erreur extraction options, utilisation des options par défaut",
          );
        }
      }

      const recoveredQuestion = {
        id: `recovered_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        question: questionMatch
          ? questionMatch[1]
          : "Question récupérée automatiquement",
        type: typeMatch ? typeMatch[1] : "MULTIPLE_CHOICE",
        difficulty: difficultyMatch ? difficultyMatch[1] : "moyen",
        options: options,
        points: pointsMatch ? parseInt(pointsMatch[1]) : 3,
        hasGraphic: true, // Puisque cette méthode est utilisée dans un contexte graphique
        graphicId:
          content.match(/"graphicId"\s*:\s*"([^"]+)"/)?.[1] ||
          `graphic_${Date.now()}`,
        graphicLibrary:
          content.match(/"graphicLibrary"\s*:\s*"([^"]+)"/)?.[1] ||
          "apexcharts",
        graphicType:
          content.match(/"graphicType"\s*:\s*"([^"]+)"/)?.[1] || "2d",
        graphicDescription:
          content.match(/"graphicDescription"\s*:\s*"([^"]+)"/)?.[1] ||
          "Graphique récupéré automatiquement",
      };

      console.log(
        "✅ Question récupérée avec succès:",
        recoveredQuestion.question,
      );
      return recoveredQuestion;
    } catch (manualError) {
      console.error("❌ Échec récupération manuelle:", manualError);
    }

    // Fallback final : créer une question de base
    console.log("🔧 Création question de fallback...");
    return {
      id: `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      question: "Question générée automatiquement (erreur de parsing JSON)",
      type: "MULTIPLE_CHOICE",
      difficulty: "moyen",
      options: [
        { id: "A", text: "Réponse A", isCorrect: true },
        { id: "B", text: "Réponse B", isCorrect: false },
        { id: "C", text: "Réponse C", isCorrect: false },
        { id: "D", text: "Réponse D", isCorrect: false },
      ],
      points: 3,
      hasGraphic: false,
    };
  }

  /**
   * Détermine le focus de la question selon l'index
   */
  private static getQuestionFocus(
    questionIndex: number,
    totalQuestions: number,
    topic: string,
  ): string {
    const focuses = [
      "Focus sur la lecture directe des valeurs du graphique",
      "Focus sur l'interprétation et l'analyse des tendances",
      "Focus sur les calculs basés sur les données graphiques",
      "Focus sur la comparaison de différents points du graphique",
    ];

    // Si une seule question, utiliser la lecture directe
    if (totalQuestions === 1) {
      return focuses[0];
    }

    // Répartir les focus selon l'index
    return focuses[questionIndex % focuses.length];
  }

  /**
   * Construit le contexte graphique pour l'IA (ancien format - gardé pour compatibilité)
   */
  private static buildGraphicContextForAI(graphic: GeneratedGraphic): string {
    return `
📊 GRAPHIQUE: ${graphic.type} - ${graphic.description}
📚 BIBLIOTHÈQUE: ${graphic.library}
🎯 SUJET: ${graphic.topic} en ${graphic.subject}
📈 VALEURS CLÉS: [${graphic.dataValues.join(", ")}]

CONFIGURATION JSON DU GRAPHIQUE:
${JSON.stringify(graphic.config, null, 2)}

CONTEXTE: ${graphic.questionContext}
`;
  }

  /**
   * Construit le contexte de TOUS les graphiques pour l'IA (approche optimisée)
   */
  private static buildAllGraphicsContextForAI(
    graphics: GeneratedGraphic[],
  ): string {
    let context = `GRAPHIQUES FOURNIS (${graphics.length} graphiques):\n\n`;

    graphics.forEach((graphic, index) => {
      // Simplifier la config pour éviter les erreurs JSON
      const simplifiedConfig = this.simplifyGraphicConfigForAI(graphic.config);

      context += `=== GRAPHIQUE ${index + 1} ===
🆔 ID: ${graphic.id}
📊 TYPE: ${graphic.type} (${graphic.library})
🎯 SUJET: ${graphic.topic} en ${graphic.subject}
📝 DESCRIPTION: ${graphic.description}
📈 VALEURS CLÉS: [${graphic.dataValues.join(", ")}]

CONFIGURATION JSON SIMPLIFIÉE:
${JSON.stringify(simplifiedConfig, null, 2)}

CONTEXTE: ${graphic.questionContext}

`;
    });

    return context;
  }

  /**
   * Simplifie une configuration de graphique pour l'IA (évite les objets complexes)
   */
  private static simplifyGraphicConfigForAI(config: any): any {
    try {
      // Faire une copie propre sans références circulaires
      const simplified = JSON.parse(JSON.stringify(config));

      // Supprimer les propriétés potentiellement problématiques
      if (simplified.xaxis?.labels?.formatter) {
        delete simplified.xaxis.labels.formatter;
        simplified.xaxis.labels = {
          ...simplified.xaxis.labels,
          formatter: "FONCTION_SUPPRIMÉE",
        };
      }

      if (simplified.yaxis?.labels?.formatter) {
        delete simplified.yaxis.labels.formatter;
        simplified.yaxis.labels = {
          ...simplified.yaxis.labels,
          formatter: "FONCTION_SUPPRIMÉE",
        };
      }

      // Garder seulement les données essentielles pour les questions
      return {
        chart: simplified.chart,
        series: simplified.series,
        data: simplified.data, // Pour Plotly
        xaxis: simplified.xaxis,
        yaxis: simplified.yaxis,
        zaxis: simplified.zaxis,
        title: simplified.title,
        colors: simplified.colors,
        layout: simplified.layout, // Pour Plotly
      };
    } catch (error) {
      console.log("❌ Erreur simplification config:", error);
      return {
        type: "configuration_simplifiée",
        message: "Voir description et valeurs clés",
      };
    }
  }

  /**
   * Calcule la distribution optimale des questions par graphique
   */
  private static calculateQuestionDistribution(
    totalQuestions: number,
    graphicsCount: number,
  ): number[] {
    const distribution: number[] = [];
    const baseQuestionsPerGraphic = Math.floor(totalQuestions / graphicsCount);
    const remainingQuestions = totalQuestions % graphicsCount;

    for (let i = 0; i < graphicsCount; i++) {
      // Distribuer les questions restantes aux premiers graphiques
      const questionsForThisGraphic =
        baseQuestionsPerGraphic + (i < remainingQuestions ? 1 : 0);
      distribution.push(questionsForThisGraphic);
    }

    return distribution;
  }

  /**
   * Parse un array JSON de questions de manière ultra-robuste avec multiple tentatives
   */
  private static parseQuestionsArrayJSON(content: string): any[] {
    console.log(
      `🔧 [PARSE-ARRAY] Tentative parsing array de ${content.length} caractères`,
    );

    try {
      // Nettoyer le contenu d'abord
      let cleanContent = content.trim();

      // Supprimer les blocs de code markdown si présents
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent
          .replace(/^```json\s*/, "")
          .replace(/\s*```$/, "");
      } else if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent
          .replace(/^```\s*/, "")
          .replace(/\s*```$/, "");
      }

      // Nettoyer les caractères problématiques avec méthode renforcée
      cleanContent = this.cleanArrayJSONString(cleanContent);

      // Essayer de parser directement
      const parsed = JSON.parse(cleanContent);

      // Vérifier que c'est bien un array
      if (!Array.isArray(parsed)) {
        throw new Error("La réponse n'est pas un array de questions");
      }

      console.log(
        `✅ [PARSE-ARRAY] ${parsed.length} questions parsées avec succès`,
      );
      return parsed;
    } catch (error) {
      console.error("❌ Erreur parsing JSON array questions:", error);
      console.log(
        "🔧 Contenu autour de l'erreur (pos 1400-1450):",
        content.substring(1380, 1450),
      );

      return this.recoverQuestionsArrayFromContent(content);
    }
  }

  /**
   * Nettoie spécifiquement un array JSON pour éviter les erreurs de parsing
   */
  private static cleanArrayJSONString(jsonStr: string): string {
    // Appliquer le nettoyage de base
    jsonStr = this.cleanJSONString(jsonStr);

    // Fixes spécifiques aux arrays
    // 1. Corriger les virgules traînantes avant les crochets fermants
    jsonStr = jsonStr.replace(/,(\s*\])/g, "$1");

    // 2. Corriger les objets mal fermés dans l'array
    jsonStr = jsonStr.replace(/(\{[^}]*),(\s*\{)/g, "$1},$2");

    // 3. Corriger les doubles virgules
    jsonStr = jsonStr.replace(/,,+/g, ",");

    // 4. S'assurer que les objets sont bien séparés par des virgules
    jsonStr = jsonStr.replace(/\}(\s*)\{/g, "},$1{");

    // 5. Corriger les fins d'objets manquantes avant des virgules
    jsonStr = jsonStr.replace(/([^}]),(\s*\{)/g, "$1},$2");

    // 6. Corriger les configurations graphiques JSON imbriquées avec des virgules
    // Les graphicConfig sont des objets JSON imbriqués qui peuvent avoir des virgules problématiques
    jsonStr = jsonStr.replace(
      /"graphicConfig":\s*(\{[^}]*)(,)(\s*"[^"]+":)/g,
      (match, config, comma, nextProp) => {
        // Si la config JSON n'est pas fermée proprement, la fermer
        if (!config.endsWith("}")) {
          return `"graphicConfig": ${config}}${comma}${nextProp}`;
        }
        return match;
      },
    );

    return jsonStr;
  }

  /**
   * Récupération d'urgence des questions depuis un JSON cassé
   */
  private static recoverQuestionsArrayFromContent(content: string): any[] {
    try {
      // Tentative 1 : Extraire l'array principal avec nettoyage renforcé
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        let extractedArray = arrayMatch[0];
        extractedArray = this.cleanArrayJSONString(extractedArray);
        console.log("🔧 Tentative extraction array avec nettoyage renforcé...");

        const recovered = JSON.parse(extractedArray);
        if (Array.isArray(recovered)) {
          console.log(
            `✅ [RECOVERY-1] ${recovered.length} questions récupérées`,
          );
          return recovered;
        }
      }
    } catch (recoveryError) {
      console.log("❌ Échec récupération renforcée:", recoveryError);
    }

    try {
      // Tentative 2 : Parser question par question individuellement
      console.log("🔧 Tentative récupération question par question...");
      const questions: any[] = [];

      // Chercher toutes les questions individuelles avec regex
      const questionMatches = [
        ...content.matchAll(
          /\{[\s\S]*?"id":\s*"[^"]*"[\s\S]*?"question"[\s\S]*?\}/g,
        ),
      ];

      for (const match of questionMatches) {
        try {
          let questionJson = match[0];

          // Nettoyer cette question spécifique
          questionJson = this.cleanJSONString(questionJson);

          // Essayer de parser
          const questionObj = JSON.parse(questionJson);

          // Validation minimale
          if (questionObj.id && questionObj.question && questionObj.type) {
            // Compléter les champs manquants
            if (!questionObj.options) {
              questionObj.options = [
                { id: "A", text: "Option A récupérée", isCorrect: true },
                { id: "B", text: "Option B récupérée", isCorrect: false },
                { id: "C", text: "Option C récupérée", isCorrect: false },
                { id: "D", text: "Option D récupérée", isCorrect: false },
              ];
            }
            if (!questionObj.points) questionObj.points = 3;
            if (!questionObj.difficulty) questionObj.difficulty = "moyen";

            questions.push(questionObj);
          }
        } catch (questionError) {
          console.log(
            `❌ Erreur parsing question individuelle:`,
            questionError,
          );
        }
      }

      if (questions.length > 0) {
        console.log(
          `✅ [RECOVERY-2] ${questions.length} questions récupérées individuellement`,
        );
        return questions;
      }
    } catch (individualError) {
      console.log("❌ Échec récupération individuelle:", individualError);
    }

    // Fallback final : déclencher l'erreur pour activer le fallback général
    throw new Error(`Impossible de récupérer les questions du JSON cassé`);
  }

  /**
   * Génère des questions de fallback en cas d'erreur
   */
  private static generateFallbackQuestions(
    graphics: GeneratedGraphic[],
    totalQuestions: number,
  ): Question[] {
    console.log(
      `🔄 [FALLBACK] Génération de ${totalQuestions} questions de fallback`,
    );

    const questions: Question[] = [];
    const questionsPerGraphic = Math.ceil(totalQuestions / graphics.length);

    for (let i = 0; i < totalQuestions; i++) {
      const graphicIndex =
        Math.floor(i / questionsPerGraphic) % graphics.length;
      const graphic = graphics[graphicIndex];

      questions.push(this.createFallbackQuestion(graphic, i + 1));
    }

    return questions.slice(0, totalQuestions); // S'assurer qu'on a exactement le bon nombre
  }

  /**
   * Crée une question de fallback en cas d'erreur
   */
  private static createFallbackQuestion(
    graphic: GeneratedGraphic,
    questionNumber: number,
  ): Question {
    return {
      id: `fallback_${graphic.id}_${questionNumber}`,
      question: `Analysez le graphique ${graphic.type} représentant ${graphic.topic} en ${graphic.subject}. Quelle conclusion pouvez-vous tirer ?`,
      type: QuestionType.MULTIPLE_CHOICE,
      difficulty: "moyen",
      options: [
        {
          id: "A",
          text: "Les données montrent une tendance croissante",
          isCorrect: true,
        },
        {
          id: "B",
          text: "Les données montrent une tendance décroissante",
          isCorrect: false,
        },
        { id: "C", text: "Les données sont constantes", isCorrect: false },
        { id: "D", text: "Les données sont variables", isCorrect: false },
      ],
      points: 3,
      hasGraphic: true,
      graphicId: graphic.id,
      graphicLibrary: graphic.library,
      graphicType: graphic.type,
      graphicDescription: graphic.description,
      graphicConfig: graphic.config,
      graphicDataValues: graphic.dataValues,
    };
  }

  /**
   * Obtient la configuration graphique pour une matière
   */
  private static getGraphicConfigForSubject(subject: string): any {
    // Normaliser le nom de la matière
    const normalizedSubject = this.normalizeSubjectName(subject);
    return SUBJECT_GRAPHIC_MAPPING[normalizedSubject] || null;
  }

  /**
   * Normalise le nom de la matière
   */
  private static normalizeSubjectName(subject: string): string {
    const mappings: { [key: string]: string } = {
      "physique-chimie": "Physique-Chimie",
      mathématiques: "Mathématiques",
      "mathématiques (spécialité)": "Mathématiques",
      physique: "Physique",
      "physique-chimie (spécialité)": "Physique-Chimie",
      chimie: "Chimie",
      svt: "SVT",
      "svt (spécialité)": "SVT",
      "sciences de la vie et de la terre": "SVT",
    };

    const normalized = subject.toLowerCase();
    return mappings[normalized] || subject;
  }
}
