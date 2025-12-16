// assistant/service.ts - Service principal OpenAI Assistant pour les quiz
import OpenAI from "openai";
import {
  createThread as createAssistantThread,
  addMessageToThread,
  runAssistantOnThread,
  waitForRunCompletion,
} from "./thread.js";
import { ASSISTANT_ID, ASSISTANT_ID_DOCUMENTS } from "./index.js";
import { assistantFileManager } from "./fileManager.js";
import {
  STATIC_BASE_INSTRUCTIONS,
  STATIC_DOCUMENT_INSTRUCTIONS,
  STATIC_GRAPHICS_INSTRUCTIONS,
  STATIC_CORRECTION_INSTRUCTIONS,
  buildCachedPrompt,
  buildFullCachedPrompt,
  buildDynamicQuizContent,
  buildDynamicCorrectionContent,
} from "./promptCache.js";
import { getProfessorCorrectionPrompt } from "./professorPersonas.js";
import { AIService } from "../../ai/base.js";
import {
  getPersonalizationContextForUser,
  generateAttentesInstructions,
  type PersonalizationContext,
} from "../utils/personalizationUtils.js";

const SPECIALTY_LABELS: Record<string, string> = {
  MATHEMATIQUES: "Mathématiques",
  PHYSIQUE_CHIMIE: "Physique-Chimie",
  SVT: "Sciences de la Vie et de la Terre",
  HISTOIRE_GEO: "Histoire-Géographie",
  SES: "Sciences Économiques et Sociales",
  LANGUES: "Langues Vivantes",
  LITTERATURE: "Littérature",
  ARTS: "Arts",
  NSI: "Numérique et Sciences Informatiques",
  SI: "Sciences de l'Ingénieur",
  PHILOSOPHIE: "Philosophie",
  EPS: "Éducation Physique et Sportive",
  LANGUES_CULTURES_ANTIQUITE: "Langues et Cultures de l'Antiquité",
  BIOLOGIE_ECOLOGIE: "Biologie-Écologie",
  SCIENCES_INGENIEUR: "Sciences de l'Ingénieur",
  ARTS_PLASTIQUES: "Arts Plastiques",
  MUSIQUE: "Musique",
  THEATRE: "Théâtre",
  CINEMA_AUDIOVISUEL: "Cinéma-Audiovisuel",
  DANSE: "Danse",
  HISTOIRE_ARTS: "Histoire des Arts",
};

const formatSpecialtyLabel = (specialty?: string): string | undefined => {
  if (!specialty) {
    return undefined;
  }

  return SPECIALTY_LABELS[specialty] || specialty.replace(/_/g, " ");
};

// 🆕 Schéma JSON strict pour les questions
const QUIZ_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Identifiant unique de la question (format: q_timestamp_index)",
          },
          question: {
            type: "string",
            description:
              "Énoncé de la question en français, adapté au niveau éducatif",
          },
          type: {
            type: "string",
            enum: [
              "MULTIPLE_CHOICE",
              "TRUE_FALSE",
              "OPEN_QUESTION",
              "MATCHING",
            ],
            description: "Type de question selon les standards français",
          },
          difficulty: {
            type: "string",
            enum: ["facile", "moyen", "difficile"],
            description: "Niveau de difficulté adapté au public cible",
          },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Identifiant de l'option (A, B, C, D)",
                },
                text: {
                  type: "string",
                  description: "Texte de l'option de réponse",
                },
                isCorrect: {
                  type: "boolean",
                  description: "Indique si cette option est la bonne réponse",
                },
              },
              required: ["id", "text", "isCorrect"],
              additionalProperties: false,
            },
            description:
              "Options de réponse (obligatoire pour MULTIPLE_CHOICE et TRUE_FALSE, array vide pour OPEN_QUESTION et MATCHING)",
          },
          leftColumn: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description:
                    "Identifiant de l'élément de gauche (1, 2, 3, 4...)",
                },
                text: {
                  type: "string",
                  description: "Texte de l'élément à associer",
                },
              },
              required: ["id", "text"],
              additionalProperties: false,
            },
            description:
              "Colonne de gauche pour MATCHING (éléments à associer) - obligatoire pour MATCHING, vide pour autres types",
          },
          rightColumn: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description:
                    "Identifiant de l'élément de droite (A, B, C, D...)",
                },
                text: {
                  type: "string",
                  description: "Texte de la définition/réponse",
                },
              },
              required: ["id", "text"],
              additionalProperties: false,
            },
            description:
              "Colonne de droite pour MATCHING (définitions/réponses) - obligatoire pour MATCHING, vide pour autres types",
          },
          correctMatches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                leftId: {
                  type: "string",
                  description: "ID de l'élément de gauche",
                },
                rightId: {
                  type: "string",
                  description: "ID de l'élément de droite correspondant",
                },
              },
              required: ["leftId", "rightId"],
              additionalProperties: false,
            },
            description:
              "Paires correctes pour MATCHING - obligatoire pour MATCHING, vide pour autres types",
          },
          expectedAnswer: {
            type: "string",
            description:
              "Pour OPEN_QUESTION : réponse modèle attendue rédigée par l'IA basée sur les documents sources",
          },
          explanation: {
            type: "string",
            description: "Explication détaillée de la réponse correcte",
          },
          points: {
            type: "integer",
            description:
              "Points attribués à cette question (toujours 1 pour quiz personnalisés)",
            minimum: 1,
            maximum: 1,
          },
          subject: {
            type: "string",
            description: "Matière ou sujet de la question",
          },
          schoolLevel: {
            type: "string",
            description: "Niveau scolaire cible",
          },
          hasGraphic: {
            type: "boolean",
            description: "Indique si la question est basée sur un graphique",
          },
          graphicId: {
            type: "string",
            description: "ID du graphique associé (si hasGraphic = true)",
          },
          graphicLibrary: {
            type: "string",
            enum: ["apexcharts", "plotly"],
            description: "Bibliothèque du graphique associé",
          },
          graphicType: {
            type: "string",
            enum: ["2d", "3d"],
            description: "Type du graphique associé",
          },
          basedOnDocument: {
            type: "boolean",
            description:
              "Indique si la question est basée sur un document Wikipedia",
          },
          documentReference: {
            type: "string",
            description:
              "Référence au document Wikipedia utilisé (si basedOnDocument = true)",
          },
        },
        required: [
          "id",
          "question",
          "type",
          "difficulty",
          "options",
          "leftColumn",
          "rightColumn",
          "correctMatches",
          "expectedAnswer",
          "explanation",
          "points",
          "subject",
          "schoolLevel",
          "hasGraphic",
          "graphicId",
          "graphicLibrary",
          "graphicType",
          "basedOnDocument",
          "documentReference",
        ],
        additionalProperties: false,
      },
      description: "Array de questions éducatives structurées",
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

// 🆕 Schémas JSON strict pour la correction
const QUIZ_CORRECTION_STANDARD_SCHEMA = {
  type: "object",
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionId: {
            type: "string",
            description: "ID de la question corrigée",
          },
          isCorrect: {
            type: "boolean",
            description: "Indique si la réponse est correcte",
          },
          pointsObtained: {
            type: "number",
            description:
              "Points obtenus pour cette question (peut être partiel)",
          },
          pointsTotal: {
            type: "number",
            description: "Points maximum pour cette question",
          },
          correctAnswer: {
            type: "string",
            description: "La bonne réponse attendue",
          },
          explanation: {
            type: "string",
            description: "Explication détaillée de la correction en français",
          },
          feedback: {
            type: "string",
            description: "Conseil pédagogique personnalisé pour l'amélioration",
          },
        },
        required: [
          "questionId",
          "isCorrect",
          "pointsObtained",
          "pointsTotal",
          "correctAnswer",
          "explanation",
          "feedback",
        ],
        additionalProperties: false,
      },
    },
    globalScore: {
      type: "object",
      properties: {
        pointsObtained: {
          type: "number",
          description: "Total des points obtenus",
        },
        pointsTotal: {
          type: "number",
          description: "Total des points possibles",
        },
        percentage: {
          type: "number",
          description: "Pourcentage de réussite",
        },
        grade: {
          type: "string",
          description:
            "Appréciation globale française (Très bien, Bien, Assez bien, etc.)",
        },
      },
      required: ["pointsObtained", "pointsTotal", "percentage", "grade"],
      additionalProperties: false,
    },
    recommendations: {
      type: "array",
      items: {
        type: "string",
      },
      description: "Recommandations personnalisées pour l'amélioration",
    },
  },
  required: ["corrections", "globalScore", "recommendations"],
  additionalProperties: false,
};

const QUIZ_CORRECTION_COMPLETE_SCHEMA = {
  type: "object",
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionId: {
            type: "string",
            description: "ID de la question corrigée",
          },
          isCorrect: {
            type: "boolean",
            description: "Indique si la réponse est correcte",
          },
          pointsObtained: {
            type: "number",
            description: "Points obtenus pour cette question",
          },
          pointsTotal: {
            type: "number",
            description: "Points maximum pour cette question",
          },
          correctAnswer: {
            type: "string",
            description: "La bonne réponse intégrant graphique ET document",
          },
          sourceType: {
            type: "string",
            enum: ["graphic", "document", "mixed", "knowledge"],
            description: "Type de source principal pour la réponse",
          },
          graphicAnalysis: {
            type: "string",
            description: "Analyse du graphique (si applicable)",
          },
          documentReference: {
            type: "string",
            description: "Référence au document (si applicable)",
          },
          crossAnalysis: {
            type: "string",
            description: "Analyse croisée graphique + document (si applicable)",
          },
          explanation: {
            type: "string",
            description: "Explication complète intégrant toutes les sources",
          },
          multimediaFeedback: {
            type: "string",
            description: "Conseils pour améliorer l'analyse multimédia",
          },
        },
        required: [
          "questionId",
          "isCorrect",
          "pointsObtained",
          "pointsTotal",
          "correctAnswer",
          "sourceType",
          "graphicAnalysis",
          "documentReference",
          "crossAnalysis",
          "explanation",
          "multimediaFeedback",
        ],
        additionalProperties: false,
      },
    },
    globalCompetencies: {
      type: "object",
      properties: {
        visualAnalysis: {
          type: "number",
          description: "Compétence d'analyse visuelle (graphiques) (0-10)",
        },
        textualAnalysis: {
          type: "number",
          description: "Compétence d'analyse textuelle (documents) (0-10)",
        },
        dataIntegration: {
          type: "number",
          description: "Capacité d'intégration multi-sources (0-10)",
        },
        scientificReasoning: {
          type: "number",
          description: "Raisonnement scientifique global (0-10)",
        },
        criticalThinking: {
          type: "number",
          description: "Esprit critique et analyse (0-10)",
        },
      },
      required: [
        "visualAnalysis",
        "textualAnalysis",
        "dataIntegration",
        "scientificReasoning",
        "criticalThinking",
      ],
      additionalProperties: false,
    },
    globalScore: {
      type: "object",
      properties: {
        pointsObtained: {
          type: "number",
        },
        pointsTotal: {
          type: "number",
        },
        percentage: {
          type: "number",
        },
        grade: {
          type: "string",
        },
      },
      required: ["pointsObtained", "pointsTotal", "percentage", "grade"],
      additionalProperties: false,
    },
    learningPath: {
      type: "array",
      items: {
        type: "object",
        properties: {
          competency: {
            type: "string",
            description: "Compétence à améliorer",
          },
          recommendation: {
            type: "string",
            description: "Recommandation d'apprentissage personnalisée",
          },
          resources: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Ressources pédagogiques suggérées",
          },
        },
        required: ["competency", "recommendation", "resources"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "corrections",
    "globalCompetencies",
    "globalScore",
    "learningPath",
  ],
  additionalProperties: false,
};

/**
 * Service principal pour interagir avec l'Assistant OpenAI Quiz
 */
export class OpenAIAssistantService {
  private assistantId: string;
  private openai: OpenAI;

  constructor(assistantId?: string) {
    this.assistantId = assistantId || ASSISTANT_ID;
    if (!this.assistantId) {
      throw new Error(
        "ASSISTANT_ID non défini dans les variables d'environnement",
      );
    }

    // 🆕 Initialiser le client OpenAI pour les chat completions
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * 🆕 Génère une seule question pour le streaming avec chat completion + JSON strict
   */
  async generateSingleQuestion(request: any): Promise<any> {
    try {
      const generationModel = AIService.getQuizGenerationModel();
      console.log(
        `🚀 [STREAMING] Génération via Chat Completion + JSON strict (${generationModel})`,
      );
      console.log(
        `🧠 [STREAMING-DEBUG] ragContext dans request: ${request.ragContext ? `${request.ragContext.length} caractères` : "VIDE ou undefined"}`,
      );

      // 🎯 Récupérer la personnalisation utilisateur si userId fourni
      let personalization: PersonalizationContext | undefined;
      if (request.userId) {
        try {
          personalization = await getPersonalizationContextForUser(
            request.userId,
          );
          if (personalization?.hasPersonalization) {
            console.log(
              `👤 [PERSONALIZATION] Contexte utilisateur chargé: ${personalization.classe || "N/A"}, ${personalization.domaine || "N/A"}`,
            );
          }
        } catch (error) {
          console.warn(
            "⚠️ [PERSONALIZATION] Impossible de charger la personnalisation:",
            error,
          );
        }
      }

      // Construire les messages pour chat completion avec personnalisation
      const systemPrompt = this.buildSystemPrompt(personalization);
      const userPrompt = this.buildSingleQuestionPrompt(
        request,
        personalization,
      );

      console.log(`📤 [STREAMING] Envoi à ${generationModel} avec JSON strict`);

      // Configuration de base pour l'appel API
      const apiConfig: any = {
        model: generationModel,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "quiz_question_generation",
            strict: true,
            schema: QUIZ_QUESTION_SCHEMA,
          },
        },
      };

      // 🆕 Configuration spécifique GPT-5
      if (generationModel.includes("gpt-5")) {
        apiConfig.reasoning_effort = "low";
        apiConfig.max_completion_tokens = 2000;
        // GPT-5 n'accepte que temperature=1 (défaut), on ne le spécifie pas
        console.log(
          "🧠 [STREAMING] GPT-5-mini détecté : reasoning_effort=low, max_completion_tokens=2000, temperature=1 (défaut)",
        );
      } else {
        apiConfig.temperature = 0.7;
        apiConfig.max_tokens = 2000;
      }

      // Appel chat completion avec JSON strict
      const completion = await this.openai.chat.completions.create(apiConfig);

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error("Aucune réponse du modèle");
      }

      // Parser la réponse JSON
      const result = JSON.parse(responseContent);

      if (
        result &&
        result.questions &&
        Array.isArray(result.questions) &&
        result.questions.length > 0
      ) {
        console.log(
          "✅ [STREAMING] Question générée avec succès via chat completion",
        );
        return result;
      }

      console.error(
        "❌ [STREAMING] Réponse inattendue du chat completion:",
        result,
      );
      throw new Error("Aucune question valide générée");
    } catch (error) {
      console.error("❌ [STREAMING] Erreur génération question:", error);
      throw error;
    }
  }

  /**
   * 🆕 Construit le prompt système pour les chat completions
   * @param personalization - Contexte de personnalisation utilisateur (optionnel)
   */
  private buildSystemPrompt(personalization?: PersonalizationContext): string {
    let basePrompt = `Tu es un expert en création de quiz éducatifs français (Brevet, BAC, Partiels).

MISSION : Générer des questions de quiz de haute qualité, adaptées au système éducatif français.

RÈGLES ABSOLUES :
- TOUJOURS générer EXACTEMENT 1 question par demande
- Respecter scrupuleusement le format JSON fourni
- Adapter le niveau de difficulté au public cible
- Utiliser un français impeccable et académique
- Créer des questions originales et pertinentes

TYPES DE QUESTIONS SUPPORTÉS :
- MULTIPLE_CHOICE : QCM avec 4 options (A, B, C, D)
- TRUE_FALSE : Vrai/Faux avec 2 options
- OPEN_QUESTION : Question ouverte avec réponse attendue
- MATCHING : Association d'éléments

QUALITÉ REQUISE :
- Questions claires et sans ambiguïté
- Options de réponse plausibles pour les QCM
- Explications détaillées pour la correction
- Adaptation parfaite au niveau scolaire demandé`;

    // 🎯 Intégration de la personnalisation utilisateur
    if (personalization?.hasPersonalization && personalization.promptSection) {
      basePrompt += `\n\n${personalization.promptSection}`;

      // Ajouter les instructions basées sur les attentes
      if (personalization.attentes) {
        const attentesInstructions = generateAttentesInstructions(
          personalization.attentes,
        );
        if (attentesInstructions) {
          basePrompt += attentesInstructions;
        }
      }
    }

    basePrompt += `\n\nTu DOIS impérativement retourner une réponse au format JSON strict fourni.`;

    return basePrompt;
  }

  /**
   * 🆕 Construit le prompt utilisateur pour générer une seule question (optimisé chat completion)
   * @param personalization - Contexte de personnalisation utilisateur (optionnel)
   */
  private buildSingleQuestionPrompt(
    request: any,
    personalization?: PersonalizationContext,
  ): string {
    const {
      schoolLevel,
      questionTypes,
      specificSubject,
      existingQuestions = [],
      lyceeSpecialties = [],
      focusSpecialty,
      focusSpecialtyLabel,
      higherEdField,
      ragContext,
      coursesOnly = false,
      difficulty = "moyen",
    } = request;

    // 🧠 Debug: Vérifier toutes les propriétés
    console.log(`🔍 [CHAT-COMPLETION-DEBUG] Propriétés reçues:`);
    console.log(
      `  - ragContext: ${ragContext ? `${ragContext.length} chars` : "undefined/null"}`,
    );
    console.log(`  - coursesOnly: ${coursesOnly}`);
    console.log(`  - specificSubject: ${specificSubject}`);
    console.log(`  - questionType: ${questionTypes[0]}`);
    console.log(
      `  - personalization: ${personalization?.hasPersonalization ? "OUI" : "NON"}`,
    );

    // Générer un ID unique pour la question
    const questionId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 🎯 Utiliser le niveau personnalisé si disponible, sinon fallback sur schoolLevel
    const effectiveLevel =
      personalization?.classe && personalization.hasPersonalization
        ? personalization.classe
        : schoolLevel;

    // 🎯 Utiliser le domaine personnalisé si disponible et pertinent
    const effectiveSubject =
      personalization?.domaine &&
      personalization.hasPersonalization &&
      !specificSubject
        ? personalization.domaine
        : specificSubject || "Général";

    let prompt = `GÉNÈRE UNE QUESTION DE QUIZ

PARAMÈTRES :
- Niveau scolaire : ${effectiveLevel}
- Type de question : ${questionTypes[0] || "MULTIPLE_CHOICE"}
- Sujet : ${effectiveSubject}
- Difficulté : ${difficulty}
- ID question : ${questionId}

⚠️ IMPORTANT SYSTÈME DE POINTS :
- Chaque question DOIT valoir exactement 1 point (points = 1)
- Le système convertira automatiquement le score final sur 20
- NE PAS varier les points selon la difficulté`;

    // 🎯 Ajouter le contexte de personnalisation dans le prompt utilisateur
    if (personalization?.hasPersonalization) {
      prompt += `\n\n👤 CONTEXTE ÉTUDIANT :`;
      if (personalization.classe) {
        prompt += `\n- Niveau de l'étudiant : ${personalization.classe}`;
      }
      if (personalization.domaine) {
        prompt += `\n- Domaine d'étude : ${personalization.domaine}`;
      }
      if (personalization.filiere) {
        prompt += `\n- Filière : ${personalization.filiere}`;
      }
      if (personalization.presentation) {
        prompt += `\n- Profil : ${personalization.presentation}`;
      }
      prompt += `\n⚠️ Adapte le vocabulaire, la complexité et les exemples à ce profil.`;
    }

    if (lyceeSpecialties.length > 0) {
      const formattedSpecialties = lyceeSpecialties.map(
        (specialty: string) => formatSpecialtyLabel(specialty) || specialty,
      );
      prompt += `\n- Spécialités Lycée : ${formattedSpecialties.join(", ")}`;
    }

    if (focusSpecialtyLabel) {
      prompt += `\n- Spécialité ciblée pour cette question : ${focusSpecialtyLabel}`;
    } else if (focusSpecialty) {
      prompt += `\n- Spécialité ciblée pour cette question : ${formatSpecialtyLabel(String(focusSpecialty)) || String(focusSpecialty).replace(/_/g, " ")}`;
    }

    if (higherEdField) {
      prompt += `\n- Filière études supérieures : ${higherEdField}`;
    }

    // Intégration du contexte RAG
    if (ragContext && ragContext.trim().length > 0) {
      console.log(
        `🧠 [CHAT-COMPLETION] Contexte RAG reçu: ${ragContext.length} caractères, coursesOnly: ${coursesOnly}`,
      );
      if (coursesOnly) {
        prompt += `\n\n🎯 CONTENU OBLIGATOIRE À UTILISER :
Tu DOIS baser ta question UNIQUEMENT sur ce contenu. N'utilise PAS tes connaissances générales.

CONTENU DES PAGES SÉLECTIONNÉES :
${ragContext}

⚠️ CONTRAINTE : La question doit porter sur des éléments précis de ce contenu.`;
      } else {
        prompt += `\n\n📚 CONTENU DE RÉFÉRENCE :
Base-toi principalement sur ce contenu (70%) et enrichis avec tes connaissances (30%) :

CONTENU DES PAGES SÉLECTIONNÉES :
${ragContext}`;
      }
    }

    // Éviter les doublons
    if (existingQuestions.length > 0) {
      prompt += `\n\n🚫 QUESTIONS DÉJÀ GÉNÉRÉES (${existingQuestions.length}) - ÉVITER LES DOUBLONS :
${existingQuestions.map((q: any, i: number) => `${i + 1}. ${q.question}`).join("\n")}

⚠️ IMPORTANT : Génère une question COMPLÈTEMENT DIFFÉRENTE et ORIGINALE.`;
    }

    // Instructions spécifiques selon le type
    switch (questionTypes[0]) {
      case "MULTIPLE_CHOICE":
        prompt += `\n\n📝 INSTRUCTIONS QCM :
- Crée exactement 4 options (A, B, C, D)
- Une seule option correcte
- Options plausibles et équilibrées
- Pas d'indices dans la formulation
- leftColumn = [] (array vide)
- rightColumn = [] (array vide)
- correctMatches = [] (array vide)`;
        break;
      case "TRUE_FALSE":
        prompt += `\n\n📝 INSTRUCTIONS VRAI/FAUX :
- Crée exactement 2 options : "Vrai" et "Faux"
- Affirmation claire et précise
- Évite les formulations ambiguës
- leftColumn = [] (array vide)
- rightColumn = [] (array vide)
- correctMatches = [] (array vide)`;
        break;
      case "OPEN_QUESTION":
        prompt += `\n\n📝 INSTRUCTIONS QUESTION OUVERTE :
- Question nécessitant une réponse développée
- Fournis une réponse modèle détaillée
- options = [] (array vide)
- leftColumn = [] (array vide)
- rightColumn = [] (array vide)
- correctMatches = [] (array vide)`;
        break;
      case "MATCHING":
        prompt += `\n\n📝 INSTRUCTIONS MATCHING :
- Question d'association d'éléments (terme → définition)
- Minimum 4 paires à associer
- options = [] (array vide - OBLIGATOIRE)
- leftColumn = array de 4+ éléments avec id (1, 2, 3, 4...) et text (ex: termes, concepts)
- rightColumn = array de 4+ éléments avec id (A, B, C, D...) et text (ex: définitions)
- correctMatches = array des paires correctes (ex: [{leftId: "1", rightId: "A"}, ...])
- expectedAnswer = format "1-A, 2-B, 3-C, 4-D" pour référence

EXEMPLE DE STRUCTURE MATCHING:
{
  "leftColumn": [
    {"id": "1", "text": "Photosynthèse"},
    {"id": "2", "text": "Respiration"},
    {"id": "3", "text": "Transpiration"},
    {"id": "4", "text": "Germination"}
  ],
  "rightColumn": [
    {"id": "A", "text": "Processus de croissance d'une graine"},
    {"id": "B", "text": "Production d'énergie par les cellules"},
    {"id": "C", "text": "Évaporation d'eau par les feuilles"},
    {"id": "D", "text": "Synthèse de glucose à partir de lumière"}
  ],
  "correctMatches": [
    {"leftId": "1", "rightId": "D"},
    {"leftId": "2", "rightId": "B"},
    {"leftId": "3", "rightId": "C"},
    {"leftId": "4", "rightId": "A"}
  ]
}`;
        break;
    }

    prompt += `\n\n🎯 GÉNÈRE MAINTENANT :
Une question de qualité respectant exactement le format JSON strict requis.

Assure-toi que tous les champs obligatoires sont remplis avec des valeurs appropriées.`;

    return prompt;
  }

  /**
   * Génère un quiz personnalisé via l'assistant
   */
  async generateQuiz(options: {
    preset: "BREVET" | "BAC" | "PARTIELS";
    subject: string;
    numQuestions: number;
    difficulty?: "facile" | "moyen" | "difficile";
    includeGraphics?: boolean;
    includeDocuments?: boolean;
    questionTypes?: string[];
    documentTopics?: string[];
  }): Promise<any> {
    console.log(
      "🚀 Assistant Principal (system prompt supprimé) avec Prompt Caching 2024",
    );
    const threadId = await createAssistantThread();

    // Contenu dynamique (paramètres variables)
    const dynamicContent = buildDynamicQuizContent({
      level:
        options.preset === "BREVET"
          ? "COLLEGE"
          : options.preset === "BAC"
            ? "LYCEE"
            : "SUPERIEUR",
      preset: options.preset,
      subject: options.subject,
      questionCount: options.numQuestions,
      questionTypes: options.questionTypes || ["QCM"],
      difficulty: options.difficulty,
      includeDocuments: options.includeDocuments,
      includeGraphics: options.includeGraphics,
      documentTopics: options.documentTopics,
    });

    // Construction du prompt COMPLET (system + user) optimisé pour le cache
    const optimizedPrompt = buildFullCachedPrompt("PRINCIPAL", dynamicContent, {
      includeDocuments: options.includeDocuments,
      includeGraphics: options.includeGraphics,
      includeCorrection: false,
    });

    console.log(
      `📊 Assistant Principal Caching - Prompt: ${Math.round(optimizedPrompt.length / 1024)}KB`,
    );

    await addMessageToThread(threadId, optimizedPrompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Génère un quiz basé sur un preset prédéfini
   */
  async generatePresetQuiz(
    preset: "BREVET" | "BAC" | "PARTIELS",
    subject?: string,
    questionCount: number = 10,
  ): Promise<any> {
    console.log("🚀 Preset Quiz avec Prompt Caching OpenAI 2024");
    const threadId = await createAssistantThread();

    // PROMPT CACHING: Instructions complètes pour preset (documents + graphiques)
    const staticInstructions =
      STATIC_BASE_INSTRUCTIONS +
      "\n\n" +
      STATIC_DOCUMENT_INSTRUCTIONS +
      "\n\n" +
      STATIC_GRAPHICS_INSTRUCTIONS;

    // Paramètres dynamiques pour preset
    const dynamicContent = buildDynamicQuizContent({
      level:
        preset === "BREVET"
          ? "COLLEGE"
          : preset === "BAC"
            ? "LYCEE"
            : "SUPERIEUR",
      preset: preset,
      subject: subject || `Sujet général ${preset}`,
      questionCount: questionCount,
      questionTypes: ["QCM", "VRAI_FAUX"],
      includeDocuments: true, // Presets utilisent toujours des documents
      includeGraphics: preset === "BAC", // Graphiques pour BAC uniquement
      specificSubject: subject,
    });

    const optimizedPrompt = buildCachedPrompt(
      staticInstructions,
      dynamicContent,
    );
    console.log(
      `📊 Preset Caching - Taille: ${Math.round(optimizedPrompt.length / 1024)}KB`,
    );

    await addMessageToThread(threadId, optimizedPrompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  // ===== MÉTHODES DE CORRECTION SPÉCIALISÉES =====

  /**
   * Corrige un quiz standard avec barème français officiel
   */
  async correctStandardQuiz(
    quizId: string,
    answers: Array<{ questionId: string; answer: string; timeSpent?: number }>,
    questions?: Array<{
      id: string;
      question: string;
      options: Array<{ id: string; text: string }>;
      correctAnswerId: string;
    }>,
    options: {
      includeRecommendations?: boolean;
      personalizedFeedback?: boolean;
    } = {},
  ): Promise<any> {
    console.log(
      "🚀 Correction optimisée (system prompt supprimé) avec Prompt Caching 2024",
    );
    const threadId = await createAssistantThread();

    // Contenu dynamique pour la correction
    const dynamicContent = buildDynamicCorrectionContent({
      quizId,
      answers,
      questions,
      personalizedFeedback: options.personalizedFeedback,
      includeRecommendations: options.includeRecommendations,
    });

    // Prompt complet pour correction
    const optimizedPrompt = buildFullCachedPrompt("PRINCIPAL", dynamicContent, {
      includeDocuments: false,
      includeGraphics: false,
      includeCorrection: true,
    });

    console.log(
      `📊 Correction Caching - Prompt: ${Math.round(optimizedPrompt.length / 1024)}KB`,
    );

    await addMessageToThread(threadId, optimizedPrompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Corrige un quiz avec graphiques en ayant accès aux configurations sources
   */
  async correctGraphicsQuiz(
    quizId: string,
    answers: Array<{ questionId: string; answer: string; timeSpent?: number }>,
    graphicsData: Array<{
      graphicId: string;
      config: any;
      library: "apexcharts" | "plotly";
      dataValues: number[];
      // 🆕 PROPRIÉTÉS ADDITIONNELLES ENRICHIES:
      type?: string; // Type de graphique (2d/3d)
      description?: string; // Description textuelle pour l'IA
      htmlContainer?: string; // Container HTML
      questionText?: string; // Texte de la question associée
      questionId?: string; // ID de la question pour référence
    }>,
    options: {
      analyzeVisualSkills?: boolean;
      includeTrendAnalysis?: boolean;
    } = {},
  ): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Corrige ce quiz avec graphiques en utilisant correct_quiz_with_graphics.

Données du quiz:
- ID: ${quizId}
- Réponses: ${JSON.stringify(answers)}

Données graphiques sources:
${JSON.stringify(graphicsData, null, 2)}

Options d'analyse:
- Compétences visuelles: ${options.analyzeVisualSkills ? "Oui" : "Non"}
- Analyse des tendances: ${options.includeTrendAnalysis ? "Oui" : "Non"}

Évalue les compétences de lecture graphique et d'analyse des données.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Corrige un quiz documentaire avec accès aux documents Wikipedia sources
   */
  async correctDocumentaryQuiz(
    quizId: string,
    answers: Array<{ questionId: string; answer: string; timeSpent?: number }>,
    documentsData: Array<{
      documentId: string;
      title: string;
      content: string;
      topic: string;
      relevantPassages: string[];
    }>,
    options: {
      analyzeComprehension?: boolean;
      includeTextualEvidence?: boolean;
    } = {},
  ): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Corrige ce quiz documentaire en utilisant correct_quiz_with_documents.

Données du quiz:
- ID: ${quizId}
- Réponses: ${JSON.stringify(answers)}

Documents Wikipedia sources:
${JSON.stringify(documentsData, null, 2)}

Options d'analyse:
- Compréhension textuelle: ${options.analyzeComprehension ? "Oui" : "Non"}
- Preuves textuelles: ${options.includeTextualEvidence ? "Oui" : "Non"}

Évalue les compétences d'analyse documentaire et de synthèse.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * 🆕 NOUVELLE MÉTHODE - Corrige un quiz documentaire avec fichiers complets
   * Utilise les fichiers uploadés pour une correction précise avec documents intégraux
   */
  async correctDocumentaryQuizWithFiles(
    quizId: string,
    answers: Array<{ questionId: string; answer: string; timeSpent?: number }>,
    documentsData: Array<{ reference: string; questionId: string }>, // Données des questions documentaires
    questions: Array<{
      id: string;
      type: string;
      question: string;
      options?: any[];
    }>, // NOUVEAU: Questions complètes avec types
    options: {
      analyzeComprehension?: boolean;
      includeTextualEvidence?: boolean;
    } = {},
  ): Promise<any> {
    try {
      const uniqueFileIds = [...new Set(documentsData.map((d) => d.reference))];
      console.log(
        `📝 Correction quiz documentaire avec ${uniqueFileIds.length} fichiers complets...`,
      );

      const threadId = await createAssistantThread();

      // Séparer les questions par type pour un traitement adapté
      const openQuestions = questions.filter((q) => q.type === "OPEN_QUESTION");
      const multipleChoiceQuestions = questions.filter(
        (q) => q.type === "MULTIPLE_CHOICE",
      );
      const documentaryQuestions = questions.filter((q) =>
        documentsData.some((doc) => doc.questionId === q.id),
      );

      const prompt = `Corrige ce quiz COMPLET en utilisant correct_quiz_with_documents.

🔹 DONNÉES DU QUIZ COMPLET:
- ID: ${quizId}
- TOTAL QUESTIONS: ${questions.length}
- Questions ouvertes: ${openQuestions.length}
- Questions à choix multiples: ${multipleChoiceQuestions.length}
- Questions documentaires: ${documentaryQuestions.length}

🔹 QUESTIONS DÉTAILLÉES:
${questions
  .map((q) => {
    const userAnswer = answers.find((a) => a.questionId === q.id);
    const docData = documentsData.find((doc) => doc.questionId === q.id);
    return `
Question ${q.id} (Type: ${q.type}):
Question: ${q.question}
${q.options ? `Options: ${q.options.map((opt) => `${opt.id}. ${opt.text}`).join(", ")}` : ""}
Réponse utilisateur: "${userAnswer?.answer || "Pas de réponse"}"
${docData ? `Document de référence: ${docData.reference}` : "Aucun document"}
---`;
  })
  .join("\n")}

🔹 DOCUMENTS DISPONIBLES:
- Files IDs: ${uniqueFileIds.join(", ")}
- Vous avez accès au CONTENU COMPLET de ces documents

🔹 INSTRUCTIONS SPÉCIFIQUES PAR TYPE:

📝 QUESTIONS OUVERTES (${openQuestions.length}):
- Lisez les documents pour comprendre le contexte
- Rédigez une VRAIE réponse basée sur les documents (pas juste "A", "B", "C")
- Analysez la réponse de l'utilisateur contre le contenu des documents
- Donnez une explication détaillée de pourquoi c'est correct/incorrect

🔘 QUESTIONS À CHOIX MULTIPLES (${multipleChoiceQuestions.length}):
- Indiquez la lettre de la bonne réponse (A, B, C, D)
- Expliquez pourquoi cette option est correcte

📚 QUESTIONS DOCUMENTAIRES (${documentaryQuestions.length}):
- Utilisez OBLIGATOIREMENT les fichiers uploadés
- Citez des passages spécifiques des documents
- Fournissez des preuves textuelles

CORRECTION OBLIGATOIRE DES ${questions.length} QUESTIONS AVEC TYPES APPROPRIÉS !`;

      await addMessageToThread(threadId, prompt);

      // OPTIMISATION: Utiliser l'Assistant spécialisé pour documents (gpt-4o-mini)
      const documentAssistantId = ASSISTANT_ID_DOCUMENTS;
      console.log(
        `🚀 Utilisation de l'Assistant optimisé pour correction documents: ${documentAssistantId}`,
      );
      const runId = await runAssistantOnThread(threadId, documentAssistantId);

      // TIMEOUT RÉDUIT: gpt-4o-mini est 10x plus rapide
      const result = await waitForRunCompletion(threadId, runId, 60);

      // Ajouter les métadonnées de correction
      if (result) {
        result.fileCorrectionMetadata = {
          usedFiles: uniqueFileIds.length,
          fileIds: uniqueFileIds,
          totalQuestions: answers.length,
          documentaryQuestions: documentsData.length,
          correctionMethod: "full_documents_via_files",
          timestamp: new Date().toISOString(),
        };
      }

      console.log(
        `✅ Correction terminée avec ${uniqueFileIds.length} fichiers complets`,
      );
      return result;
    } catch (error) {
      console.error("❌ Erreur correction avec fichiers:", error);
      throw error;
    }
  }

  /**
   * Corrige un quiz complet intégrant graphiques ET documents
   */
  async correctCompleteQuiz(
    quizId: string,
    answers: Array<{ questionId: string; answer: string; timeSpent?: number }>,
    graphicsData: Array<{
      graphicId: string;
      config: any;
      library: "apexcharts" | "plotly";
      dataValues: number[];
      // 🆕 PROPRIÉTÉS ADDITIONNELLES ENRICHIES:
      type?: string; // Type de graphique (2d/3d)
      description?: string; // Description textuelle pour l'IA
      htmlContainer?: string; // Container HTML
      questionText?: string; // Texte de la question associée
      questionId?: string; // ID de la question pour référence
    }>,
    documentsData: Array<{
      documentId: string;
      title: string;
      content: string;
      topic: string;
      relevantPassages: string[];
    }>,
    options: {
      analyzeCrossReferences?: boolean;
      generateLearningPath?: boolean;
      detailedCompetencies?: boolean;
    } = {},
  ): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Corrige ce quiz complet multimédia en utilisant correct_quiz_complete.

Données du quiz:
- ID: ${quizId}
- Réponses: ${JSON.stringify(answers)}

Graphiques sources:
${JSON.stringify(graphicsData, null, 2)}

Documents Wikipedia sources:
${JSON.stringify(documentsData, null, 2)}

Options d'analyse avancée:
- Références croisées: ${options.analyzeCrossReferences ? "Oui" : "Non"}
- Parcours d'apprentissage: ${options.generateLearningPath ? "Oui" : "Non"}
- Compétences détaillées: ${options.detailedCompetencies ? "Oui" : "Non"}

Fais une analyse croisée graphiques + documents avec parcours personnalisé.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Méthode de correction générique (compatibilité)
   */
  async correctQuiz(
    quizId: string,
    answers: Array<{ question_id: string; user_answer: string }>,
    options: {
      type?: "standard" | "with_graphics" | "with_documents" | "complete";
      graphicsData?: any[];
      documentsData?: any[];
      [key: string]: any;
    } = {},
  ): Promise<any> {
    const formattedAnswers = answers.map((a) => ({
      questionId: a.question_id,
      answer: a.user_answer,
    }));

    // 🆕 Utiliser les nouvelles méthodes Chat Completion
    switch (options.type) {
      case "with_graphics":
        return this.correctCompleteQuizChatCompletion(
          quizId,
          formattedAnswers,
          {
            graphicsData: options.graphicsData || [],
            documentsData: [],
            correctionType: "graphics",
            questions: options.questions,
          },
        );
      case "with_documents":
        return this.correctCompleteQuizChatCompletion(
          quizId,
          formattedAnswers,
          {
            graphicsData: [],
            documentsData: options.documentsData || [],
            correctionType: "documents",
            questions: options.questions,
          },
        );
      case "complete":
        return this.correctCompleteQuizChatCompletion(
          quizId,
          formattedAnswers,
          {
            graphicsData: options.graphicsData || [],
            documentsData: options.documentsData || [],
            correctionType: "complete",
            questions: options.questions,
          },
        );
      default:
        return this.correctStandardQuizChatCompletion(
          quizId,
          formattedAnswers,
          {
            questions: options.questions,
          },
        );
    }
  }

  /**
   * Génère un graphique pédagogique
   */
  async generateGraphic(options: {
    chartType:
      | "line"
      | "bar"
      | "pie"
      | "scatter"
      | "area"
      | "histogram"
      | "box"
      | "heatmap";
    title: string;
    data: any;
    library: "apexcharts" | "plotly";
    educationalContext?: string;
  }): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Génère un graphique pédagogique avec les spécifications suivantes: ${JSON.stringify(options)}. Utilise la fonction generate_graphic.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Recherche et enrichit un sujet avec des documents
   */
  async enrichSubjectWithDocuments(
    subject: string,
    preset: "BREVET" | "BAC" | "PARTIELS",
    keywords?: string[],
    maxDocuments = 3,
  ): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Enrichis le sujet "${subject}" pour le niveau ${preset} avec des documents Wikipedia pertinents. Utilise generate_subject_with_documents${keywords ? ` avec les mots-clés: ${keywords.join(", ")}` : ""} et un maximum de ${maxDocuments} documents.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Méthode générique pour interagir directement avec l'assistant
   */
  async chat(message: string): Promise<any> {
    const threadId = await createAssistantThread();

    await addMessageToThread(threadId, message);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  // ===== MÉTHODES DE GÉNÉRATION SPÉCIALISÉES =====

  /**
   * Génère un quiz avec graphiques pédagogiques
   */
  async generateQuizWithGraphics(options: {
    preset: "BREVET" | "BAC" | "PARTIELS";
    subject: string;
    numQuestions: number;
    graphicType?: "2d" | "3d";
    library?: "apexcharts" | "plotly";
    difficulty?: "facile" | "moyen" | "difficile";
    questionTypes?: string[];
  }): Promise<any> {
    const threadId = await createAssistantThread();

    const questionTypesText =
      options.questionTypes && options.questionTypes.length > 0
        ? `\n🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
        : "\n📝 Types de questions : Utilise la répartition par défaut du system prompt";

    const prompt = `Génère un quiz avec graphiques pour ${options.preset} sur "${options.subject}".${questionTypesText}
    
1. D'abord utilise generate_graphic pour créer un graphique pédagogique ${options.graphicType || "2d"} avec ${options.library || "apexcharts"}
2. Puis utilise generate_questions_array pour créer ${options.numQuestions} questions basées sur ce graphique
3. Niveau de difficulté: ${options.difficulty || "moyen"}

Assure-toi que les questions exploitent bien l'analyse graphique.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    const result = await waitForRunCompletion(threadId, runId);

    // NOUVEAU: Créer subjects pour les presets si un subject existe, sinon créer un subject par défaut
    if (result) {
      if (result.subject && result.subject.questions) {
        result.subjects = [result.subject];
        result.subjectBased = true;
        console.log(
          "✅ Subject transformé en subjects pour mode preset (graphics):",
          {
            subjectTitle: result.subject.title,
            questionsCount: result.subject.questions.length,
          },
        );
      } else if (result.questions && result.questions.length > 0) {
        // Créer un subject par défaut si pas de subject mais des questions
        result.subject = {
          id: "default-graphics-subject",
          title: `Quiz ${options.preset} - ${options.subject}`,
          questions: result.questions,
          graphics: result.graphics,
          difficulty: options.difficulty || "moyen",
        };
        result.subjects = [result.subject];
        result.subjectBased = true;
        console.log("✅ Subject par défaut créé pour quiz graphique:", {
          subjectTitle: result.subject.title,
          questionsCount: result.questions.length,
          graphicsCount: result.graphics?.length || 0,
        });
      }
    }

    return result;
  }

  /**
   * Génère un quiz avec documents Wikipedia
   */
  async generateQuizWithDocuments(options: {
    preset: "BREVET" | "BAC" | "PARTIELS";
    subject: string;
    numQuestions: number;
    documentTopics?: string[];
    difficulty?: "facile" | "moyen" | "difficile";
    questionTypes?: string[];
  }): Promise<any> {
    const threadId = await createAssistantThread();

    const topicsText = options.documentTopics
      ? ` avec les topics: ${options.documentTopics.join(", ")}`
      : "";

    const questionTypesText =
      options.questionTypes && options.questionTypes.length > 0
        ? `\n🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
        : "\n📝 Types de questions : Utilise la répartition par défaut du system prompt (60% basées sur documents, 40% connaissances générales)";

    const prompt = `Génère un quiz documentaire pour ${options.preset} sur "${options.subject}".${questionTypesText}
    
1. D'abord utilise generate_subject_with_documents pour enrichir le sujet avec des documents Wikipedia${topicsText}
2. Puis utilise generate_questions_array pour créer ${options.numQuestions} questions
3. Niveau de difficulté: ${options.difficulty || "moyen"}

Équilibre bien questions documentaires et questions de connaissances.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    const result = await waitForRunCompletion(threadId, runId);

    // Transformer documents en sourceDocuments pour la compatibilité
    if (result && result.documents && result.documents.length > 0) {
      result.sourceDocuments = result.documents;
      result.hasDocuments = true;
    }

    return result;
  }

  /**
   * 🆕 NOUVELLE MÉTHODE - Génère un quiz avec documents complets via File Upload
   * Contourne la limite des Function Calls en uploadant les documents comme fichiers
   */
  async generateQuizWithFullDocuments(options: {
    preset: "BREVET" | "BAC" | "PARTIELS";
    subject: string;
    numQuestions: number;
    documents: Array<{
      id: string;
      title: string;
      content: string;
      topic: string;
      similarity?: number;
      source?: string;
    }>;
    difficulty?: "facile" | "moyen" | "difficile";
    questionTypes?: string[];
  }): Promise<any> {
    try {
      console.log(
        `📚 Génération quiz avec ${options.documents.length} documents complets...`,
      );

      // 1. Upload des documents comme fichiers Assistant
      const fileIds = await assistantFileManager.uploadDocuments(
        options.documents,
      );

      // 2. Créer le thread Assistant
      const threadId = await createAssistantThread();

      // 3. Prompt spécialisé pour les documents uploadés
      const documentsInfo = options.documents
        .map((doc) => `- "${doc.title}" (ID: ${doc.id})`)
        .join("\n");

      const questionTypesText =
        options.questionTypes && options.questionTypes.length > 0
          ? `   - 🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n   - ⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
          : `   - 📝 Types de questions : Respecte la répartition par défaut de 80% questions ouvertes (OPEN_QUESTION) et 20% QCM (MULTIPLE_CHOICE)`;

      const prompt = `Génère un quiz documentaire COMPLET pour ${options.preset} sur "${options.subject}".

🔹 DOCUMENTS DISPONIBLES: ${fileIds.length} fichiers Wikipedia uploadés avec contenu INTEGRAL
   - ${documentsInfo}
🔹 IDs des fichiers techniques: ${fileIds.join(", ")}

SÉQUENCE OBLIGATOIRE À SUIVRE:
1. ÉTAPE 1: Utilise generate_subject_with_documents en référençant les fichiers uploadés. Dans les métadonnées, utilise les VRAIS titres des documents fournis ci-dessus.
2. ÉTAPE 2: Utilise generate_questions_array pour créer ${options.numQuestions} questions.
   - 60% des questions basées sur le contenu RÉEL des documents uploadés.
   - 40% des questions de connaissances générales du niveau ${options.preset} sur le sujet "${options.subject}".
${questionTypesText}
   - Niveau: ${options.difficulty || "moyen"}

INSTRUCTIONS CRITIQUES:
- Tu DOIS appeler les 2 fonctions dans l'ordre: generate_subject_with_documents PUIS generate_questions_array.
- Les questions documentaires doivent porter sur les documents fournis (ex: "Dans le document 'Musée d'Orsay', quel artiste est mentionné ?").
- NE PAS inventer de titres de documents. Utilise ceux que j'ai fournis.
- Respecte IMPÉRATIVEMENT la répartition 60/40 (document/connaissance) ET la répartition des types de questions.

IMPORTANT: Cette génération nécessite OBLIGATOIREMENT les 2 étapes. Ne t'arrête pas après la première fonction !`;

      await addMessageToThread(threadId, prompt);

      // CORRECTION: Utiliser l'Assistant principal pour la génération (gpt-4o)
      const assistantId = ASSISTANT_ID;
      console.log(
        `🚀 Utilisation de l'Assistant principal pour génération avec documents: ${assistantId}`,
      );
      const runId = await runAssistantOnThread(threadId, assistantId);

      // TIMEOUT ADAPTÉ: gpt-4o pour génération avec prompts détaillés
      const result = await waitForRunCompletion(threadId, runId, 120); // 120 × 10s = 20 minutes

      // 4. Ajouter les métadonnées des fichiers au résultat et les documents sources
      if (result) {
        result.fileUploadMetadata = {
          uploadedFiles: fileIds.length,
          fileIds: fileIds,
          documentsInfo: options.documents.map((doc) => ({
            title: doc.title,
            topic: doc.topic,
            contentLength: doc.content.length,
          })),
        };

        // 5. CORRECTION: Utiliser les VRAIS documents au lieu des références fictives
        // Les documents réels sont dans options.documents avec le contenu complet
        result.sourceDocuments = options.documents.map((doc) => ({
          id: doc.id,
          title: doc.title,
          content: doc.content, // Le VRAI contenu tronqué intelligemment
          topic: doc.topic,
          similarity: doc.similarity || 1.0,
          source: doc.source || "Wikipedia",
        }));
        result.hasDocuments = true;
        console.log(
          `✅ Documents réels ajoutés: ${result.sourceDocuments.length} avec contenu complet`,
        );

        // 6. CORRECTION: Créer subjects pour les presets si un subject existe
        if (result.subject && result.subject.questions) {
          result.subjects = [result.subject];
          result.subjectBased = true;
          console.log("✅ Subject transformé en subjects pour mode preset:", {
            subjectTitle: result.subject.title,
            questionsCount: result.subject.questions.length,
          });
        }
      }

      console.log(
        `✅ Quiz généré avec succès en utilisant ${fileIds.length} fichiers complets`,
      );
      return result;
    } catch (error) {
      console.error(
        "❌ Erreur génération quiz avec documents complets:",
        error,
      );
      throw error;
    }
  }

  /**
   * Génère un quiz complet avec graphiques ET documents
   */
  async generateCompleteQuiz(options: {
    preset: "BREVET" | "BAC" | "PARTIELS";
    subject: string;
    numQuestions: number;
    graphicType?: "2d" | "3d";
    library?: "apexcharts" | "plotly";
    documentTopics?: string[];
    difficulty?: "facile" | "moyen" | "difficile";
    questionTypes?: string[];
  }): Promise<any> {
    const threadId = await createAssistantThread();

    const topicsText = options.documentTopics
      ? ` avec les topics: ${options.documentTopics.join(", ")}`
      : "";

    const questionTypesText =
      options.questionTypes && options.questionTypes.length > 0
        ? `\n🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
        : "\n📝 Types de questions : Utilise la répartition par défaut du system prompt";

    const prompt = `Génère un quiz complet multimédia pour ${options.preset} sur "${options.subject}".${questionTypesText}
    
1. Utilise generate_subject_with_documents pour enrichir avec documents Wikipedia${topicsText}
2. Utilise generate_graphic pour créer des graphiques pédagogiques ${options.graphicType || "2d"} (${options.library || "apexcharts"})
3. Utilise generate_questions_array pour ${options.numQuestions} questions:
   - 30% basées sur graphiques
   - 40% basées sur documents  
   - 30% connaissances générales
4. Niveau: ${options.difficulty || "moyen"}

Crée une expérience d'apprentissage riche et variée.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    const result = await waitForRunCompletion(threadId, runId);

    // Transformer documents en sourceDocuments pour la compatibilité
    if (result && result.documents && result.documents.length > 0) {
      result.sourceDocuments = result.documents;
      result.hasDocuments = true;
    }

    // CORRECTION: Créer subjects pour les presets si un subject existe
    if (result && result.subject && result.subject.questions) {
      result.subjects = [result.subject];
      result.subjectBased = true;
      console.log(
        "✅ Subject transformé en subjects pour mode preset (complete):",
        {
          subjectTitle: result.subject.title,
          questionsCount: result.subject.questions.length,
        },
      );
    }

    return result;
  }

  /**
   * Génère un quiz standard sans contexte spécial
   */
  async generateStandardQuiz(options: {
    preset: "BREVET" | "BAC" | "PARTIELS";
    subject: string;
    numQuestions: number;
    difficulty?: "facile" | "moyen" | "difficile";
    specialties?: string[];
    targetGrade?: number;
    questionTypes?: string[];
  }): Promise<any> {
    const threadId = await createAssistantThread();

    const questionTypesText =
      options.questionTypes && options.questionTypes.length > 0
        ? `\n🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
        : "\n📝 Types de questions : Utilise la répartition par défaut du system prompt";

    let prompt = `Génère un quiz standard pour ${options.preset} sur "${options.subject}".${questionTypesText}
    
Utilise generate_questions_array pour créer ${options.numQuestions} questions de connaissances générales.
Niveau de difficulté: ${options.difficulty || "moyen"}`;

    if (options.specialties && options.specialties.length > 0) {
      prompt += `\nSpécialités ciblées: ${options.specialties.join(", ")}`;
    }

    if (options.targetGrade) {
      prompt += `\nNote cible: ${options.targetGrade}/20`;
    }

    prompt += `\n\nConcentre-toi sur les fondamentaux et la progression pédagogique.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    const assistantResponse = await waitForRunCompletion(threadId, runId);

    // Structurer la réponse avec un titre approprié
    return {
      id: `quiz_${Date.now()}`,
      title: `Quiz ${options.preset} - ${options.subject}`,
      questions: Array.isArray(assistantResponse)
        ? assistantResponse
        : assistantResponse.questions || [],
      metadata: {
        generatedAt: new Date(),
        preset: options.preset,
        subject: options.subject,
        difficulty: options.difficulty || "moyen",
        numQuestions: options.numQuestions,
      },
    };
  }

  // ===== MÉTHODES POUR LES TESTS DEV =====

  /**
   * Crée un nouveau thread pour l'Assistant
   */
  async createThread(): Promise<string> {
    return await createAssistantThread();
  }

  /**
   * Envoie un message dans un thread existant
   */
  async sendMessage(threadId: string, message: string): Promise<any> {
    console.log(
      "🔍 sendMessage - ThreadId:",
      threadId,
      "Type:",
      typeof threadId,
    );
    console.log("🔍 sendMessage - AssistantId:", this.assistantId);

    await addMessageToThread(threadId, message);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    console.log(
      "🔍 sendMessage - Avant waitForRunCompletion, ThreadId:",
      threadId,
      "RunId:",
      runId,
    );

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Test simple de disponibilité de l'Assistant
   */
  async ping(): Promise<boolean> {
    try {
      const threadId = await createAssistantThread();
      await addMessageToThread(threadId, "ping");
      const runId = await runAssistantOnThread(threadId, this.assistantId);

      // On attend juste que ça se lance, pas forcément que ça finisse
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return true;
    } catch (error) {
      console.error("Erreur ping Assistant:", error);
      return false;
    }
  }

  // ===== GESTION D'ERREURS ET VALIDATION =====

  /**
   * Exécute une opération avec retry automatique et validation JSON
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelay?: number;
      validateJson?: boolean;
      operationName?: string;
    } = {},
  ): Promise<T> {
    const {
      maxRetries = 3,
      retryDelay = 1000,
      validateJson = true,
      operationName = "Assistant operation",
    } = options;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 ${operationName} - Tentative ${attempt}/${maxRetries}`);

        const result = await operation();

        if (validateJson && result) {
          this.validateAssistantResponse(result);
        }

        console.log(`✅ ${operationName} - Succès à la tentative ${attempt}`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        console.error(
          `❌ ${operationName} - Échec tentative ${attempt}:`,
          lastError.message,
        );

        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt - 1); // Backoff exponentiel
          console.log(`⏳ Attente ${delay}ms avant retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `${operationName} a échoué après ${maxRetries} tentatives. Dernière erreur: ${lastError?.message}`,
    );
  }

  /**
   * Valide la réponse JSON de l'Assistant
   */
  private validateAssistantResponse(response: any): void {
    if (!response) {
      throw new Error("Réponse Assistant vide");
    }

    // Validation basique du format
    if (typeof response === "string") {
      try {
        JSON.parse(response);
      } catch (error) {
        throw new Error("Réponse Assistant n'est pas un JSON valide");
      }
    }

    // Validation des fonctions attendues
    if (response.tool_calls && Array.isArray(response.tool_calls)) {
      for (const toolCall of response.tool_calls) {
        if (!toolCall.function || !toolCall.function.name) {
          throw new Error(
            "Appel de fonction manquant dans la réponse Assistant",
          );
        }

        // Valider que c'est une de nos 7 fonctions
        const validFunctions = [
          "generate_graphic",
          "generate_questions_array",
          "generate_subject_with_documents",
          "correct_quiz_standard",
          "correct_quiz_with_graphics",
          "correct_quiz_with_documents",
          "correct_quiz_complete",
        ];

        if (!validFunctions.includes(toolCall.function.name)) {
          throw new Error(`Fonction inconnue: ${toolCall.function.name}`);
        }

        // Valider que les arguments sont du JSON
        try {
          JSON.parse(toolCall.function.arguments);
        } catch (error) {
          throw new Error(`Arguments invalides pour ${toolCall.function.name}`);
        }
      }
    }
  }

  /**
   * Log détaillé pour debugging
   */
  private logOperation(
    operation: string,
    params: any,
    result?: any,
    error?: Error,
  ): void {
    const timestamp = new Date().toISOString();

    console.log(`🤖 [${timestamp}] Assistant Operation: ${operation}`);
    console.log(`📥 Params:`, JSON.stringify(params, null, 2));

    if (error) {
      console.error(`❌ Error:`, error.message);
      console.error(`📚 Stack:`, error.stack);
    } else if (result) {
      console.log(`✅ Success`);
      console.log(`📤 Result:`, JSON.stringify(result, null, 2));
    }
  }

  /**
   * Wrapper pour les méthodes de génération avec retry
   */
  async generateWithRetry<T>(
    generatorFn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    return this.executeWithRetry(generatorFn, {
      maxRetries: 3,
      retryDelay: 2000,
      validateJson: true,
      operationName: `Génération: ${operationName}`,
    });
  }

  /**
   * Wrapper pour les méthodes de correction avec retry
   */
  async correctWithRetry<T>(
    correctorFn: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    return this.executeWithRetry(correctorFn, {
      maxRetries: 2, // Moins de retry pour la correction
      retryDelay: 1500,
      validateJson: true,
      operationName: `Correction: ${operationName}`,
    });
  }

  /**
   * Génère un ID unique pour les opérations
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 🆕 Corrige un quiz standard avec Chat Completion + JSON strict
   */
  async correctStandardQuizChatCompletion(
    quizId: string,
    answers: any[],
    options?: any,
  ): Promise<any> {
    try {
      const correctionModel = AIService.getQuizCorrectionModel();
      console.log(
        `🚀 [CORRECTION] Correction standard via Chat Completion + JSON strict (${correctionModel})`,
      );

      // 🐛 [DEBUG] Log des données reçues
      console.log("🐛 [DEBUG] [CORRECTION] Données reçues:", {
        quizId,
        answersCount: answers.length,
        answers: answers.map((a) => ({
          questionId: a.questionId,
          answer: a.answer,
        })),
        questionsCount: options?.questions?.length || 0,
        questions:
          options?.questions?.map((q: any) => ({
            id: q.id,
            type: q.type,
            correctOption: q.options?.find((opt: any) => opt.isCorrect)?.id,
          })) || [],
      });

      // Construire les messages pour correction
      const systemPrompt = this.buildCorrectionSystemPrompt();
      const userPrompt = this.buildStandardCorrectionPrompt(
        quizId,
        answers,
        options,
      );

      // 🐛 [DEBUG] Log du prompt utilisateur (tronqué)
      console.log(
        "🐛 [DEBUG] [CORRECTION] Prompt utilisateur (500 premiers caractères):",
        userPrompt.substring(0, 500) + "...",
      );

      console.log(
        `📤 [CORRECTION] Envoi à ${correctionModel} avec JSON strict`,
      );

      // Configuration de base pour l'appel API
      const apiConfig: any = {
        model: correctionModel,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "quiz_correction_standard",
            strict: true,
            schema: QUIZ_CORRECTION_STANDARD_SCHEMA,
          },
        },
      };

      // 🆕 Configuration spécifique GPT-5
      if (correctionModel.includes("gpt-5")) {
        apiConfig.reasoning_effort = "low";
        apiConfig.max_completion_tokens = 4000;
        // GPT-5 n'accepte que temperature=1 (défaut), on ne le spécifie pas
        console.log(
          "🧠 [CORRECTION] GPT-5-mini détecté : reasoning_effort=low, max_completion_tokens=4000, temperature=1 (défaut)",
        );
      } else {
        apiConfig.temperature = 0.3; // Plus faible pour la correction
        apiConfig.max_tokens = 4000;
      }

      // Appel chat completion avec JSON strict
      const completion = await this.openai.chat.completions.create(apiConfig);

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error("Aucune réponse du modèle pour la correction");
      }

      // Parser la réponse JSON
      const result = JSON.parse(responseContent);

      // 🐛 [DEBUG] Log du résultat de correction
      console.log("🐛 [DEBUG] [CORRECTION] Résultat IA:", {
        correctionsCount: result?.corrections?.length || 0,
        corrections:
          result?.corrections?.map((corr: any) => ({
            questionId: corr.questionId,
            isCorrect: corr.isCorrect,
            pointsObtained: corr.pointsObtained,
            correctAnswer: corr.correctAnswer,
            userAnswerFromResult: corr.userAnswer, // Si disponible
          })) || [],
      });

      if (result && result.corrections && Array.isArray(result.corrections)) {
        console.log(
          "✅ [CORRECTION] Correction standard générée avec succès via chat completion",
        );
        return result;
      }

      console.error(
        "❌ [CORRECTION] Réponse inattendue du chat completion:",
        result,
      );
      throw new Error("Aucune correction valide générée");
    } catch (error) {
      console.error("❌ [CORRECTION] Erreur correction standard:", error);
      throw error;
    }
  }

  /**
   * 🆕 Corrige un quiz complet avec Chat Completion + JSON strict
   */
  async correctCompleteQuizChatCompletion(
    quizId: string,
    answers: any[],
    options?: any,
  ): Promise<any> {
    try {
      const correctionModel = AIService.getQuizCorrectionModel();
      console.log(
        `🚀 [CORRECTION] Correction complète via Chat Completion + JSON strict (${correctionModel})`,
      );

      // Construire les messages pour correction complète
      const systemPrompt = this.buildCompleteCorrectionSystemPrompt();
      const userPrompt = this.buildCompleteCorrectionPrompt(
        quizId,
        answers,
        options,
      );

      console.log(
        `📤 [CORRECTION] Envoi à ${correctionModel} avec JSON strict (schéma complet)`,
      );

      // Configuration de base pour l'appel API
      const apiConfig: any = {
        model: correctionModel,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "quiz_correction_complete",
            strict: true,
            schema: QUIZ_CORRECTION_COMPLETE_SCHEMA,
          },
        },
      };

      // 🆕 Configuration spécifique GPT-5
      if (correctionModel.includes("gpt-5")) {
        apiConfig.reasoning_effort = "low";
        apiConfig.max_completion_tokens = 6000;
        // GPT-5 n'accepte que temperature=1 (défaut), on ne le spécifie pas
        console.log(
          "🧠 [CORRECTION] GPT-5-mini détecté : reasoning_effort=low, max_completion_tokens=6000, temperature=1 (défaut)",
        );
      } else {
        apiConfig.temperature = 0.3;
        apiConfig.max_tokens = 6000;
      }

      // Appel chat completion avec JSON strict
      const completion = await this.openai.chat.completions.create(apiConfig);

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error("Aucune réponse du modèle pour la correction complète");
      }

      // Parser la réponse JSON
      const result = JSON.parse(responseContent);

      if (result && result.corrections && Array.isArray(result.corrections)) {
        console.log(
          "✅ [CORRECTION] Correction complète générée avec succès via chat completion",
        );
        return result;
      }

      console.error(
        "❌ [CORRECTION] Réponse inattendue du chat completion:",
        result,
      );
      throw new Error("Aucune correction complète valide générée");
    } catch (error) {
      console.error("❌ [CORRECTION] Erreur correction complète:", error);
      throw error;
    }
  }

  /**
   * 🆕 Construit le prompt système pour la correction standard
   */
  private buildCorrectionSystemPrompt(): string {
    return `Tu es un correcteur expert du système éducatif français (Brevet, BAC, Partiels).

MISSION : Corriger des quiz avec la rigueur académique française et fournir des retours pédagogiques constructifs.

PRINCIPES DE CORRECTION :
- Appliquer le barème français officiel avec précision
- Évaluer chaque réponse selon les critères académiques
- Fournir des explications détaillées et éducatives
- Adapter les feedbacks au niveau scolaire
- Utiliser un français impeccable et académique

CRITÈRES D'ÉVALUATION :
- Questions fermées (QCM, Vrai/Faux) : Correction binaire (0 ou points max)
- Questions ouvertes : Correction partielle possible selon la qualité de la réponse
- Prise en compte des nuances et des réponses partiellement correctes

FEEDBACK PÉDAGOGIQUE :
- Explications claires et accessibles
- Conseils d'amélioration personnalisés
- Encouragements constructifs
- Références aux concepts clés

Tu DOIS retourner une correction au format JSON strict fourni.`;
  }

  /**
   * 🆕 Construit le prompt système pour la correction complète
   */
  private buildCompleteCorrectionSystemPrompt(): string {
    return `Tu es un correcteur expert spécialisé dans l'évaluation de compétences transversales (analyse de graphiques, documents, sources multiples).

MISSION : Corriger des quiz complexes intégrant graphiques ET documents avec évaluation des compétences analytiques.

COMPÉTENCES ÉVALUÉES :
- Analyse visuelle (graphiques, schémas, diagrammes)
- Analyse textuelle (documents, sources primaires)
- Intégration de données multi-sources
- Raisonnement scientifique et logique
- Esprit critique et synthèse

MÉTHODE D'ÉVALUATION :
- Évaluer chaque compétence sur une échelle de 0 à 10
- Analyser la cohérence entre les différentes sources
- Valoriser la capacité de synthèse et d'analyse croisée
- Identifier les points forts et axes d'amélioration

PARCOURS D'APPRENTISSAGE :
- Recommandations personnalisées par compétence
- Ressources pédagogiques adaptées au profil
- Stratégies d'amélioration concrètes

Tu DOIS retourner une évaluation complète au format JSON strict fourni.`;
  }

  /**
   * 🆕 Construit le prompt pour la correction standard
   */
  private buildStandardCorrectionPrompt(
    quizId: string,
    answers: any[],
    options?: any,
  ): string {
    // Récupérer les questions depuis les options si disponibles
    const questions = options?.questions || [];

    // 👨‍🏫 INTÉGRATION DU PERSONA PROFESSORAL ADAPTATIF
    const professorPersona = getProfessorCorrectionPrompt(
      options?.schoolLevel || "LYCEE_SECONDE",
      options?.collegeGrade,
    );

    let prompt = `${professorPersona}

CORRIGE CE QUIZ STANDARD

QUIZ ID : ${quizId}
NOMBRE DE RÉPONSES : ${answers.length}

DÉTAIL DES QUESTIONS ET RÉPONSES :
${answers
  .map((answer, index) => {
    const question = questions.find((q: any) => q.id === answer.questionId);
    let questionDetails = "";

    if (question) {
      questionDetails = `
   Question: ${question.question || "Non disponible"}
   Type: ${question.type || "UNKNOWN"}`;

      // Pour les QCM, afficher les options et la bonne réponse
      if (
        question.type === "MULTIPLE_CHOICE" &&
        question.options &&
        question.options.length > 0
      ) {
        const correctOption = question.options.find(
          (opt: any) => opt.isCorrect === true,
        );
        questionDetails += `
   Options disponibles: ${question.options.map((opt: any) => `${opt.id}. ${opt.text}${opt.isCorrect ? " [CORRECTE]" : ""}`).join(", ")}
   Réponse correcte attendue: ${correctOption ? correctOption.id : "AUCUNE_DEFINIE"}`;
      }
    }

    return `
${index + 1}. Question ID: ${answer.questionId}${questionDetails}
   Réponse donnée: "${answer.answer}"
   Temps passé: ${answer.timeSpent || "Non renseigné"}s
---`;
  })
  .join("")}

INSTRUCTIONS DE CORRECTION SPÉCIFIQUES PAR TYPE :

🔹 QUESTIONS À CHOIX MULTIPLES (MULTIPLE_CHOICE) :
- VALIDATION STRICTE : Compare la réponse utilisateur avec l'option marquée "isCorrect": true
- Si la réponse utilisateur = ID de l'option correcte → isCorrect: true, points = pointsTotal
- Si la réponse utilisateur ≠ ID de l'option correcte → isCorrect: false, points = 0
- correctAnswer : ⚠️ RÈGLE ABSOLUE - UNIQUEMENT L'ID/LETTRE ⚠️
  * FORMAT OBLIGATOIRE : Une seule lettre majuscule ("A", "B", "C", ou "D")
  * EXEMPLE CORRECT : correctAnswer: "B"
  * EXEMPLE INTERDIT : correctAnswer: "L'énergie totale d'un système..."
  * INTERDICTION FORMELLE : Ne JAMAIS écrire le texte de la réponse
  * VALIDATION : correctAnswer doit être exactement 1 caractère
- NE JAMAIS donner de points si la réponse ne correspond pas exactement à l'option correcte

🔹 QUESTIONS OUVERTES (OPEN_QUESTION) :
- Évaluation sur le contenu, la pertinence et la justesse de la réponse
- Points partiels possibles selon la qualité de la réponse
- correctAnswer : ⚠️ RÉPONSE MODÈLE COMPLÈTE AVEC DÉMONSTRATION ⚠️
  * Pour les DÉMONSTRATIONS (maths, géométrie, physique) :
    → Inclure TOUTES les étapes du raisonnement (constructions, propriétés, calculs)
    → Format : "Étape 1: ... | Étape 2: ... | Étape 3: ... | Conclusion: ..."
    → INTERDIT : Donner uniquement la conclusion finale
  * Pour les EXPLICATIONS (sciences, histoire, etc.) :
    → Inclure le développement complet, pas seulement la réponse finale
    → Exemples, arguments, justifications détaillées
  * EXEMPLE CORRECT (géométrie) : "Construction: Tracer triangle ABC. Prolonger BC en D. Tracer parallèle à AB passant par C. Propriété: Les angles alternes-internes sont égaux (BC//AB). Calcul: angle ACB + angle BCD = 180° (angles supplémentaires). Donc A + B + C = 180°."
  * EXEMPLE INTERDIT : "La somme des angles d'un triangle est 180°."
- Correction plus nuancée possible (25%, 50%, 75%, 100% des points)

🔹 RÈGLES DE COHÉRENCE OBLIGATOIRES :
- isCorrect et pointsObtained DOIVENT être cohérents
- Si isCorrect = false → pointsObtained = 0 (sauf questions ouvertes avec points partiels)
- Si isCorrect = true → pointsObtained = pointsTotal (pour QCM uniquement)
- L'explication doit refléter exactement le résultat de la correction

🔹 INSTRUCTIONS GÉNÉRALES :
- Respecte le TYPE de chaque question pour adapter ta correction
- Calcule les points obtenus selon le type de question
- Fournis des explications détaillées adaptées au type
- Donne des conseils pédagogiques personnalisés
- Calcule le score global et l'appréciation correspondante

BARÈME FRANÇAIS :
- Très bien : 90-100%
- Bien : 75-89%
- Assez bien : 60-74%
- Passable : 50-59%
- Insuffisant : <50%

GÉNÈRE une correction complète et pédagogique au format JSON strict requis.`;

    return prompt;
  }

  /**
   * 🆕 Construit le prompt pour la correction complète
   */
  private buildCompleteCorrectionPrompt(
    quizId: string,
    answers: any[],
    options?: any,
  ): string {
    // Récupérer les questions depuis les options si disponibles
    const questions = options?.questions || [];

    // 👨‍🏫 INTÉGRATION DU PERSONA PROFESSORAL ADAPTATIF
    const professorPersona = getProfessorCorrectionPrompt(
      options?.schoolLevel || "LYCEE_SECONDE",
      options?.collegeGrade,
    );

    let prompt = `${professorPersona}

CORRIGE CE QUIZ COMPLET (GRAPHIQUES + DOCUMENTS)

QUIZ ID : ${quizId}
NOMBRE DE RÉPONSES : ${answers.length}
TYPE : Quiz multimédia avec analyse croisée

DÉTAIL DES QUESTIONS ET RÉPONSES :
${answers
  .map((answer, index) => {
    const question = questions.find((q: any) => q.id === answer.questionId);
    let questionDetails = "";

    if (question) {
      questionDetails = `
   Question: ${question.question || "Non disponible"}
   Type: ${question.type || "UNKNOWN"}`;

      // Pour les QCM, afficher les options et la bonne réponse
      if (
        question.type === "MULTIPLE_CHOICE" &&
        question.options &&
        question.options.length > 0
      ) {
        const correctOption = question.options.find(
          (opt: any) => opt.isCorrect === true,
        );
        questionDetails += `
   Options disponibles: ${question.options.map((opt: any) => `${opt.id}. ${opt.text}${opt.isCorrect ? " [CORRECTE]" : ""}`).join(", ")}
   Réponse correcte attendue: ${correctOption ? correctOption.id : "AUCUNE_DEFINIE"}`;
      }
    }

    return `
${index + 1}. Question ID: ${answer.questionId}${questionDetails}
   Réponse donnée: "${answer.answer}"
   Type de source: ${answer.sourceType || "Mixed"}
   Temps passé: ${answer.timeSpent || "Non renseigné"}s
---`;
  })
  .join("")}

INSTRUCTIONS DE CORRECTION SPÉCIFIQUES PAR TYPE :

🔹 QUESTIONS À CHOIX MULTIPLES (MULTIPLE_CHOICE) :
- VALIDATION STRICTE : Compare la réponse utilisateur avec l'option marquée "isCorrect": true
- Si la réponse utilisateur = ID de l'option correcte → isCorrect: true, points = pointsTotal
- Si la réponse utilisateur ≠ ID de l'option correcte → isCorrect: false, points = 0
- correctAnswer : ⚠️ RÈGLE ABSOLUE - UNIQUEMENT L'ID/LETTRE ⚠️
  * FORMAT OBLIGATOIRE : Une seule lettre majuscule ("A", "B", "C", ou "D")
  * EXEMPLE CORRECT : correctAnswer: "B"
  * EXEMPLE INTERDIT : correctAnswer: "L'énergie totale d'un système..."
  * INTERDICTION FORMELLE : Ne JAMAIS écrire le texte de la réponse
  * VALIDATION : correctAnswer doit être exactement 1 caractère
- NE JAMAIS donner de points si la réponse ne correspond pas exactement à l'option correcte

🔹 QUESTIONS OUVERTES (OPEN_QUESTION) :
- Évaluation sur le contenu, la pertinence et la justesse de la réponse
- Points partiels possibles selon la qualité de la réponse
- correctAnswer : ⚠️ RÉPONSE MODÈLE COMPLÈTE AVEC DÉMONSTRATION ⚠️
  * Pour les DÉMONSTRATIONS (maths, géométrie, physique) :
    → Inclure TOUTES les étapes du raisonnement (constructions, propriétés, calculs)
    → Format : "Étape 1: ... | Étape 2: ... | Étape 3: ... | Conclusion: ..."
    → INTERDIT : Donner uniquement la conclusion finale
  * Pour les EXPLICATIONS (sciences, histoire, etc.) :
    → Inclure le développement complet, pas seulement la réponse finale
    → Exemples, arguments, justifications détaillées
  * EXEMPLE CORRECT (géométrie) : "Construction: Tracer triangle ABC. Prolonger BC en D. Tracer parallèle à AB passant par C. Propriété: Les angles alternes-internes sont égaux (BC//AB). Calcul: angle ACB + angle BCD = 180° (angles supplémentaires). Donc A + B + C = 180°."
  * EXEMPLE INTERDIT : "La somme des angles d'un triangle est 180°."
- Correction plus nuancée possible (25%, 50%, 75%, 100% des points)

🔹 RÈGLES DE COHÉRENCE OBLIGATOIRES :
- isCorrect et pointsObtained DOIVENT être cohérents
- Si isCorrect = false → pointsObtained = 0 (sauf questions ouvertes avec points partiels)
- Si isCorrect = true → pointsObtained = pointsTotal (pour QCM uniquement)
- L'explication doit refléter exactement le résultat de la correction

ÉVALUATION DES COMPÉTENCES :
- Analyse visuelle (0-10) : Capacité à interpréter graphiques, schémas, diagrammes
- Analyse textuelle (0-10) : Compréhension et analyse de documents écrits
- Intégration de données (0-10) : Synthèse cohérente de sources multiples
- Raisonnement scientifique (0-10) : Logique et démarche scientifique
- Esprit critique (0-10) : Analyse critique et nuances

INSTRUCTIONS SPÉCIALISÉES :
- Respecte le TYPE de chaque question pour adapter ta correction
- Évalue la qualité de l'analyse graphique pour chaque réponse
- Vérifie la compréhension des documents de référence
- Analyse la capacité de synthèse multi-sources
- Identifie les compétences fortes et les axes d'amélioration
- Propose un parcours d'apprentissage personnalisé avec ressources

GÉNÈRE une évaluation complète des compétences au format JSON strict requis.`;

    return prompt;
  }

  /**
   * Nettoyage des threads après opération
   */
  async cleanupThread(threadId: string): Promise<void> {
    try {
      // Ici on pourrait ajouter une méthode de nettoyage si nécessaire
      console.log(`🧹 Thread ${threadId} marqué pour nettoyage`);
    } catch (error) {
      console.warn(`⚠️ Échec nettoyage thread ${threadId}:`, error);
    }
  }
}
