import {
  QuizGenerationRequest,
  SequentialQuizConfig,
  ExamSubject,
  QuizPreset,
  SchoolLevel,
  LyceeSpecialty,
  QuestionType,
} from "../../types.js";

/**
 * Interface for subject configuration in BAC exams
 */
interface BacSubjectConfig {
  readonly subject: ExamSubject;
  readonly duration: number;
  readonly coefficient: number;
  readonly questionTypes: readonly QuestionType[];
  readonly questionCount: number;
  readonly description: string;
  readonly enableDocuments?: boolean;
  readonly documentTopics?: readonly string[];
  readonly documentRatio?: number;
  readonly minDocumentLength?: number;
  readonly maxDocuments?: number;
  readonly enableGraphics?: boolean;
  readonly graphicProbability?: number;
  readonly preferredLibraries?: readonly string[];
  readonly graphicTypes?: readonly string[];
}

// Configuration officielle du Baccalauréat général
export const BAC_CONFIG = {
  name: "Baccalauréat Général",
  troncCommun: [
    {
      subject: ExamSubject.PHILOSOPHIE,
      duration: 240, // 4 heures
      coefficient: 8,
      questionTypes: [QuestionType.OPEN_QUESTION],
      questionCount: 25,
      description: "Dissertation ou explication de texte",
      enableDocuments: true,
      documentTopics: ["philosophie", "philosophie_antique", "philosophie_moderne"],
      documentRatio: 0.4, // 40% questions sur documents
      minDocumentLength: 100,
      maxDocuments: 2,
    },
  ],
  specialties: {
    [LyceeSpecialty.MATHEMATIQUES]: {
      subject: ExamSubject.MATHEMATIQUES_SPECIALITE,
      duration: 240, // 4 heures
      coefficient: 16,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE],
      questionCount: 25,
      description: "Exercices et problèmes mathématiques",
      enableDocuments: false,
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 0,
      enableGraphics: true,
      graphicProbability: 0.7,
      preferredLibraries: ["apexcharts", "plotly"],
      graphicTypes: ["2d", "3d"],
    },
    [LyceeSpecialty.PHYSIQUE_CHIMIE]: {
      subject: ExamSubject.PHYSIQUE_CHIMIE_SPECIALITE,
      duration: 210, // 3h30
      coefficient: 16,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE],
      questionCount: 25,
      description: "Exercices et analyse de documents",
      enableDocuments: false,
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 0,
      enableGraphics: true,
      graphicProbability: 0.6,
      preferredLibraries: ["apexcharts", "plotly"],
      graphicTypes: ["2d", "3d"],
    },
    [LyceeSpecialty.SVT]: {
      subject: ExamSubject.SVT_SPECIALITE,
      duration: 210, // 3h30
      coefficient: 16,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE],
      questionCount: 25,
      description: "QCM et questions de synthèse",
      enableDocuments: false,
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 0,
      enableGraphics: true,
      graphicProbability: 0.5,
      preferredLibraries: ["apexcharts"],
      graphicTypes: ["2d"],
    },
    [LyceeSpecialty.SES]: {
      subject: ExamSubject.SES_SPECIALITE,
      duration: 240, // 4 heures
      coefficient: 16,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE],
      questionCount: 25,
      description: "Dissertation et étude de documents",
      enableDocuments: true,
      documentTopics: ["economie", "sociologie", "moderne"],
      documentRatio: 0.4, // 40% questions sur documents
      minDocumentLength: 100,
      maxDocuments: 2,
    },
    [LyceeSpecialty.HISTOIRE_GEO]: {
      subject: ExamSubject.HGGSP,
      duration: 240, // 4 heures
      coefficient: 16,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE],
      questionCount: 25,
      description: "Dissertation et étude critique de documents",
      enableDocuments: true,
      documentTopics: [
        "democraties",
        "totalitarismes",
        "decolonisation",
        "guerre_froide",
        "puissances",
        "mondialisation",
        "territoires",
        "institutions",
        "libertes",
      ],
      documentRatio: 0.6, // 60% questions sur documents
      minDocumentLength: 100,
      maxDocuments: 2,
    },
    [LyceeSpecialty.NSI]: {
      subject: ExamSubject.NSI_SPECIALITE,
      duration: 210, // 3h30
      coefficient: 16,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE],
      questionCount: 25,
      description: "Exercices pratiques et théoriques",
      enableDocuments: false, // NSI : matière technique avec programmation et algorithmique
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 0,
    },
    [LyceeSpecialty.SI]: {
      subject: ExamSubject.SI_SPECIALITE,
      duration: 240, // 4 heures
      coefficient: 16,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE],
      questionCount: 25,
      description: "Projet et analyse technique",
      enableDocuments: false, // SI : matière technique et ingénierie, pas d'analyse de documents
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 1,
    },
  },
  grandOral: {
    subject: ExamSubject.GRAND_ORAL,
    duration: 20, // 20 minutes + 20 min préparation
    coefficient: 10,
    questionTypes: [QuestionType.OPEN_QUESTION],
    questionCount: 25,
    description: "Présentation et entretien sur les spécialités",
  },
  totalCoefficient: 100,
  passingGrade: 10,
} as const;

/**
 * Génère une configuration séquentielle pour le Baccalauréat
 */
export function createBacSequentialConfig(
  userId: string,
  specialties: LyceeSpecialty[],
): SequentialQuizConfig {
  if (specialties.length !== 2) {
    throw new Error("Le Baccalauréat général nécessite exactement 2 spécialités");
  }

  // Vérification que les spécialités sont supportées
  const availableSpecialties = Object.keys(
    BAC_CONFIG.specialties,
  ) as (keyof typeof BAC_CONFIG.specialties)[];
  for (const specialty of specialties) {
    if (!availableSpecialties.includes(specialty as keyof typeof BAC_CONFIG.specialties)) {
      throw new Error(`Spécialité non supportée: ${specialty}`);
    }
  }

  // Ordre souhaité: d'abord les 2 spécialités, puis Philosophie en dernier
  const subjects: ExamSubject[] = [
    ...specialties.map(
      (s) => BAC_CONFIG.specialties[s as keyof typeof BAC_CONFIG.specialties].subject,
    ),
    ExamSubject.PHILOSOPHIE,
    // Grand Oral retiré de la séquence
  ];

  return {
    id: `bac_${userId}_${Date.now()}`,
    preset: QuizPreset.BAC,
    subjects,
    currentSubjectIndex: 0,
    totalSubjects: subjects.length,
    isCompleted: false,
    specialties,
    subjectResults: subjects.map((subject) => {
      // Récupérer la config selon la matière (tronc commun ou spécialité)
      let cfg: BacSubjectConfig | null = null;
      if (subject === ExamSubject.PHILOSOPHIE) {
        cfg = BAC_CONFIG.troncCommun[0];
      } else {
        const spec = specialties.find(
          (s) =>
            BAC_CONFIG.specialties[s as keyof typeof BAC_CONFIG.specialties]?.subject === subject,
        );
        if (spec) cfg = BAC_CONFIG.specialties[spec as keyof typeof BAC_CONFIG.specialties];
      }

      const documentConfig = cfg?.enableDocuments
        ? {
            enableDocuments: cfg.enableDocuments,
            documentTopics: [...(cfg.documentTopics ?? [])],
            documentRatio: cfg.documentRatio ?? 0,
            minDocumentLength: cfg.minDocumentLength ?? 100,
            maxDocuments: cfg.maxDocuments ?? 0,
          }
        : {
            enableDocuments: false,
            documentTopics: [] as string[],
            documentRatio: 0,
            minDocumentLength: 6500,
            maxDocuments: 0,
          };

      const graphicConfig = cfg?.enableGraphics
        ? {
            enableGraphics: cfg.enableGraphics,
            graphicProbability: cfg.graphicProbability ?? 0,
            preferredLibraries: [...(cfg.preferredLibraries ?? [])] as ("apexcharts" | "plotly")[],
            graphicTypes: [...(cfg.graphicTypes ?? [])] as ("2d" | "3d")[],
          }
        : undefined;

      return {
        subject,
        isCompleted: false,
        documentConfig,
        graphicConfig,
      };
    }),
    metadata: {
      startedAt: new Date(),
      estimatedTotalTime: calculateBacTotalDuration(specialties),
    },
  };
}

/**
 * Génère la requête pour la matière courante du Bac
 */
export function generateBacSubjectRequest(
  config: SequentialQuizConfig,
  userId: string,
  workspaceIds?: string[],
): QuizGenerationRequest {
  const currentSubject = config.subjects[config.currentSubjectIndex];
  let subjectConfig: BacSubjectConfig;

  // Déterminer la configuration selon le type de matière
  if (currentSubject === ExamSubject.PHILOSOPHIE) {
    subjectConfig = BAC_CONFIG.troncCommun[0];
  } else if (currentSubject === ExamSubject.GRAND_ORAL) {
    subjectConfig = BAC_CONFIG.grandOral;
  } else {
    // Spécialité
    const specialty = config.specialties?.find(
      (s) =>
        BAC_CONFIG.specialties[s as keyof typeof BAC_CONFIG.specialties]?.subject ===
        currentSubject,
    );
    if (!specialty) {
      throw new Error(`Spécialité introuvable pour la matière: ${currentSubject}`);
    }
    subjectConfig = BAC_CONFIG.specialties[specialty as keyof typeof BAC_CONFIG.specialties];
  }

  // Configuration documentaire pour cette matière (si elle existe)
  const documentConfig = subjectConfig.enableDocuments
    ? {
        enableDocuments: subjectConfig.enableDocuments,
        documentTopics: [...(subjectConfig.documentTopics ?? [])],
        documentRatio: subjectConfig.documentRatio ?? 0,
        minDocumentLength: subjectConfig.minDocumentLength ?? 100,
        maxDocuments: subjectConfig.maxDocuments ?? 0,
      }
    : {
        enableDocuments: false,
        documentTopics: [] as string[],
        documentRatio: 0,
        minDocumentLength: 100,
        maxDocuments: 0,
      };

  const graphicConfig = subjectConfig.enableGraphics
    ? {
        enableGraphics: subjectConfig.enableGraphics,
        graphicProbability: subjectConfig.graphicProbability ?? 0,
        preferredLibraries: [...(subjectConfig.preferredLibraries ?? [])] as (
          | "apexcharts"
          | "plotly"
        )[],
        graphicTypes: [...(subjectConfig.graphicTypes ?? [])] as ("2d" | "3d")[],
      }
    : {
        enableGraphics: false,
        graphicProbability: 0,
        preferredLibraries: [] as ("apexcharts" | "plotly")[],
        graphicTypes: [] as ("2d" | "3d")[],
      };

  return {
    userId,
    schoolLevel: SchoolLevel.LYCEE_TERMINALE,
    lyceeSpecialties: config.specialties,
    questionTypes: [...subjectConfig.questionTypes],
    questionCount: subjectConfig.questionCount,
    preset: QuizPreset.BAC,
    sequentialConfig: config,
    specificSubject: currentSubject,
    workspaceIds,
    title: `Baccalauréat - ${getSubjectDisplayName(currentSubject)}`,
    description: `${subjectConfig.description} - Durée: ${subjectConfig.duration} min - Coefficient: ${subjectConfig.coefficient}`,
    // NOUVEAU : Configuration documentaire pour utiliser le système Assistant avec documents
    documentConfig,
    graphicConfig,
  };
}

/**
 * Génère les prompts spécialisés pour chaque épreuve du Bac
 */
export function getBacPrompt(subject: ExamSubject, specialties?: LyceeSpecialty[]): string {
  const baseContext = `
Tu es un expert concepteur de sujets pour le Baccalauréat général (réforme 2021).
L'élève est en Terminale et se prépare aux épreuves officielles finales du Baccalauréat.

CONSIGNES GÉNÉRALES BACCALAURÉAT :
- Respecte rigoureusement la structure et les exigences officielles du Bac 2024
- Adapte le niveau et la complexité aux standards de Terminale
- Privilégie l'analyse, la synthèse et l'argumentation de haut niveau
- Évalue les compétences disciplinaires spécialisées
- Assure une progressivité dans la difficulté des questions
- Intègre les enjeux contemporains et la culture générale

IMPORTANT : Génère des questions de niveau officiel Baccalauréat avec barèmes et coefficients réels.
`;

  switch (subject) {
    case ExamSubject.PHILOSOPHIE:
      return `${baseContext}

ÉPREUVE DE PHILOSOPHIE - BACCALAURÉAT (4h, coefficient 8)

STRUCTURE OFFICIELLE OBLIGATOIRE :
- Dissertation (2 sujets au choix) OU Explication de texte (1 texte imposé)
- Programme officiel : 17 notions (La conscience, L'inconscient, La perception, Autrui, Le désir, L'existence et le temps, etc.)

COMPÉTENCES PHILOSOPHIQUES À ÉVALUER :
- Capacité de problématisation rigoureuse (identifier les enjeux, formuler la question)
- Maîtrise conceptuelle précise (définitions, distinctions, articulations logiques)
- Argumentation philosophique structurée (thèse, antithèse, synthèse ou dépassement)
- Culture philosophique mobilisée (références aux auteurs du programme)
- Expression écrite de haut niveau (style, vocabulaire, clarté de l'exposition)

EXIGENCES SPÉCIFIQUES TERMINALE :
- Questions ouvertes nécessitant réflexion personnelle et argumentée
- Mobilisation explicite des auteurs du programme (Platon, Aristote, Descartes, Kant, etc.)
- Problématisation authentique (pas de récitation de cours)
- Exemples variés tirés de l'expérience, des sciences, des arts
- Progression logique et rigoureuse de la pensée
- Capacité de nuance et d'esprit critique

BARÈME PHILOSOPHIE :
- Compréhension du sujet et problématisation (4-5 points)
- Qualité de l'argumentation et culture philosophique (8-10 points)
- Expression et construction (3-5 points)`;

    case ExamSubject.MATHEMATIQUES_SPECIALITE:
      return `${baseContext}

ÉPREUVE DE SPÉCIALITÉ MATHÉMATIQUES - BACCALAURÉAT (4h, coefficient 16)

PROGRAMME TERMINALE OBLIGATOIRE :
- Suites numériques (convergence, récurrence, limites)
- Limites de fonctions et continuité
- Dérivation (calculs, variations, optimisation)
- Fonction logarithme népérien et exponentielle
- Primitives et calcul intégral (intégrales définies, aires)
- Géométrie dans l'espace (vecteurs, équations, volumes)
- Probabilités conditionnelles et loi des grands nombres
- Variables aléatoires réelles (lois, espérance, variance)

COMPÉTENCES MATHÉMATIQUES À ÉVALUER :
- Raisonnement mathématique rigoureux et démonstrations structurées
- Maîtrise des calculs et techniques opératoires (dérivées, intégrales, limites)
- Modélisation mathématique de situations concrètes
- Utilisation pertinente d'outils numériques (calculatrice, logiciels)
- Capacité d'abstraction et de généralisation
- Communication mathématique précise (notations, rédaction)

EXIGENCES SPÉCIFIQUES TERMINALE :
- Exercices progressifs du technique vers le conceptuel
- Problèmes de modélisation avec contexte réel (sciences, économie, société)
- Questions ouvertes nécessitant prise d'initiative
- Démonstrations partielles ou complètes selon le niveau
- Utilisation du raisonnement par récurrence quand approprié
- Analyse critique des résultats obtenus

STRUCTURE TYPE BAC MATHS :
- 3 à 4 exercices indépendants (notation sur 20)
- Barème équilibré : techniques (40%) + raisonnement (40%) + communication (20%)
- Progression du niveau dans chaque exercice`;

    case ExamSubject.PHYSIQUE_CHIMIE_SPECIALITE:
      return `${baseContext}

ÉPREUVE DE SPÉCIALITÉ PHYSIQUE-CHIMIE - BACCALAURÉAT (3h30, coefficient 16)

Programme de Terminale :
Physique : Mécanique, thermodynamique, ondes, relativité restreinte
Chimie : Transformations chimiques, synthèse organique, spectroscopie

Génère des questions qui évaluent :
- Démarche expérimentale et protocoles
- Modélisation physique
- Calculs et applications numériques
- Analyse de documents scientifiques
- Synthèse et argumentation scientifique

Utilise des situations concrètes et des données expérimentales réelles.`;

    case ExamSubject.SVT_SPECIALITE:
      return `${baseContext}

ÉPREUVE DE SPÉCIALITÉ SVT - BACCALAURÉAT (3h30, coefficient 16)

Programme de Terminale :
- Génétique et évolution
- À la recherche du passé géologique
- De la plante sauvage à la plante domestiquée
- Les climats de la Terre

Structure : QCM (8 points) + 2 exercices de synthèse (12 points)

Génère des questions qui évaluent :
- Connaissances scientifiques
- Analyse de documents (graphiques, images, textes)
- Démarche expérimentale
- Capacité de synthèse
- Argumentation scientifique

Privilégie l'analyse de données et les exemples concrets.`;

    case ExamSubject.SES_SPECIALITE:
      return `${baseContext}

ÉPREUVE DE SPÉCIALITÉ SES - BACCALAURÉAT (4h, coefficient 16)

Programme de Terminale :
- Croissance, fluctuations et crises
- Mondialisation, finance et intégration européenne
- Travail, emploi, chômage
- Structure sociale et inégalités
- Action publique et démocratie

Structure : Dissertation OU étude de document

Génère des questions qui évaluent :
- Maîtrise des concepts économiques et sociologiques
- Analyse de documents (graphiques, textes, données)
- Argumentation structurée
- Mobilisation de connaissances
- Esprit critique

Utilise des données statistiques récentes et des exemples d'actualité.`;

    case ExamSubject.HGGSP:
      return `${baseContext}

ÉPREUVE DE SPÉCIALITÉ HGGSP - BACCALAURÉAT (4h, coefficient 16)

Programme de Terminale :
- De nouveaux espaces de conquête
- Faire la guerre, faire la paix
- Histoire et mémoires
- Identifier, protéger et valoriser le patrimoine
- L'environnement
- L'enjeu de la connaissance

Structure : Dissertation OU étude critique de documents

Génère des questions qui évaluent :
- Analyse géopolitique
- Maîtrise des enjeux contemporains
- Mobilisation des connaissances historiques
- Analyse critique de sources
- Argumentation géopolitique

Privilégie les enjeux contemporains et les cas d'étude concrets.`;

    case ExamSubject.NSI_SPECIALITE:
      return `${baseContext}

ÉPREUVE DE SPÉCIALITÉ NSI - BACCALAURÉAT (3h30, coefficient 16)

Programme de Terminale :
- Structures de données (listes, piles, files, arbres)
- Bases de données
- Architectures matérielles, systèmes d'exploitation et réseaux
- Langages et programmation
- Algorithmique

Structure : 3 exercices pratiques et théoriques

Génère des questions qui évaluent :
- Algorithmique et programmation Python
- Conception de bases de données
- Architecture des systèmes
- Analyse de complexité
- Résolution de problèmes informatiques

Inclus du code Python et des schémas techniques.`;

    case ExamSubject.GRAND_ORAL:
      return `${baseContext}

GRAND ORAL - BACCALAURÉAT (20 min, coefficient 10)

Structure officielle :
1. Présentation d'une question (5 min)
2. Entretien avec le jury (10 min)
3. Échange sur le projet d'orientation (5 min)

Spécialités de l'élève : ${specialties?.join(", ") || "Non spécifiées"}

Génère des questions qui évaluent :
- Maîtrise des spécialités
- Capacité de présentation orale
- Argumentation et débat
- Projet d'orientation
- Transversalité entre spécialités

Questions transversales entre les 2 spécialités choisies.
Format : questions ouvertes permettant un exposé de 5 minutes.`;

    default:
      return `${baseContext}
Génère des questions pour la matière ${subject} adaptées au niveau Baccalauréat.`;
  }
}

/**
 * Calcule la durée totale estimée du Bac
 */
function calculateBacTotalDuration(specialties: LyceeSpecialty[]): number {
  let totalDuration = BAC_CONFIG.troncCommun[0].duration; // Philosophie
  // Grand Oral retiré

  // Ajouter les spécialités
  for (const specialty of specialties) {
    const specialtyConfig =
      BAC_CONFIG.specialties[specialty as keyof typeof BAC_CONFIG.specialties];
    if (specialtyConfig) {
      totalDuration += specialtyConfig.duration;
    }
  }

  return totalDuration;
}

/**
 * Calcule le score global du Baccalauréat
 */
export function calculateBacGlobalScore(config: SequentialQuizConfig): {
  totalScore: number;
  maxScore: number;
  grade: number;
  mention?: string;
} {
  let totalCoefficient = 0;
  let weightedScore = 0;

  for (const result of config.subjectResults) {
    if (result.score !== undefined && result.maxScore !== undefined) {
      let coefficient: number;

      if (result.subject === ExamSubject.PHILOSOPHIE) {
        coefficient = BAC_CONFIG.troncCommun[0].coefficient;
      } else if (result.subject === ExamSubject.GRAND_ORAL) {
        coefficient = BAC_CONFIG.grandOral.coefficient;
      } else {
        // Spécialité - coefficient 16
        coefficient = 16;
      }

      const subjectGrade = (result.score / result.maxScore) * 20;
      weightedScore += subjectGrade * coefficient;
      totalCoefficient += coefficient;
    }
  }

  const grade = totalCoefficient > 0 ? weightedScore / totalCoefficient : 0;

  let mention: string | undefined;
  if (grade >= 16) mention = "Très bien";
  else if (grade >= 14) mention = "Bien";
  else if (grade >= 12) mention = "Assez bien";

  return {
    totalScore: Math.round(weightedScore),
    maxScore: BAC_CONFIG.totalCoefficient * 20,
    grade: Math.round(grade * 100) / 100,
    mention,
  };
}

/**
 * Retourne le nom d'affichage pour une matière
 */
export function getSubjectDisplayName(subject: ExamSubject): string {
  const names: Record<ExamSubject, string> = {
    [ExamSubject.FRANCAIS]: "Français",
    [ExamSubject.MATHEMATIQUES]: "Mathématiques",
    [ExamSubject.HISTOIRE_GEOGRAPHIE_EMC]: "Histoire-Géographie-EMC",
    [ExamSubject.SCIENCES]: "Sciences (Physique-Chimie et SVT)",
    [ExamSubject.ORAL_BREVET]: "Oral du Brevet",
    [ExamSubject.PHILOSOPHIE]: "Philosophie",
    [ExamSubject.HGGSP]: "Histoire-Géographie, Géopolitique et Sciences Politiques",
    [ExamSubject.HLP]: "Humanités, Littérature et Philosophie",
    [ExamSubject.LLCER]: "Langues, Littératures et Cultures Étrangères",
    [ExamSubject.NSI_SPECIALITE]: "Numérique et Sciences Informatiques",
    [ExamSubject.SI_SPECIALITE]: "Sciences de l'Ingénieur",
    [ExamSubject.SES_SPECIALITE]: "Sciences Économiques et Sociales",
    [ExamSubject.SVT_SPECIALITE]: "Sciences de la Vie et de la Terre",
    [ExamSubject.PHYSIQUE_CHIMIE_SPECIALITE]: "Physique-Chimie",
    [ExamSubject.MATHEMATIQUES_SPECIALITE]: "Mathématiques",
    [ExamSubject.GRAND_ORAL]: "Grand Oral",
  };

  return names[subject] || subject;
}
