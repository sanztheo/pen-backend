// assistant/config/schemas.ts - Schémas JSON stricts pour les questions et corrections

// Schéma JSON strict pour les questions
export const QUIZ_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Identifiant unique de la question (format: q_timestamp_index)",
          },
          question: {
            type: "string",
            description: "Énoncé de la question en français, adapté au niveau éducatif",
          },
          type: {
            type: "string",
            enum: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION", "MATCHING"],
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
                  description: "Identifiant de l'élément de gauche (1, 2, 3, 4...)",
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
                  description: "Identifiant de l'élément de droite (A, B, C, D...)",
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
          points: {
            type: "integer",
            description: "Points attribués à cette question (toujours 1 pour quiz personnalisés)",
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
            description: "Indique si la question est basée sur un document Wikipedia",
          },
          documentReference: {
            type: "string",
            description: "Référence au document Wikipedia utilisé (si basedOnDocument = true)",
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

// Schéma JSON strict pour la correction standard
export const QUIZ_CORRECTION_STANDARD_SCHEMA = {
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
            description: "Points obtenus pour cette question (peut être partiel)",
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
          description: "Appréciation globale française (Très bien, Bien, Assez bien, etc.)",
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

// Schéma JSON strict pour la correction complète (graphiques + documents)
export const QUIZ_CORRECTION_COMPLETE_SCHEMA = {
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
  required: ["corrections", "globalCompetencies", "globalScore", "learningPath"],
  additionalProperties: false,
};
