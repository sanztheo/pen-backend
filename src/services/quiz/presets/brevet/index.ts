import {
  QuizGenerationRequest,
  SequentialQuizConfig,
  ExamSubject,
  QuizPreset,
  SchoolLevel,
  CollegeGrade,
  QuestionType,
  SubjectGraphicConfig,
} from "../../types.js";

type BrevetSubjectEntry = (typeof BREVET_CONFIG.subjects)[number];
type GraphicEnabledBrevetSubjectEntry = Extract<BrevetSubjectEntry, { enableGraphics: true }>;

function isGraphicEnabledBrevetSubjectEntry(
  cfg: BrevetSubjectEntry | undefined,
): cfg is GraphicEnabledBrevetSubjectEntry {
  return cfg != null && "enableGraphics" in cfg && cfg.enableGraphics === true;
}

// Configuration officielle du Brevet des collèges - Version améliorée
export const BREVET_CONFIG = {
  name: "Diplôme National du Brevet",
  subjects: [
    {
      subject: ExamSubject.FRANCAIS,
      duration: 180, // 3 heures
      points: 100,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE], // 80% ouvertes, 20% QCM
      questionCount: 25, // Augmenté pour un entraînement plus complet
      description: "Analyse de texte, grammaire, rédaction - Format officiel Brevet",
      enableDocuments: true,
      documentTopics: ["litterature", "arts", "renaissance"],
      documentRatio: 0.3, // 30% questions sur documents
      minDocumentLength: 100,
      maxDocuments: 2,
    },
    {
      subject: ExamSubject.MATHEMATIQUES,
      duration: 120, // 2 heures
      points: 100,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE], // 85% ouvertes, 15% QCM
      questionCount: 25, // Augmenté pour couvrir tout le programme
      description: "Exercices et problèmes couvrant le programme complet de cycle 4",
      enableDocuments: false,
      documentTopics: [],
      documentRatio: 0,
      minDocumentLength: 100,
      maxDocuments: 0,
      enableGraphics: true,
      graphicProbability: 0.7,
      preferredLibraries: ["apexcharts", "plotly"],
      graphicTypes: ["2d"],
    },
    {
      subject: ExamSubject.HISTOIRE_GEOGRAPHIE_EMC,
      duration: 120, // 2 heures
      points: 50,
      questionTypes: [QuestionType.OPEN_QUESTION, QuestionType.MULTIPLE_CHOICE], // 70% ouvertes, 30% QCM
      questionCount: 25, // Augmenté pour analyse de documents + repères
      description: "Analyse de documents, repères chronologiques et spatiaux, EMC",
      enableDocuments: true,
      documentTopics: [
        "revolution",
        "guerre",
        "republique",
        "france",
        "europe",
        "decolonisation",
        "geographie",
        "amenagement",
        "metropolisation",
        "citoyennete",
      ],
      documentRatio: 0.5, // 50% questions sur documents
      minDocumentLength: 100,
      maxDocuments: 2,
    },
    {
      subject: ExamSubject.SCIENCES,
      duration: 60, // 1 heure
      points: 50,
      questionTypes: [
        QuestionType.OPEN_QUESTION,
        QuestionType.MULTIPLE_CHOICE,
        QuestionType.TRUE_FALSE,
      ], // 60% ouvertes, 30% QCM, 10% V/F
      questionCount: 25, // Augmenté pour Physique-Chimie + SVT
      description: "Physique-Chimie et SVT - Démarche expérimentale et scientifique",
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
  ],
  totalPoints: 300,
  totalDuration: 480, // 8 heures
  passingGrade: 10,
} as const;

/**
 * Génère une configuration séquentielle pour le Brevet
 */
export function createBrevetSequentialConfig(
  userId: string,
  collegeGrade: CollegeGrade = CollegeGrade.TROISIEME,
): SequentialQuizConfig {
  const subjects = BREVET_CONFIG.subjects.map((s) => s.subject);

  return {
    id: `brevet_${userId}_${Date.now()}`,
    preset: QuizPreset.BREVET,
    subjects,
    currentSubjectIndex: 0,
    totalSubjects: subjects.length,
    isCompleted: false,
    subjectResults: subjects.map((subject) => {
      const cfg = BREVET_CONFIG.subjects.find((s) => s.subject === subject);
      const documentConfig = cfg
        ? {
            enableDocuments: cfg.enableDocuments,
            documentTopics: Array.isArray(cfg.documentTopics) ? [...cfg.documentTopics] : [],
            documentRatio: cfg.documentRatio,
            minDocumentLength: cfg.minDocumentLength,
            maxDocuments: cfg.maxDocuments,
          }
        : undefined;
      const graphicConfig = isGraphicEnabledBrevetSubjectEntry(cfg)
        ? {
            enableGraphics: cfg.enableGraphics,
            graphicProbability: cfg.graphicProbability,
            preferredLibraries: [...cfg.preferredLibraries],
            graphicTypes: [...cfg.graphicTypes],
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
      estimatedTotalTime: BREVET_CONFIG.totalDuration,
    },
  };
}

/**
 * Génère la requête pour la matière courante du Brevet
 */
export function generateBrevetSubjectRequest(
  config: SequentialQuizConfig,
  userId: string,
  workspaceIds?: string[],
): QuizGenerationRequest {
  const currentSubject = config.subjects[config.currentSubjectIndex];
  const subjectConfig = BREVET_CONFIG.subjects.find((s) => s.subject === currentSubject);

  if (!subjectConfig) {
    throw new Error(`Configuration introuvable pour la matière: ${currentSubject}`);
  }

  // Configuration documentaire pour cette matière
  const documentConfig = {
    enableDocuments: subjectConfig.enableDocuments,
    documentTopics: [...subjectConfig.documentTopics],
    documentRatio: subjectConfig.documentRatio,
    minDocumentLength: subjectConfig.minDocumentLength,
    maxDocuments: subjectConfig.maxDocuments,
  };

  const graphicConfig: SubjectGraphicConfig = isGraphicEnabledBrevetSubjectEntry(subjectConfig)
    ? {
        enableGraphics: subjectConfig.enableGraphics,
        graphicProbability: subjectConfig.graphicProbability,
        preferredLibraries: [...subjectConfig.preferredLibraries],
        graphicTypes: [...subjectConfig.graphicTypes],
      }
    : {
        enableGraphics: false,
        graphicProbability: 0,
        preferredLibraries: [],
        graphicTypes: [],
      };

  return {
    userId,
    schoolLevel: SchoolLevel.COLLEGE,
    collegeGrade: CollegeGrade.TROISIEME,
    questionTypes: [...subjectConfig.questionTypes],
    questionCount: subjectConfig.questionCount,
    preset: QuizPreset.BREVET,
    sequentialConfig: config,
    specificSubject: currentSubject,
    workspaceIds,
    title: `Brevet - ${getSubjectDisplayName(currentSubject)}`,
    description: `${subjectConfig.description} - Durée: ${subjectConfig.duration} min - Points: ${subjectConfig.points}`,
    documentConfig,
    graphicConfig,
  };
}

/**
 * Génère les prompts spécialisés améliorés pour chaque matière du Brevet
 */
export function getBrevetPrompt(
  subject: ExamSubject,
  collegeGrade: CollegeGrade = CollegeGrade.TROISIEME,
): string {
  const gradeLevel = getGradeLevelContext(collegeGrade);

  const baseContext = `
Tu es un concepteur expert de sujets officiels pour le Diplôme National du Brevet (DNB).
Tu dois créer un sujet d'entraînement fidèle aux vrais examens du Brevet.

ÉLÈVE CIBLE : ${gradeLevel}
OBJECTIF : Préparation optimale aux épreuves officielles du DNB

═══════════════════════════════════════════════════════════════════════════════
🎯 DIRECTIVES ABSOLUES DE CONCEPTION
═══════════════════════════════════════════════════════════════════════════════

📋 STRUCTURE OBLIGATOIRE DU QUIZ :
- ORGANISE le quiz en EXACTEMENT 3 GRANDS THÈMES de la matière
- Chaque thème doit contenir plusieurs questions qui se suivent logiquement
- Les questions d'un même thème doivent être progressives (facile → intermédiaire → difficile)
- Assure une cohérence pédagogique entre les questions du même thème

📝 RÉPARTITION DES TYPES DE QUESTIONS (PRIORITÉ ABSOLUE) :
- 🟢 80-85% de QUESTIONS OUVERTES (réponse libre, développement, analyse)
- 🟡 15-20% de QCM (choix multiples) uniquement pour vérifier des connaissances précises
- 🔴 0-5% MAXIMUM de Vrai/Faux (seulement si absolument pertinent)
- ❌ INTERDICTION TOTALE des questions de correspondance/matching

✍️ FORMAT ET CONSIGNES :
- Rédige des consignes claires et professionnelles comme dans un vrai sujet officiel
- Utilise un vocabulaire adapté au niveau collège mais précis
- Chaque question doit avoir un barème indicatif réaliste
- Intègre des situations concrètes et contextualisées
- Respecte la progression pédagogique officielle du cycle 4

🎯 QUALITÉ ATTENDUE :
- Niveau d'exigence conforme aux vrais sujets du Brevet
- Questions stimulantes mais accessibles aux élèves de 3ème
- Évaluation équilibrée des compétences attendues
- Préparation efficace aux conditions réelles d'examen

═══════════════════════════════════════════════════════════════════════════════
`;

  switch (subject) {
    case ExamSubject.FRANCAIS:
      return `${baseContext}

🇫🇷 ÉPREUVE DE FRANÇAIS - BREVET (3h, 100 points)

📚 LES 3 GRANDS THÈMES OBLIGATOIRES À COUVRIR :

🎭 THÈME 1 : COMPRÉHENSION ET ANALYSE LITTÉRAIRE (8-10 questions)
Analyse d'un texte littéraire (extrait de roman, nouvelle, poésie, théâtre)
- Questions de compréhension littérale et globale
- Analyse des procédés littéraires et de leurs effets
- Interprétation et mise en perspective
- Vocabulaire et registres de langue

📝 THÈME 2 : ÉTUDE DE LA LANGUE (6-8 questions)
Grammaire, orthographe, conjugaison appliquées au texte étudié
- Classes grammaticales et fonctions syntaxiques
- Analyse de phrases complexes
- Valeurs des temps et modes
- Formation des mots et étymologie

✍️ THÈME 3 : EXPRESSION ÉCRITE ET RÉDACTION (6-7 questions)
Préparation à la rédaction et méthodologie
- Techniques narratives et descriptives
- Argumentation et organisation des idées
- Enrichissement du vocabulaire
- Révision et amélioration de textes

═══════════════════════════════════════════════════════════════════════════════
📋 INSTRUCTIONS DÉTAILLÉES DE CONCEPTION

🎯 POUR CHAQUE THÈME :
1. Commence par 2-3 questions plus accessibles pour mettre en confiance
2. Progresse vers des questions d'analyse plus complexes
3. Termine par 1-2 questions de synthèse ou d'interprétation

📝 TYPES DE QUESTIONS À PRIVILÉGIER (80-85% du total) :
• "Expliquez pourquoi l'auteur utilise cette métaphore..."
• "Rédigez un paragraphe dans lequel vous analyserez..."
• "Justifiez votre réponse en vous appuyant sur des éléments précis du texte"
• "Développez votre interprétation en citant le texte"
• "Réécrivez ce passage en changeant le point de vue narratif"

🎯 QCM AUTORISÉS (15-20% maximum) :
Uniquement pour vérifier des connaissances précises :
• Classes grammaticales, fonctions syntaxiques
• Figures de style, genre littéraire
• Repères chronologiques et auteurs au programme

✍️ CONSIGNES TYPE À UTILISER :
- "Dans un développement organisé de 5 à 10 lignes, vous expliquerez..."
- "En vous appuyant sur des exemples précis tirés du texte..."
- "Justifiez votre réponse par au moins deux arguments développés"
- "Rédigez votre réponse en soignant l'expression et l'orthographe"

🎭 RÉFÉRENCES AU PROGRAMME CYCLE 4 :
- Questionnements : Se chercher, se construire / Vivre en société / Regarder le monde
- Genres : Roman d'apprentissage, théâtre, poésie lyrique, nouvelle réaliste
- Registres : comique, tragique, pathétique, épique
- Objets d'étude : La fiction pour interroger le réel, La poésie du romantisme au surréalisme

⚠️ EXIGENCES QUALITÉ :
- Barème réaliste (entre 1 et 6 points par question selon complexité)
- Consignes claires et précises comme dans les vrais sujets
- Progression pédagogique respectée
- Ancrage dans la littérature française et francophone
`;

    case ExamSubject.MATHEMATIQUES:
      return `${baseContext}

🔢 ÉPREUVE DE MATHÉMATIQUES - BREVET (2h, 100 points)

📊 LES 3 GRANDS THÈMES OBLIGATOIRES À COUVRIR :

➕ THÈME 1 : NOMBRES, CALCULS ET FONCTIONS (6-8 questions)
Calcul numérique, littéral et fonctions
- Fractions, puissances, racines carrées, développement et factorisation
- Équations et inéquations du premier degré
- Fonctions linéaires et affines, représentations graphiques
- Problèmes de proportionnalité et pourcentages

📐 THÈME 2 : GÉOMÉTRIE ET GRANDEURS (6-7 questions)
Configurations géométriques et mesures
- Théorème de Pythagore et sa réciproque
- Trigonométrie dans le triangle rectangle
- Transformations géométriques (translations, rotations, homothéties)
- Aires, volumes et sections de solides

📈 THÈME 3 : GESTION DE DONNÉES ET ALGORITHMIQUE (5-6 questions)
Statistiques, probabilités et programmation
- Moyennes, médianes, quartiles, diagrammes statistiques
- Probabilités simples et expériences aléatoires
- Algorithmique et programmation (Scratch/Python) - OBLIGATOIRE
- Interprétation de graphiques et tableaux

═══════════════════════════════════════════════════════════════════════════════
📋 INSTRUCTIONS DÉTAILLÉES DE CONCEPTION

🎯 POUR CHAQUE THÈME :
1. Démarre par des calculs directs pour vérifier les techniques
2. Progresse vers des problèmes concrets de modélisation
3. Termine par des exercices de synthèse nécessitant plusieurs étapes

📝 TYPES DE QUESTIONS À PRIVILÉGIER (85% du total) :
• "Calculez et détaillez votre démarche..."
• "Résolvez le problème suivant en expliquant chaque étape"
• "Démontrez que... en justifiant votre raisonnement"
• "Modélisez la situation par une équation puis résolvez"
• "Construisez la figure et calculez la mesure demandée"
• "Rédigez un algorithme qui permet de..."

🎯 QCM AUTORISÉS (15% maximum) :
Uniquement pour vérifier des connaissances techniques :
• Propriétés géométriques, formules d'aires et volumes
• Vocabulaire mathématique (médiane, fonction, etc.)
• Lecture graphique directe

✍️ CONSIGNES TYPE À UTILISER :
- "Tous les calculs doivent être détaillés"
- "Justifiez chaque étape de votre raisonnement"
- "Rédigez votre réponse avec soin, en utilisant le vocabulaire mathématique approprié"
- "Vérifiez la cohérence de votre résultat"
- "La qualité de la rédaction et la présentation seront prises en compte"

🔧 EXEMPLES DE PROBLÈMES CONCRETS :
- Calculs d'économies d'énergie, facturations, taux d'évolution
- Modélisations géométriques (architecture, construction, sport)
- Études statistiques (sondages, enquêtes, données réelles)
- Problèmes d'optimisation et de logique

💻 ALGORITHMIQUE OBLIGATOIRE :
- Au moins 1 exercice complet d'algorithmique
- Utilisation de Scratch ou Python
- Variables, boucles, conditions, fonctions simples
- Résolution de problèmes par programmation

⚠️ EXIGENCES QUALITÉ :
- Barème détaillé : méthode (60%) + résultat (40%)
- Exercices progressifs et indépendants
- Situations concrètes et motivantes
- Respect des niveaux d'abstraction du cycle 4
- Préparation aux exigences du lycée
`;

    case ExamSubject.HISTOIRE_GEOGRAPHIE_EMC:
      return `${baseContext}

🌍 ÉPREUVE HISTOIRE-GÉOGRAPHIE-EMC - BREVET (2h, 50 points)

📚 LES 3 GRANDS THÈMES OBLIGATOIRES À COUVRIR :

📜 THÈME 1 : ANALYSE DE DOCUMENTS (6-7 questions)
Étude critique de sources historiques et géographiques
- Présentation et contexte des documents (nature, auteur, date, destinataire)
- Prélèvement d'informations précises dans les documents
- Analyse critique : intérêts et limites des sources
- Confrontation de points de vue et mise en perspective

🗺️ THÈME 2 : REPÈRES ET CONNAISSANCES (6-7 questions)
Maîtrise des repères chronologiques et spatiaux
- Dates clés du XXe siècle (guerres mondiales, décolonisation, construction européenne)
- Localisation précise (capitales, métropoles, États, régions)
- Vocabulaire spécialisé en histoire et géographie
- Acteurs historiques et géographiques majeurs

🏛️ THÈME 3 : CITOYENNETÉ ET EMC (4-5 questions)
Enseignement moral et civique appliqué
- Valeurs et principes républicains français
- Institutions politiques françaises et européennes
- Droits et devoirs du citoyen
- Enjeux démocratiques contemporains

═══════════════════════════════════════════════════════════════════════════════
📋 INSTRUCTIONS DÉTAILLÉES DE CONCEPTION

🎯 POUR CHAQUE THÈME :
1. Commence par identifier et présenter les documents ou repères
2. Progresse vers l'analyse et la contextualisation
3. Termine par la synthèse et l'interprétation critique

📝 TYPES DE QUESTIONS À PRIVILÉGIER (70-75% du total) :
• "Présentez le document en précisant sa nature, son auteur et sa date"
• "Expliquez pourquoi l'auteur affirme que..."
• "Analysez l'évolution présentée dans le graphique entre... et..."
• "Rédigez un développement construit montrant que..."
• "En vous appuyant sur vos connaissances et les documents, expliquez..."
• "Quelle est la portée historique de cet événement ?"

🎯 QCM AUTORISÉS (25-30% maximum) :
Pour vérifier des connaissances factuelles précises :
• Dates, personnages, lieux historiques
• Définitions de concepts géographiques
• Institutions politiques et valeurs républicaines
• Lecture de cartes et graphiques simples

✍️ CONSIGNES TYPE À UTILISER :
- "Dans un développement organisé d'une dizaine de lignes..."
- "En vous appuyant sur des exemples précis..."
- "Justifiez votre réponse en citant les documents"
- "Replacez cet événement dans son contexte historique"
- "Montrez l'évolution de la situation entre... et..."

📊 TYPES DE DOCUMENTS À INTÉGRER :
- Textes d'époque (discours, témoignages, extraits de presse)
- Cartes géographiques et historiques variées
- Photographies d'époque et images satellites
- Graphiques, tableaux statistiques, diagrammes
- Caricatures et affiches de propagande

🎯 PROGRAMME 3ème À RESPECTER :

HISTOIRE :
- Le monde depuis 1945 : Guerre froide, décolonisation, construction européenne
- Françaises et Français dans une République repensée (depuis 1958)
- Enjeux et conflits contemporains

GÉOGRAPHIE :
- Dynamiques territoriales de la France contemporaine
- Pourquoi et comment aménager le territoire français ?
- La France et l'Union européenne

EMC :
- Valeurs et principes de la République française
- Citoyenneté française et citoyenneté européenne
- Les institutions : démocratie et République

⚠️ EXIGENCES QUALITÉ :
- Documents authentiques et récents quand pertinent
- Questions progressives du simple vers le complexe
- Vocabulaire spécialisé approprié au niveau 3ème
- Liens explicites entre histoire, géographie et actualité
- Préparation aux méthodes du lycée (analyse de documents)
`;

    case ExamSubject.SCIENCES:
      return `${baseContext}

🔬 ÉPREUVE DE SCIENCES - BREVET (1h, 50 points)

🧪 LES 3 GRANDS THÈMES OBLIGATOIRES À COUVRIR :

⚗️ THÈME 1 : PHYSIQUE-CHIMIE (5-6 questions)
Constitution et transformations de la matière, énergie
- Constitution et transformation de la matière (atomes, molécules, réactions)
- Mouvements et interactions (forces, vitesse, poids et masse)
- Énergie et ses conversions (électrique, mécanique, thermique)
- Signaux pour observer et communiquer (ondes, lumière, son)

🌱 THÈME 2 : SCIENCES DE LA VIE ET DE LA TERRE (5-6 questions)
Vivant et environnement
- Corps humain et santé (nutrition, reproduction, système nerveux)
- Planète Terre, environnement et action humaine (climats, ressources)
- Le vivant et son évolution (classification, génétique, sélection naturelle)
- Enjeux écologiques contemporains et développement durable

🔍 THÈME 3 : DÉMARCHE SCIENTIFIQUE ET EXPÉRIMENTATION (4-5 questions)
Méthodes et raisonnement scientifiques
- Analyse de protocoles expérimentaux et résultats
- Schémas fonctionnels et légendés
- Calculs scientifiques simples et conversions d'unités
- Argumentation scientifique et esprit critique

═══════════════════════════════════════════════════════════════════════════════
📋 INSTRUCTIONS DÉTAILLÉES DE CONCEPTION

🎯 POUR CHAQUE THÈME :
1. Démarre par l'observation de phénomènes concrets
2. Progresse vers l'analyse et l'interprétation scientifique
3. Termine par l'application et la mise en perspective

📝 TYPES DE QUESTIONS À PRIVILÉGIER (60-65% du total) :
• "Expliquez le phénomène observé dans l'expérience..."
• "Analysez les résultats présentés dans le graphique et concluez"
• "Décrivez le protocole permettant de vérifier cette hypothèse"
• "Justifiez scientifiquement pourquoi..."
• "Rédigez un compte-rendu d'expérience en expliquant..."
• "Proposez une explication scientifique à ce phénomène"

🎯 QCM ET VRAI/FAUX AUTORISÉS (35-40% maximum) :
Pour vérifier des connaissances scientifiques précises :
• Vocabulaire scientifique spécialisé
• Formules et unités de mesure
• Classification et propriétés de la matière
• Fonctions biologiques et anatomie

✍️ CONSIGNES TYPE À UTILISER :
- "En vous appuyant sur vos connaissances scientifiques, expliquez..."
- "Décrivez précisément en utilisant le vocabulaire scientifique approprié"
- "Analysez les documents et tirez-en une conclusion argumentée"
- "Proposez une hypothèse puis un protocole pour la vérifier"
- "Rédigez votre réponse en justifiant par des arguments scientifiques"

🔬 TYPES DE DOCUMENTS À INTÉGRER :
- Graphiques de mesures expérimentales réelles
- Schémas fonctionnels et anatomiques
- Photographies d'expériences et de phénomènes naturels
- Tableaux de données et de résultats
- Protocoles expérimentaux détaillés

🧬 EXEMPLES DE CONTEXTES CONCRETS :
- Santé et nutrition (alimentation équilibrée, maladies)
- Environnement et climat (effet de serre, énergies renouvelables)
- Innovations technologiques (smartphones, transports)
- Espace et exploration spatiale
- Médecine et biotechnologies

💡 COMPÉTENCES SCIENTIFIQUES ÉVALUÉES :
- Pratiquer des démarches scientifiques et technologiques
- Concevoir, créer, réaliser (protocoles, schémas)
- S'approprier des outils et des méthodes (calculs, graphiques)
- Pratiquer des langages (vocabulaire, formules, unités)
- Mobiliser des outils numériques (tableaux, simulateurs)

⚠️ EXIGENCES QUALITÉ :
- Questions progressives du descriptif vers l'explicatif
- Situations authentiques et motivantes pour les élèves
- Liens explicites avec les enjeux société/environnement
- Préparation aux démarches scientifiques du lycée
- Équilibre entre les deux disciplines (Physique-Chimie et SVT)
`;

    default:
      return `${baseContext}
Génère des questions pour la matière ${subject} adaptées au niveau Brevet.`;
  }
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

/**
 * Retourne le contexte du niveau de classe
 */
function getGradeLevelContext(grade: CollegeGrade): string {
  const contexts: Record<CollegeGrade, string> = {
    [CollegeGrade.SIXIEME]: "6ème (transition primaire-collège, vocabulaire simple)",
    [CollegeGrade.CINQUIEME]: "5ème (consolidation des bases, vocabulaire technique)",
    [CollegeGrade.QUATRIEME]: "4ème (concepts abstraits, raisonnement complexe)",
    [CollegeGrade.TROISIEME]: "3ème (préparation Brevet, synthèse du cycle 4)",
  };

  return contexts[grade];
}

/**
 * Calcule le score global du Brevet
 */
export function calculateBrevetGlobalScore(config: SequentialQuizConfig): {
  totalScore: number;
  maxScore: number;
  grade: number;
  mention?: string;
} {
  const totalScore = config.subjectResults.reduce((sum, result) => sum + (result.score || 0), 0);
  const maxScore = BREVET_CONFIG.totalPoints;
  const grade = (totalScore / maxScore) * 20;

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
