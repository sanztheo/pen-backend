import {
  QuizGenerationRequest,
  SequentialQuizConfig,
  ExamSubject,
  QuizPreset,
  SchoolLevel,
  QuestionType,
} from "../../types.js";
import { AIService } from "../../../ai/base.js";

// Filières d'études supérieures avec leurs matières principales
export const PARTIELS_CONFIG = {
  name: "Partiels Études Supérieures",
  filieres: {
    Économie: {
      subjects: [
        "Microéconomie",
        "Macroéconomie",
        "Économétrie",
        "Statistiques",
        "Mathématiques financières",
      ],
      duration: 180, // 3 heures par matière
      questionCount: 25,
      description: "Examens d'économie niveau universitaire",
      enableDocuments: false, // Économie : matière technique sans besoin de documents
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 1,
      enableGraphics: true,
      graphicProbability: 0.8,
      preferredLibraries: ["apexcharts", "plotly"],
      graphicTypes: ["2d"],
    },
    Droit: {
      subjects: [
        "Droit civil",
        "Droit constitutionnel",
        "Droit des affaires",
        "Procédure",
        "Droit fiscal",
      ],
      duration: 240, // 4 heures par matière
      questionCount: 25,
      description: "Examens juridiques avec cas pratiques",
      enableDocuments: true,
      documentTopics: ["droit", "moderne"],
      documentRatio: 0.3, // 30% questions sur documents
      minDocumentLength: 100,
      maxDocuments: 2,
    },
    Médecine: {
      subjects: [
        "Anatomie",
        "Physiologie",
        "Pathologie",
        "Pharmacologie",
        "Sémiologie",
      ],
      duration: 120, // 2 heures par matière
      questionCount: 30,
      description: "QCM et questions cliniques",
      enableDocuments: false, // Médecine : connaissances factuelles précises, pas d'analyse de documents
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 0,
    },
    Informatique: {
      subjects: [
        "Algorithmique",
        "Programmation",
        "Base de données",
        "Réseaux",
        "Intelligence artificielle",
      ],
      duration: 180, // 3 heures par matière
      questionCount: 25,
      description: "Exercices pratiques et théoriques",
      enableDocuments: false, // Informatique : matière technique et pratique, pas d'analyse de documents
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 0,
      enableGraphics: true,
      graphicProbability: 0.6,
      preferredLibraries: ["apexcharts"],
      graphicTypes: ["2d"],
    },
    Psychologie: {
      subjects: [
        "Psychologie cognitive",
        "Psychologie sociale",
        "Neuropsychologie",
        "Statistiques",
        "Méthodologie",
      ],
      duration: 180, // 3 heures par matière
      questionCount: 25,
      description: "Études de cas et théories psychologiques",
      enableDocuments: false, // Psychologie : études empiriques et théories, pas d'analyse de documents Wikipedia
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 0,
    },
    Gestion: {
      subjects: [
        "Management",
        "Marketing",
        "Finance",
        "Comptabilité",
        "Ressources humaines",
      ],
      duration: 180, // 3 heures par matière
      questionCount: 25,
      description: "Études de cas d'entreprise",
      enableDocuments: false, // Gestion : matière pratique et cas d'entreprise, pas de documents
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 1,
    },
    Histoire: {
      subjects: [
        "Histoire contemporaine",
        "Méthodologie historique",
        "Sources et archives",
        "Historiographie",
      ],
      duration: 240, // 4 heures par matière
      questionCount: 25,
      description: "Dissertations et commentaires de documents",
      enableDocuments: true,
      documentTopics: [
        "histoire",
        "moderne",
        "revolution",
        "guerre_conflits",
        "antiquite",
      ],
      documentRatio: 0.6, // 60% questions sur documents
      minDocumentLength: 100,
      maxDocuments: 2,
    },
    Lettres: {
      subjects: [
        "Littérature française",
        "Littérature comparée",
        "Linguistique",
        "Grammaire",
        "Stylistique",
      ],
      duration: 240, // 4 heures par matière
      questionCount: 25,
      description: "Analyses littéraires et dissertations",
      enableDocuments: true,
      documentTopics: ["litterature", "arts", "philosophie"],
      documentRatio: 0.5, // 50% questions sur documents
      minDocumentLength: 100,
      maxDocuments: 2,
    },
    Sciences: {
      subjects: [
        "Mathématiques",
        "Physique",
        "Chimie",
        "Méthodes expérimentales",
        "Modélisation",
      ],
      duration: 180, // 3 heures par matière
      questionCount: 25,
      description: "Exercices et problèmes scientifiques",
      enableDocuments: false,
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 0,
      enableGraphics: true,
      graphicProbability: 0.9,
      preferredLibraries: ["apexcharts", "plotly"],
      graphicTypes: ["2d", "3d"],
    },
  },
  defaultQuestionTypes: [
    QuestionType.OPEN_QUESTION,
    QuestionType.MULTIPLE_CHOICE,
    QuestionType.TRUE_FALSE,
  ],
  passingGrade: 10,
} as const;

// Type for subject configuration with document and graphic settings
interface SubjectConfigEntry {
  documentConfig: {
    enableDocuments: boolean;
    documentTopics: string[];
    documentRatio: number;
    minDocumentLength: number;
    maxDocuments: number;
  };
  graphicConfig: {
    enableGraphics: boolean;
    graphicProbability: number;
    preferredLibraries: ("apexcharts" | "plotly")[];
    graphicTypes: ("2d" | "3d")[];
  };
}

/**
 * Génère des matières pertinentes pour une filière d'études via l'IA avec configuration documentaire
 */
async function generateSubjectsForField(higherEdField: string): Promise<{
  subjects: string[];
  subjectsConfig: Record<string, SubjectConfigEntry>;
}> {
  const prompt = `
Génère exactement 5 matières universitaires principales pour la filière d'études "${higherEdField}".

Pour chaque matière, détermine si elle nécessite des documents Wikipedia pour l'étude ET/OU si elle peut inclure des graphiques.

- DOCUMENTS OUI : Matières littéraires, historiques, philosophiques, économiques, sociales (analyse de textes).
- DOCUMENTS NON : Matières scientifiques, techniques, mathématiques, informatiques (calculs, formules, pratique).
- GRAPHIQUES OUI : Matières scientifiques, économiques, statistiques, techniques (visualisation de données).
- GRAPHIQUES NON : Matières littéraires, juridiques, philosophiques (généralement pas de graphiques pertinents).

CONSIGNES:
- Réponds UNIQUEMENT avec un objet JSON.
- 5 matières précises et académiques niveau universitaire.
- Pour chaque matière, indique si elle nécessite des documents ET/OU des graphiques.

Format de réponse JSON :
{
  "subjects": ["Matière 1", "Matière 2", "Matière 3", "Matière 4", "Matière 5"],
  "subjectsConfig": {
    "Matière 1": {
      "needsDocuments": true,
      "needsGraphics": false,
      "reason": "analyse de textes historiques"
    },
    "Matière 2": {
      "needsDocuments": false,
      "needsGraphics": true,
      "reason": "visualisation de données statistiques"
    }
  }
}

Exemple pour "Économie":
{
  "subjects": ["Microéconomie", "Macroéconomie", "Économétrie", "Statistiques", "Mathématiques financières"],
  "subjectsConfig": {
    "Microéconomie": {"needsDocuments": false, "needsGraphics": true, "reason": "modèles et courbes"},
    "Macroéconomie": {"needsDocuments": true, "needsGraphics": true, "reason": "données agrégées et modèles"},
    "Économétrie": {"needsDocuments": false, "needsGraphics": true, "reason": "régressions et visualisations"},
    "Statistiques": {"needsDocuments": false, "needsGraphics": true, "reason": "diagrammes et graphiques"},
    "Mathématiques financières": {"needsDocuments": false, "needsGraphics": true, "reason": "courbes de taux et graphiques"}
  }
}

Filière à traiter: ${higherEdField}
`;

  try {
    console.log(
      `🎯 Génération de matières IA avec config documentaire pour: ${higherEdField}`,
    );

    const response = await AIService.generateContent({
      prompt,
      maxTokens: 800,
      temperature: 0.7,
    });

    const content = response.content?.trim();
    if (!content) {
      throw new Error("Réponse IA vide");
    }

    // Parser le JSON retourné par l'IA
    const parsed = JSON.parse(content);

    if (
      !parsed.subjects ||
      !Array.isArray(parsed.subjects) ||
      parsed.subjects.length !== 5
    ) {
      throw new Error("Format de réponse IA incorrect");
    }

    // Transformer la configuration IA vers le format attendu
    const subjectsConfig: Record<string, SubjectConfigEntry> = {};

    for (const subject of parsed.subjects) {
      const subjectAiConfig = parsed.subjectsConfig?.[subject];
      const needsDocuments = subjectAiConfig?.needsDocuments || false;
      const needsGraphics = subjectAiConfig?.needsGraphics || false;

      subjectsConfig[subject] = {
        documentConfig: {
          enableDocuments: needsDocuments,
          documentTopics: needsDocuments
            ? ["histoire", "philosophie", "litterature", "sciences"]
            : [],
          documentRatio: needsDocuments ? 0.4 : 0,
          minDocumentLength: 100,
          maxDocuments: needsDocuments ? 2 : 0,
        },
        graphicConfig: {
          enableGraphics: needsGraphics,
          graphicProbability: needsGraphics ? 0.5 : 0,
          preferredLibraries: needsGraphics ? ["apexcharts", "plotly"] : [],
          graphicTypes: needsGraphics ? ["2d"] : [],
        },
      };
    }

    console.log(`✅ Matières générées pour ${higherEdField}:`, parsed.subjects);
    console.log(`📄 Configuration complète:`, subjectsConfig);

    return {
      subjects: parsed.subjects,
      subjectsConfig,
    };
  } catch (error) {
    console.warn(
      `⚠️ Erreur génération matières IA pour ${higherEdField}:`,
      error,
    );

    // Fallback vers des matières génériques SANS documents (sécurité)
    const fallbackSubjects = [
      `Fondamentaux de ${higherEdField}`,
      `Méthodologie en ${higherEdField}`,
      `Applications pratiques`,
      `Recherche et innovation`,
      `Projet de fin d'études`,
    ];

    const fallbackConfig: Record<string, SubjectConfigEntry> = {};
    fallbackSubjects.forEach((subject) => {
      fallbackConfig[subject] = {
        documentConfig: {
          enableDocuments: false, // Sécurité : pas de documents par défaut
          documentTopics: [],
          documentRatio: 0,
          minDocumentLength: 100,
          maxDocuments: 0,
        },
        graphicConfig: {
          enableGraphics: false,
          graphicProbability: 0,
          preferredLibraries: [],
          graphicTypes: [],
        },
      };
    });

    return {
      subjects: fallbackSubjects,
      subjectsConfig: fallbackConfig,
    };
  }
}

/**
 * Génère une configuration séquentielle pour les Partiels
 */
export async function createPartielsSequentialConfig(
  userId: string,
  higherEdField: string,
): Promise<SequentialQuizConfig> {
  const filiereConfig =
    PARTIELS_CONFIG.filieres[
      higherEdField as keyof typeof PARTIELS_CONFIG.filieres
    ];

  interface FiliereConfigType {
    subjects: readonly string[];
    duration: number;
    questionCount: number;
    description: string;
  }

  let config: FiliereConfigType;
  let subjectsConfig: Record<string, SubjectConfigEntry> = {};

  if (filiereConfig) {
    // Filière prédéfinie : utiliser la configuration existante
    console.log(
      `📚 Utilisation de la configuration prédéfinie pour: ${higherEdField}`,
    );
    config = filiereConfig;

    // Pour les filières prédéfinies, créer la config pour chaque matière
    // Type assertion for optional graphic properties
    const filiereWithGraphics = filiereConfig as typeof filiereConfig & {
      enableGraphics?: boolean;
      graphicProbability?: number;
      preferredLibraries?: readonly ("apexcharts" | "plotly")[];
      graphicTypes?: readonly ("2d" | "3d")[];
    };
    filiereConfig.subjects.forEach((subject) => {
      subjectsConfig[subject] = {
        documentConfig: {
          enableDocuments: filiereConfig.enableDocuments,
          documentTopics: [...filiereConfig.documentTopics],
          documentRatio: filiereConfig.documentRatio,
          minDocumentLength: filiereConfig.minDocumentLength,
          maxDocuments: filiereConfig.maxDocuments,
        },
        graphicConfig: {
          enableGraphics: filiereWithGraphics.enableGraphics ?? false,
          graphicProbability: filiereWithGraphics.graphicProbability ?? 0,
          preferredLibraries: filiereWithGraphics.preferredLibraries
            ? [...filiereWithGraphics.preferredLibraries]
            : [],
          graphicTypes: filiereWithGraphics.graphicTypes
            ? [...filiereWithGraphics.graphicTypes]
            : [],
        },
      };
    });
  } else {
    // Filière personnalisée : générer les matières via IA avec configuration documentaire
    console.log(
      `🤖 Génération IA des matières avec config documentaire pour: ${higherEdField}`,
    );
    const aiGenerated = await generateSubjectsForField(higherEdField);

    config = {
      subjects: aiGenerated.subjects,
      duration: 180,
      questionCount: 25,
      description: "Examens universitaires",
    };

    subjectsConfig = aiGenerated.subjectsConfig;
  }

  // Créer des sujets "génériques" pour chaque matière
  const subjects: ExamSubject[] = config.subjects.map((subjectName: string) =>
    mapSubjectNameToEnum(subjectName),
  );

  return {
    id: `partiels_${userId}_${Date.now()}`,
    preset: QuizPreset.PARTIELS,
    subjects,
    currentSubjectIndex: 0,
    totalSubjects: subjects.length,
    isCompleted: false,
    higherEdField,
    subjectResults: subjects.map((subject, index) => {
      const subjectName = config.subjects[index];
      const subjectConfig = subjectsConfig[subjectName] || {};

      return {
        subject,
        isCompleted: false,
        subjectName,
        documentConfig: subjectConfig.documentConfig,
        graphicConfig: subjectConfig.graphicConfig,
      };
    }),
    metadata: {
      startedAt: new Date(),
      estimatedTotalTime: config.subjects.length * config.duration,
      subjectsDocumentConfig: subjectsConfig, // NOUVEAU : configuration documentaire globale
    },
  };
}

/**
 * Génère la requête pour la matière courante des Partiels
 */
export function generatePartielsSubjectRequest(
  config: SequentialQuizConfig,
  userId: string,
  workspaceIds?: string[],
): QuizGenerationRequest {
  if (!config.higherEdField) {
    throw new Error("Filière d'études supérieures non spécifiée");
  }

  const filiereConfig =
    PARTIELS_CONFIG.filieres[
      config.higherEdField as keyof typeof PARTIELS_CONFIG.filieres
    ];

  // Utiliser la configuration prédéfinie ou une configuration générique
  const configToUse = filiereConfig || {
    subjects: ["Partiel 1", "Partiel 2", "Partiel 3"],
    duration: 180,
    questionCount: 20,
    description: "Examens universitaires",
  };

  // Utiliser le nom stocké dans subjectResults pour avoir le vrai nom de la matière
  const currentSubjectResult =
    config.subjectResults[config.currentSubjectIndex];
  const currentSubjectName =
    currentSubjectResult?.subjectName ||
    configToUse.subjects[config.currentSubjectIndex];

  // Récupérer la configuration documentaire pour cette matière spécifique
  const subjectFullConfig = config.subjectResults[config.currentSubjectIndex];
  const documentConfig = subjectFullConfig?.documentConfig || {
    enableDocuments: false,
    documentTopics: [],
    documentRatio: 0,
    minDocumentLength: 100,
    maxDocuments: 0,
  };
  const graphicConfig = subjectFullConfig?.graphicConfig || {
    enableGraphics: false,
    graphicProbability: 0,
    preferredLibraries: [],
    graphicTypes: [],
  };

  console.log(
    `📄 [DOCUMENTS] Configuration pour ${currentSubjectName}:`,
    documentConfig,
  );
  console.log(
    `📊 [GRAPHICS] Configuration pour ${currentSubjectName}:`,
    graphicConfig,
  );

  return {
    userId,
    schoolLevel: SchoolLevel.ETUDES_SUPERIEURES,
    higherEdField: config.higherEdField,
    questionTypes: [...PARTIELS_CONFIG.defaultQuestionTypes],
    questionCount: configToUse.questionCount,
    preset: QuizPreset.PARTIELS,
    sequentialConfig: config,
    specificSubject: config.subjects[config.currentSubjectIndex], // Subject générique
    workspaceIds,
    title: `Partiels ${config.higherEdField} - ${currentSubjectName}`,
    description: `${configToUse.description} - Durée: ${configToUse.duration} min - Matière: ${currentSubjectName}`,
    // NOUVEAU : Configuration documentaire dynamique par matière
    documentConfig,
    graphicConfig,
  };
}

/**
 * Génère les prompts spécialisés pour chaque filière des Partiels
 */
export function getPartielsPrompt(
  higherEdField: string,
  subjectName: string,
): string {
  const baseContext = `
Tu es un expert en conception d'examens partiels universitaires de niveau supérieur pour la filière ${higherEdField}.
L'étudiant est en cursus universitaire (Licence/Master) dans la filière ${higherEdField}.

CONSIGNES GÉNÉRALES PARTIELS UNIVERSITAIRES :
- Respecte les standards académiques et la rigueur universitaire
- Adapte le niveau de complexité aux études supérieures (L2/L3/M1/M2)
- Privilégie l'analyse critique, la synthèse et l'application des connaissances
- Évalue la maîtrise approfondie des concepts disciplinaires
- Intègre une dimension de recherche et d'autonomie intellectuelle
- Assure la transition entre savoirs théoriques et applications pratiques
- Base-toi sur les spécificités et exigences de la filière ${higherEdField}

IMPORTANT : Génère des questions de niveau universitaire avec exigences académiques réelles adaptées à la filière ${higherEdField}.
Matière évaluée : ${subjectName}
`;

  const filiereConfig =
    PARTIELS_CONFIG.filieres[
      higherEdField as keyof typeof PARTIELS_CONFIG.filieres
    ];
  if (!filiereConfig) {
    return `${baseContext}

PARTIEL ${higherEdField.toUpperCase()} - MATIÈRE: ${subjectName}

Tu es un expert pour la création de partiel pour le diplôme ${higherEdField}.
Adapte le contenu et le niveau de difficulté aux spécificités de cette filière d'études.

Génère des questions universitaires approfondies qui évaluent :
- Maîtrise des concepts fondamentaux de ${higherEdField}
- Capacité d'analyse et de synthèse dans le domaine ${higherEdField}
- Application des connaissances à des cas concrets de ${higherEdField}
- Esprit critique et argumentation selon les standards de ${higherEdField}
- Méthodologie disciplinaire propre à ${higherEdField}

Adapte le niveau et le vocabulaire aux standards universitaires de ${higherEdField}.
Privilégie les questions ouvertes permettant la réflexion approfondie dans le domaine ${higherEdField}.`;
  }

  switch (higherEdField.toLowerCase()) {
    case "économie":
      return `${baseContext}

PARTIEL D'ÉCONOMIE - MATIÈRE: ${subjectName} (3h)

Niveau universitaire L2/L3/M1 selon la complexité requise.

Adapte le contenu selon la matière :
- Microéconomie : optimisation, équilibres, théorie des jeux
- Macroéconomie : modèles IS-LM, croissance, politiques économiques
- Économétrie : régressions, tests statistiques, modélisation
- Mathématiques financières : calculs actuariels, options, risques

Génère des questions qui évaluent :
- Maîtrise des concepts théoriques
- Application à des cas concrets
- Calculs et démonstrations mathématiques
- Analyse critique de politiques économiques
- Interprétation de graphiques et données

Format : exercices techniques + questions de réflexion.`;

    case "droit":
      return `${baseContext}

PARTIEL DE DROIT - MATIÈRE: ${subjectName} (4h)

Niveau universitaire avec rigueur juridique.

Adapte le contenu selon la matière :
- Droit civil : contrats, responsabilité, propriété
- Droit constitutionnel : institutions, droits fondamentaux
- Droit des affaires : sociétés, concurrence, commercial
- Procédure : règles processuelles, voies de recours

Génère des questions qui évaluent :
- Connaissance des textes et jurisprudence
- Résolution de cas pratiques
- Raisonnement juridique structuré
- Argumentation et subsomption
- Maîtrise de la méthodologie juridique

Format : cas pratiques + dissertations juridiques + QCM de cours.`;

    case "médecine":
      return `${baseContext}

PARTIEL DE MÉDECINE - MATIÈRE: ${subjectName} (2h)

Niveau universitaire avec précision scientifique médicale.

Adapte le contenu selon la matière :
- Anatomie : structures, localisations, rapports anatomiques
- Physiologie : mécanismes, régulations, intégrations
- Pathologie : étiologies, physiopathologie, diagnostics
- Pharmacologie : mécanismes d'action, effets, interactions

Génère des questions qui évaluent :
- Connaissances factuelles précises
- Raisonnement clinique
- Intégration des connaissances
- Analyse de cas cliniques
- Corrélations anatomo-cliniques

Format principalement QCM + quelques questions rédactionnelles courtes.`;

    case "informatique":
      return `${baseContext}

PARTIEL D'INFORMATIQUE - MATIÈRE: ${subjectName} (3h)

Niveau universitaire avec rigueur technique.

Adapte le contenu selon la matière :
- Algorithmique : complexité, structures de données, optimisation
- Programmation : paradigmes, langages, bonnes pratiques
- Base de données : modélisation, SQL, normalisation
- Réseaux : protocoles, architecture, sécurité
- IA : apprentissage automatique, algorithmes, applications

Génère des questions qui évaluent :
- Maîtrise théorique des concepts
- Capacité de programmation
- Résolution de problèmes techniques
- Analyse de complexité
- Architecture et conception

Format : exercices pratiques + questions théoriques + analyse de code.`;

    case "psychologie":
      return `${baseContext}

PARTIEL DE PSYCHOLOGIE - MATIÈRE: ${subjectName} (3h)

Niveau universitaire avec approche scientifique.

Adapte le contenu selon la matière :
- Psychologie cognitive : mémoire, attention, perception, langage
- Psychologie sociale : attitudes, groupes, influence sociale
- Neuropsychologie : bases cérébrales, pathologies, évaluations
- Méthodologie : statistiques, expérimentation, éthique

Génère des questions qui évaluent :
- Connaissances théoriques et empiriques
- Analyse d'études et protocoles expérimentaux
- Application à des cas cliniques
- Esprit critique méthodologique
- Synthèse de recherches

Format : études de cas + analyses d'expériences + questions de cours.`;

    case "gestion":
      return `${baseContext}

PARTIEL DE GESTION - MATIÈRE: ${subjectName} (3h)

Niveau universitaire orienté management.

Adapte le contenu selon la matière :
- Management : leadership, organisation, stratégie
- Marketing : segmentation, mix, digital, études de marché
- Finance : analyse financière, investissement, financement
- Comptabilité : états financiers, analyse, contrôle de gestion
- RH : recrutement, formation, évaluation, droit social

Génère des questions qui évaluent :
- Maîtrise des outils de gestion
- Analyse de situations d'entreprise
- Prise de décision managériale
- Calculs et interprétations financières
- Stratégies et recommandations

Format : études de cas d'entreprise + exercices de calcul + questions stratégiques.`;

    default:
      return `${baseContext}

PARTIEL ${higherEdField.toUpperCase()} - MATIÈRE: ${subjectName}

Génère des questions universitaires approfondies qui évaluent :
- Maîtrise des concepts fondamentaux
- Capacité d'analyse et de synthèse
- Application des connaissances à des cas concrets
- Esprit critique et argumentation
- Méthodologie disciplinaire

Adapte le niveau et le vocabulaire aux standards universitaires.
Privilégie les questions ouvertes permettant la réflexion approfondie.`;
  }
}

/**
 * Retourne le nom de la matière courante pour les partiels
 */
export function getCurrentSubjectName(config: SequentialQuizConfig): string {
  if (!config.higherEdField) return "Matière inconnue";

  // NOUVEAU : Utiliser d'abord le nom stocké dans subjectResults
  const currentSubjectResult =
    config.subjectResults[config.currentSubjectIndex];
  if (currentSubjectResult && currentSubjectResult.subjectName) {
    return currentSubjectResult.subjectName;
  }

  // Fallback vers l'ancienne méthode
  const filiereConfig =
    PARTIELS_CONFIG.filieres[
      config.higherEdField as keyof typeof PARTIELS_CONFIG.filieres
    ];

  if (filiereConfig) {
    return (
      filiereConfig.subjects[config.currentSubjectIndex] || "Matière inconnue"
    );
  }

  // Fallback final
  return `Matière ${config.currentSubjectIndex + 1}`;
}

/**
 * Calcule le score global des Partiels
 */
export function calculatePartielsGlobalScore(config: SequentialQuizConfig): {
  totalScore: number;
  maxScore: number;
  grade: number;
  mention?: string;
} {
  const totalScore = config.subjectResults.reduce(
    (sum, result) => sum + (result.score || 0),
    0,
  );
  const maxScore = config.subjectResults.reduce(
    (sum, result) => sum + (result.maxScore || 0),
    0,
  );
  const grade = maxScore > 0 ? (totalScore / maxScore) * 20 : 0;

  let mention: string | undefined;
  if (grade >= 16) mention = "Très bien";
  else if (grade >= 14) mention = "Bien";
  else if (grade >= 12) mention = "Assez bien";

  return {
    totalScore,
    maxScore,
    grade: Math.round(grade * 100) / 100,
    mention,
  };
}

/**
 * Retourne la liste des filières disponibles
 */
export function getAvailableFilieres(): string[] {
  return Object.keys(PARTIELS_CONFIG.filieres);
}

// Module pour les Partiels d'études supérieures

function mapSubjectNameToEnum(subjectName: string): ExamSubject {
  // Le nom réel de la matière est stocké dans subjectName.
  // On utilise une valeur générique de l'enum ici car l'enum
  // n'est pas adapté aux filières universitaires.
  // Cela évite de devoir migrer l'enum et de casser d'autres parties du code.
  return ExamSubject.GRAND_ORAL;
}
