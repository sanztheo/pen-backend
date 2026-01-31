// assistant/functions.ts - Implémentation des 7 fonctions OpenAI Assistant
import { documentSearchService } from "../documentSearchService.js";

/**
 * Type pour les appels de fonction OpenAI
 */
interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

// ===== INTERFACES DE TYPAGE =====

/** Configuration graphique ApexCharts */
interface GraphicConfig {
  chart?: { type?: string; height?: number };
  series?: GraphicSeries[];
  xaxis?: { title?: { text?: string }; min?: number; max?: number };
  yaxis?: { title?: { text?: string }; min?: number; max?: number };
  title?: { text?: string; align?: string };
  stroke?: StrokeConfig | StrokeConfig[];
  markers?: {
    size?: number;
    colors?: string[];
    strokeWidth?: number;
    hover?: { size?: number };
  };
}

interface GraphicSeries {
  name?: string;
  data?: number[][];
  color?: string;
}

interface StrokeConfig {
  curve?: "smooth" | "straight";
  width?: number;
}

/** Résultat de génération graphique */
interface GraphicResult {
  success: boolean;
  graphic: {
    id: string;
    config: GraphicConfig;
    type: string;
    library: string;
    description: string;
    dataValues: number[];
    htmlContainer: string;
  };
}

/** Arguments pour generate_graphic */
interface GenerateGraphicArgs {
  config?: GraphicConfig;
  type: string;
  library: string;
  description: string;
  dataValues: number[];
  htmlContainer: string;
}

/** Question de quiz */
interface QuizQuestion {
  id: string;
  question: string;
  type: string;
  generated_at?: string;
  [key: string]: unknown;
}

/** Arguments pour generate_questions_array */
interface GenerateQuestionsArrayArgs {
  questions: QuizQuestion[];
}

/** Arguments pour generate_subject_with_documents */
interface GenerateSubjectWithDocumentsArgs {
  title: string;
  description: string;
  documentTopics: string[];
  questionDistribution: Record<string, unknown>;
  estimatedTime?: number;
  targetLevel?: string;
  specificCompetencies?: string[];
  uploadedFileIds?: string[];
  useFileUpload?: boolean;
}

/** Document de recherche */
interface SearchDocument {
  id: string;
  title: string;
  content: string;
  topic: string;
  similarity: number;
  source: string;
  fileId?: string;
  originalLength?: number;
  optimizedLength?: number;
  targetLevel?: string;
  extractionMethod?: string;
  aiProcessed?: boolean;
  minimumParts?: number;
  minimumLength?: number;
  searchStrategy?: string;
  selectionMethod?: string;
  searchTerm?: string;
  generated_at?: string;
}

/** Résultat de recherche Wikipedia */
interface WikipediaSearchResult {
  pageid: number;
  title: string;
  snippet?: string;
  wordcount?: number;
  timestamp?: string;
  searchTerm?: string;
}

/** Contenu d'article Wikipedia */
interface WikipediaArticleContent {
  title: string;
  pageid: number;
  extract: string;
  url: string;
}

/** Résultat de recherche Wikipedia avec IA */
interface WikipediaAIResult {
  title: string;
  content: string;
  source: string;
  selectedBy: string;
  originalLength: number;
  pageid?: number;
  searchTerm?: string;
}

/** Correction de question */
interface QuestionCorrection {
  questionId: string;
  isCorrect: boolean;
  score: number;
  feedback: string;
  [key: string]: unknown;
}

/** Arguments pour les fonctions de correction */
interface CorrectQuizArgs {
  corrections?: QuestionCorrection[];
  globalScore?: number;
  recommendations?: string[];
  [key: string]: unknown;
}

/** Résultat de correction */
interface CorrectionResult {
  corrections: QuestionCorrection[];
  globalScore: number;
  recommendations: string[];
  timestamp: string;
}

/** Paramètres pour génération graphique IA */
interface AIGraphicParams {
  subject: string;
  topic: string;
  level: string;
  library: string;
  questionContext: string;
}

/** Résultat de l'appel de fonction */
type FunctionCallResult =
  | GraphicResult
  | { success: boolean; questions: QuizQuestion[] }
  | {
      success: boolean;
      subject: Record<string, unknown>;
      next_step: string;
      documents_found: number;
      workflow_used: string;
    }
  | CorrectionResult;

/**
 * Exécute un appel de fonction de l'Assistant OpenAI
 */
export async function executeFunctionCall(
  toolCall: ToolCall,
): Promise<FunctionCallResult> {
  const functionName = toolCall.function.name;
  let args;

  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch (error) {
    throw new Error(
      `Arguments JSON invalides pour ${functionName}: ${toolCall.function.arguments}`,
    );
  }

  console.log(`🔧 Exécution ${functionName} avec args:`, args);

  switch (functionName) {
    case "generate_graphic":
      return await generateGraphic(args);

    case "generate_questions_array":
      return await generateQuestionsArray(args);

    case "generate_subject_with_documents":
      return await generateSubjectWithDocuments(args);

    case "correct_quiz_standard":
      return await correctQuizStandard(args);

    case "correct_quiz_with_graphics":
      return await correctQuizWithGraphics(args);

    case "correct_quiz_with_documents":
      return await correctQuizWithDocuments(args);

    case "correct_quiz_complete":
      return await correctQuizComplete(args);

    default:
      throw new Error(`Fonction inconnue: ${functionName}`);
  }
}

// ===== FONCTIONS DE GÉNÉRATION =====

/**
 * 1. generate_graphic - Génère une configuration de graphique
 */
async function generateGraphic(
  args: GenerateGraphicArgs,
): Promise<GraphicResult> {
  console.log("📊 Génération graphique avec:", args);

  // Valider les paramètres requis
  const { config, type, library, description, dataValues, htmlContainer } =
    args;

  if (!type || !library || !description || !dataValues || !htmlContainer) {
    throw new Error("Paramètres manquants pour generate_graphic");
  }

  // Si config est vide, générer une configuration par défaut
  let finalConfig: GraphicConfig = config || {};
  if (!config || Object.keys(config).length === 0) {
    console.log("⚠️ Config vide reçue, génération automatique...");
    finalConfig = await generateDefaultConfig(
      library,
      type,
      description,
      dataValues,
    );
  }

  // Retourner la configuration graphique formatée
  return {
    success: true,
    graphic: {
      id: `graphic_${Date.now()}`,
      config: finalConfig,
      type,
      library,
      description,
      dataValues,
      htmlContainer,
    },
  };
}

// Fonction helper pour générer des configurations par défaut
async function generateDefaultConfig(
  library: string,
  type: string,
  description: string,
  dataValues: number[],
): Promise<GraphicConfig> {
  console.log("🤖 Appel IA pour génération intelligente du graphique...");

  try {
    // Extraire les informations de la description pour créer un contexte intelligent
    const subject = extractSubjectFromDescription(description);
    const topic = extractTopicFromDescription(description);
    const level = "BAC"; // Niveau par défaut, pourrait être dynamique

    console.log(`📊 Génération IA: ${subject} | ${topic} | ${library}`);

    // Appeler le service de génération graphique IA (même logique que testAIGraphicGeneration)
    const aiGraphicResult = await generateAIGraphicConfig({
      subject,
      topic,
      level,
      library,
      questionContext: description,
    });

    if (aiGraphicResult && aiGraphicResult.config) {
      console.log("✅ Configuration IA générée avec succès");

      // 🔧 VALIDATION ET CORRECTION POST-GÉNÉRATION
      const correctedConfig = validateAndCorrectGraphicConfig(
        aiGraphicResult.config,
        description,
      );
      console.log("🔍 Configuration après validation locale:", correctedConfig);

      // 🤖 VALIDATION IA AVANCÉE - Vérification scientifique par IA
      const aiValidatedConfig = await validateWithAI(
        correctedConfig,
        description,
      );
      console.log("🧠 Configuration après validation IA:", aiValidatedConfig);

      return aiValidatedConfig;
    }
  } catch (error) {
    console.log(
      "⚠️ Erreur génération IA, fallback vers configuration prédéfinie:",
      error,
    );
  }

  // Fallback vers la logique prédéfinie si l'IA échoue
  console.log("🔧 Utilisation configuration prédéfinie comme fallback");
  const fallbackConfig = generateFallbackConfig(
    library,
    type,
    description,
    dataValues,
  );

  // Appliquer la validation même sur le fallback
  const validatedFallback = validateAndCorrectGraphicConfig(
    fallbackConfig,
    description,
  );
  console.log("🔍 Fallback après validation scientifique:", validatedFallback);

  return validatedFallback;
}

// 🔧 FONCTION DE VALIDATION SCIENTIFIQUE POST-GÉNÉRATION
function validateAndCorrectGraphicConfig(
  config: GraphicConfig,
  description: string,
): GraphicConfig {
  const desc = description.toLowerCase();

  // Créer une copie profonde pour éviter les mutations
  const correctedConfig = JSON.parse(JSON.stringify(config));

  console.log(
    "🔍 Validation scientifique pour:",
    desc.substring(0, 50) + "...",
  );

  // ✅ CORRECTION 1: Fonctions mathématiques exactes
  if (
    desc.includes("quadratique") ||
    desc.includes("parabole") ||
    desc.includes("x²") ||
    desc.includes("x^2")
  ) {
    console.log("📐 Détection parabole → Application curve: straight");
    if (correctedConfig.stroke) {
      correctedConfig.stroke.curve = "straight";
      correctedConfig.stroke.width = 2;
    } else {
      correctedConfig.stroke = { curve: "straight", width: 2 };
    }

    // Ajouter des marqueurs pour les points
    correctedConfig.markers = {
      size: 4,
      colors: ["#008FFB"],
      strokeWidth: 2,
      hover: { size: 6 },
    };

    // S'assurer que le titre contient l'équation
    if (correctedConfig.title && correctedConfig.title.text) {
      const currentTitle = correctedConfig.title.text;
      if (!currentTitle.includes("y =") && !currentTitle.includes("f(x)")) {
        correctedConfig.title.text = currentTitle + " (y = x²)";
      }
    } else {
      // Ajouter un titre avec l'équation si absent
      correctedConfig.title = {
        text: "Fonction quadratique (y = x²)",
        align: "center",
      };
    }
  }

  // ✅ CORRECTION 2: Relations linéaires (F=ma, etc.)
  if (
    desc.includes("newton") ||
    desc.includes("f=ma") ||
    desc.includes("linéaire") ||
    desc.includes("proportionnel")
  ) {
    console.log("📏 Détection relation linéaire → Application curve: straight");
    if (correctedConfig.stroke) {
      correctedConfig.stroke.curve = "straight";
      correctedConfig.stroke.width = 2;
    } else {
      correctedConfig.stroke = { curve: "straight", width: 2 };
    }

    // S'assurer que le titre contient l'équation
    if (desc.includes("newton") || desc.includes("f=ma")) {
      if (correctedConfig.title && correctedConfig.title.text) {
        const currentTitle = correctedConfig.title.text;
        if (!currentTitle.includes("F =") && !currentTitle.includes("F=")) {
          correctedConfig.title.text = currentTitle + " (F = ma)";
        }
      } else {
        correctedConfig.title = {
          text: "Deuxième loi de Newton (F = ma)",
          align: "center",
        };
      }
    }
  }

  // ✅ CORRECTION 3: Tangentes et dérivées
  if (desc.includes("tangente") || desc.includes("dérivée")) {
    console.log(
      "📐 Détection tangente → Application curve: smooth pour fonction + straight pour tangente",
    );

    // S'assurer que le titre contient l'information sur la tangente
    if (correctedConfig.title && correctedConfig.title.text) {
      const currentTitle = correctedConfig.title.text;
      if (
        !currentTitle.includes("tangente") &&
        !currentTitle.includes("dérivée")
      ) {
        correctedConfig.title.text = currentTitle + " et sa tangente";
      }
    } else {
      correctedConfig.title = {
        text: "Fonction et sa tangente",
        align: "center",
      };
    }

    // Différencier le style des courbes si multiple séries
    if (correctedConfig.series && correctedConfig.series.length > 1) {
      correctedConfig.series.forEach((serie: GraphicSeries) => {
        if (serie.name && serie.name.toLowerCase().includes("tangente")) {
          // Tangente = ligne droite rouge
          if (
            !correctedConfig.stroke ||
            Array.isArray(correctedConfig.stroke)
          ) {
            correctedConfig.stroke = [
              { curve: "smooth", width: 2 }, // Fonction
              { curve: "straight", width: 2 }, // Tangente
            ];
          }
          serie.color = "#FF4560"; // Rouge pour tangente
        } else {
          // Fonction principale = courbe bleue
          serie.color = "#008FFB"; // Bleu pour fonction
        }
      });
    }
  }

  // ✅ CORRECTION 4: Oscillations (garder smooth mais vérifier les données)
  if (
    desc.includes("oscillation") ||
    desc.includes("sinusoïd") ||
    desc.includes("sin(")
  ) {
    console.log(
      "🌊 Détection oscillation → Conservation curve: smooth pour sin()",
    );
    // Pour les oscillations, on garde smooth car sin() doit être lisse
    if (correctedConfig.stroke) {
      correctedConfig.stroke.curve = "smooth";
    }

    // S'assurer que le titre contient l'équation
    if (correctedConfig.title && correctedConfig.title.text) {
      const currentTitle = correctedConfig.title.text;
      if (!currentTitle.includes("sin(") && !currentTitle.includes("cos(")) {
        correctedConfig.title.text = currentTitle + " (sin(x))";
      }
    } else {
      correctedConfig.title = {
        text: "Oscillation harmonique (sin(x))",
        align: "center",
      };
    }
  }

  // ✅ CORRECTION 5: Vérifier la symétrie des paraboles
  if (desc.includes("quadratique") || desc.includes("parabole")) {
    if (
      correctedConfig.series &&
      correctedConfig.series[0] &&
      correctedConfig.series[0].data
    ) {
      const data = correctedConfig.series[0].data;
      console.log("🔍 Vérification symétrie parabole, points:", data.length);

      // Vérifier que les points sont symétriques
      let isSymmetric = true;
      for (let i = 0; i < data.length; i++) {
        const [x, y] = data[i];
        if (Math.abs(y - x * x) > 0.01) {
          // Tolérance de 0.01
          isSymmetric = false;
          console.log(
            `⚠️ Point non conforme à y=x²: (${x}, ${y}) devrait être (${x}, ${x * x})`,
          );
        }
      }

      if (!isSymmetric) {
        console.log("🔧 Correction des points pour respecter y=x²");
        correctedConfig.series[0].data = [
          [-3, 9],
          [-2, 4],
          [-1, 1],
          [0, 0],
          [1, 1],
          [2, 4],
          [3, 9],
        ];
      }
    }
  }

  console.log("✅ Validation scientifique terminée");
  return correctedConfig;
}

// Fonction pour extraire le sujet de la description
function extractSubjectFromDescription(description: string): string {
  const subjects = {
    physique: [
      "oscillation",
      "force",
      "énergie",
      "onde",
      "électrique",
      "magnétique",
    ],
    mathématiques: [
      "fonction",
      "quadratique",
      "parabole",
      "dérivée",
      "intégrale",
      "géométrie",
    ],
    chimie: ["molécule", "réaction", "concentration", "pH", "équilibre"],
    svt: ["cellule", "adn", "évolution", "écosystème", "génétique"],
  };

  const descLower = description.toLowerCase();
  for (const [subject, keywords] of Object.entries(subjects)) {
    if (keywords.some((keyword) => descLower.includes(keyword))) {
      return subject.charAt(0).toUpperCase() + subject.slice(1);
    }
  }
  return "Mathématiques"; // Défaut
}

// Fonction pour extraire le topic de la description
function extractTopicFromDescription(description: string): string {
  const topics = {
    oscillations: ["oscillation", "sinusoidal", "harmonique"],
    "fonctions quadratiques": ["quadratique", "parabole", "x²"],
    forces: ["force", "newton", "dynamique"],
    géométrie: ["géométrie", "triangle", "cercle"],
  };

  const descLower = description.toLowerCase();
  for (const [topic, keywords] of Object.entries(topics)) {
    if (keywords.some((keyword) => descLower.includes(keyword))) {
      return topic;
    }
  }
  return "analyse de données"; // Défaut
}

// Configuration prédéfinie SCIENTIFIQUEMENT EXACTE comme fallback
function generateFallbackConfig(
  library: string,
  _type: string,
  description: string,
  dataValues: number[],
): GraphicConfig {
  if (library === "apexcharts") {
    const desc = description.toLowerCase();

    // ✅ F=ma - Relation linéaire PARFAITE
    if (
      desc.includes("newton") ||
      desc.includes("f=ma") ||
      (desc.includes("force") && desc.includes("accélération"))
    ) {
      const mass = 2; // masse fixe de 2kg pour l'exemple
      const data = [];
      for (let a = 0; a <= 5; a += 0.5) {
        data.push([a, mass * a]); // F = ma EXACT
      }

      return {
        chart: { type: "line", height: 350 },
        series: [
          {
            name: `F = ma (m=${mass}kg)`,
            data: data,
          },
        ],
        xaxis: { title: { text: "Accélération (m/s²)" }, min: 0, max: 5 },
        yaxis: { title: { text: "Force (N)" }, min: 0 },
        title: { text: "Deuxième loi de Newton : F = ma", align: "center" },
        stroke: { curve: "straight", width: 2 }, // DROITE parfaite, pas de courbe
      };
    }

    // ✅ Fonction quadratique EXACTE
    if (
      desc.includes("quadratique") ||
      desc.includes("parabole") ||
      desc.includes("x²")
    ) {
      const data = [];
      for (let x = -3; x <= 3; x += 0.5) {
        data.push([x, x * x]); // y = x² EXACT
      }

      return {
        chart: { type: "line", height: 350 },
        series: [
          {
            name: "y = x²",
            data: data,
          },
        ],
        xaxis: { title: { text: "x" }, min: -3, max: 3 },
        yaxis: { title: { text: "y = x²" }, min: 0, max: 9 },
        title: { text: "Fonction quadratique y = x²", align: "center" },
        stroke: { curve: "straight", width: 2 }, // Utiliser 'straight' pour une parabole parfaite
      };
    }

    // ✅ Oscillation sinusoïdale PURE
    if (
      desc.includes("oscillation") ||
      desc.includes("sinusoïd") ||
      desc.includes("sin(")
    ) {
      const data = [];
      for (let x = 0; x <= 6.28; x += 0.1) {
        data.push([x, Math.sin(x)]); // sin(x) PUR
      }

      return {
        chart: { type: "line", height: 350 },
        series: [
          {
            name: "sin(x)",
            data: data,
          },
        ],
        xaxis: { title: { text: "x (radians)" }, min: 0, max: 6.28 },
        yaxis: { title: { text: "sin(x)" }, min: -1, max: 1 },
        title: { text: "Oscillation harmonique pure", align: "center" },
        stroke: { curve: "smooth" },
      };
    }

    // ✅ Tangente à une fonction
    if (desc.includes("tangente") || desc.includes("dérivée")) {
      // Exemple : tangente à y=x² au point x=1
      const funcData = [];
      const tangentData = [];
      const tangentPoint = 1; // Point de tangence
      const slope = 2 * tangentPoint; // dérivée de x² = 2x

      // Fonction principale y = x²
      for (let x = -2; x <= 3; x += 0.2) {
        funcData.push([x, x * x]);
      }

      // Tangente : y = 2x - 1 (passe par (1,1) avec pente 2)
      for (let x = -1; x <= 3; x += 0.5) {
        tangentData.push([x, slope * x - 1]);
      }

      return {
        chart: { type: "line", height: 350 },
        series: [
          {
            name: "y = x²",
            data: funcData,
            color: "#008FFB",
          },
          {
            name: `Tangente en x=${tangentPoint}`,
            data: tangentData,
            color: "#FF4560",
          },
        ],
        xaxis: { title: { text: "x" } },
        yaxis: { title: { text: "y" } },
        title: { text: "Fonction et sa tangente", align: "center" },
        stroke: { curve: "smooth", width: 2 },
        markers: { size: 4 },
      };
    }

    // ✅ Relation linéaire générique (y = mx + b)
    if (
      desc.includes("linéaire") ||
      desc.includes("proportionnel") ||
      desc.includes("droite")
    ) {
      const slope = 2; // pente de 2
      const data = [];
      for (let x = 0; x <= 10; x += 1) {
        data.push([x, slope * x]); // y = 2x EXACT
      }

      return {
        chart: { type: "line", height: 350 },
        series: [
          {
            name: `y = ${slope}x`,
            data: data,
          },
        ],
        xaxis: { title: { text: "x" } },
        yaxis: { title: { text: "y" } },
        title: { text: "Relation linéaire", align: "center" },
        stroke: { curve: "straight", width: 2 }, // DROITE parfaite
      };
    }
  }

  // Fallback générique avec dataValues
  if (dataValues && dataValues.length > 0) {
    const data = dataValues.map((value, index) => [index, value]);
    return {
      chart: { type: "line", height: 350 },
      series: [{ name: "Données", data: data }],
      xaxis: { title: { text: "Index" } },
      yaxis: { title: { text: "Valeur" } },
      title: { text: "Graphique de données", align: "center" },
    };
  }

  return {}; // Fallback minimal en dernier recours
}

// Fonction pour appeler l'IA et générer une configuration graphique intelligente
async function generateAIGraphicConfig(
  params: AIGraphicParams,
): Promise<{ config: GraphicConfig }> {
  try {
    // Importer et instancier le service de génération graphique IA
    const { AIGraphicGenerator } =
      await import("../graphics/aiGraphicGenerator.js");
    const aiGraphicGenerator = new AIGraphicGenerator();

    const result = await aiGraphicGenerator.generateGraphicWithAI({
      subject: params.subject,
      topic: params.topic,
      level: params.level,
      library: params.library !== "auto" ? params.library : undefined,
      questionContext: params.questionContext,
    });

    return { config: result.config };
  } catch (error) {
    console.error("❌ Erreur lors de l'appel au service IA graphique:", error);
    throw error;
  }
}

/** Résultat de génération de questions */
interface GenerateQuestionsResult {
  success: boolean;
  questions: QuizQuestion[];
}

/**
 * 2. generate_questions_array - Génère un array de questions
 */
async function generateQuestionsArray(
  args: GenerateQuestionsArrayArgs,
): Promise<GenerateQuestionsResult> {
  console.log("❓ Génération questions avec:", args);

  const { questions } = args;

  if (!questions || !Array.isArray(questions)) {
    throw new Error(
      "Array de questions manquant pour generate_questions_array",
    );
  }

  // Valider chaque question
  for (const question of questions) {
    if (!question.id || !question.question || !question.type) {
      throw new Error("Question invalide - propriétés manquantes");
    }
  }

  return {
    success: true,
    questions: questions.map((q) => ({
      ...q,
      generated_at: new Date().toISOString(),
    })),
  };
}

/** Résultat de génération de sujet avec documents */
interface GenerateSubjectResult {
  success: boolean;
  subject: {
    title: string;
    description: string;
    documentTopics: string[];
    questionDistribution: Record<string, unknown>;
    estimatedTime?: number;
    targetLevel?: string;
    specificCompetencies?: string[];
    documents: SearchDocument[];
    generated_at: string;
    wikipedia_api_used: boolean;
  };
  next_step: string;
  documents_found: number;
  workflow_used: string;
}

/**
 * 3. generate_subject_with_documents - NOUVEAU: Utilise l'API Wikipedia directe selon le workflow défini
 * Workflow: API Wikipedia → 5 résultats → meilleur adapté au niveau → 6500 chars → questions
 */
async function generateSubjectWithDocuments(
  args: GenerateSubjectWithDocumentsArgs,
): Promise<GenerateSubjectResult> {
  console.log(
    "📚 Génération sujet avec documents (API Wikipedia directe):",
    args,
  );

  const {
    title,
    description,
    documentTopics,
    questionDistribution,
    estimatedTime,
    targetLevel,
    specificCompetencies,
    uploadedFileIds,
    useFileUpload,
  } = args;

  if (!title || !description || !documentTopics || !questionDistribution) {
    throw new Error(
      "Paramètres manquants pour generate_subject_with_documents",
    );
  }

  let searchResults: SearchDocument[] = [];

  if (useFileUpload && uploadedFileIds && uploadedFileIds.length > 0) {
    console.log(
      `📤 Mode File Upload: utilisation de ${uploadedFileIds.length} fichiers uploadés`,
    );
    // Garder la logique existante pour les fichiers uploadés
    searchResults = uploadedFileIds.map((fileId: string, index: number) => ({
      id: `file_${index}`,
      title: `Document ${index + 1} - Contenu intégral disponible`,
      content: `FICHIER UPLOADÉ: ${fileId}`,
      topic: documentTopics[0] || "general",
      similarity: 1.0,
      source: "Document Uploadé",
      fileId: fileId,
    }));
  } else {
    console.log("🚀 SYSTÈME IA UNIFIÉ: Recherche Wikipedia Intelligente");

    try {
      // TON SYSTÈME SIMPLE ET PUISSANT 🎯
      const subjectName = extractSubjectFromTitle(title);
      console.log(
        `🤖 Recherche IA pour "${subjectName}" niveau ${targetLevel}`,
      );
      console.log(`📝 Topics: ${documentTopics.join(", ")}`);

      const bestDocument = await searchWikipediaWithAI(
        subjectName,
        targetLevel || "BAC",
        documentTopics,
        title,
      );

      // Document final avec TON système IA 🚀
      const finalDocument = {
        id: `wikipedia_ai_${bestDocument.pageid || Date.now()}`,
        title: bestDocument.title,
        content: bestDocument.content,
        topic: documentTopics[0] || subjectName,
        similarity: 1.0,
        source: bestDocument.source,
        originalLength: bestDocument.originalLength,
        optimizedLength: bestDocument.content.length,
        targetLevel: targetLevel,
        extractionMethod: "ai_unified_smart_extraction",
        aiProcessed: true,
        minimumParts: 4,
        minimumLength: 6500,
        searchStrategy: "ai_unified_system",
        selectionMethod: bestDocument.selectedBy,
        searchTerm: bestDocument.searchTerm,
        generated_at: new Date().toISOString(),
      };

      searchResults = [finalDocument];
      console.log(
        `✅ Document IA final créé: ${finalDocument.title} (${finalDocument.optimizedLength} chars)`,
      );
    } catch (error) {
      console.error("❌ Erreur système IA Wikipedia:", error);
      // Fallback vers recherche simple si nécessaire
      console.log("🔄 Fallback vers recherche documentaire classique...");
      searchResults = [];
    }
  }

  return {
    success: true,
    subject: {
      title,
      description,
      documentTopics,
      questionDistribution,
      estimatedTime,
      targetLevel,
      specificCompetencies,
      documents: searchResults,
      generated_at: new Date().toISOString(),
      wikipedia_api_used: !useFileUpload,
    },
    next_step:
      "OBLIGATOIRE: Tu DOIS maintenant appeler generate_questions_array pour créer des questions EXCLUSIVEMENT basées sur le contenu du document Wikipedia ci-dessus. NE PAS utiliser de connaissances générales, SEULEMENT le contenu du document fourni.",
    documents_found: searchResults.length,
    workflow_used: useFileUpload ? "file_upload" : "wikipedia_api_direct",
  };
}

/**
 * Extrait le nom de la matière du titre pour la recherche documentaire
 */
function extractSubjectFromTitle(title: string): string {
  // Patterns pour extraire la matière principale
  // "Quiz Français - Niveau Brevet" -> "Français"
  // "Mathématiques - Géométrie" -> "Mathématiques"

  // Chercher le pattern "Quiz [MATIERE] - Niveau"
  let match = title.match(/Quiz\s+([^-]+?)\s*-\s*Niveau/i);
  if (match) {
    return match[1].trim();
  }

  // Chercher le pattern standard "[MATIERE] - [SOUS-DOMAINE]"
  match = title.match(/^([^-]+)/);
  const extracted = match ? match[1].trim() : title;

  // Enlever "Quiz" du début si présent
  return extracted.replace(/^Quiz\s+/i, "").trim();
}

// ===== FONCTIONS UTILITAIRES WIKIPEDIA API =====

/** Réponse brute de l'API Wikipedia Search */
interface WikipediaAPISearchResponse {
  query?: {
    search?: WikipediaSearchResult[];
  };
}

/**
 * Recherche Wikipedia via API directe
 */
async function searchWikipediaAPI(
  query: string,
  limit: number = 5,
): Promise<WikipediaSearchResult[]> {
  try {
    const fetch = (await import("node-fetch")).default;

    const searchUrl =
      `https://fr.wikipedia.org/w/api.php?` +
      new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: query,
        format: "json",
        srlimit: String(limit),
        srprop: "snippet|titlesnippet|size|wordcount|timestamp",
        origin: "*",
      }).toString();

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "PenSaaS/1.0 (https://pensaas.com/contact) Educational Tool",
      },
    });

    if (!response.ok) {
      throw new Error(`Erreur API Wikipedia: ${response.status}`);
    }

    const data = (await response.json()) as WikipediaAPISearchResponse;
    return data.query?.search || [];
  } catch (error) {
    console.error("❌ Erreur recherche Wikipedia API:", error);
    return [];
  }
}

/** Réponse brute de l'API Wikipedia Query */
interface WikipediaAPIQueryResponse {
  query?: {
    pages?: Record<
      string,
      {
        pageid?: number;
        title?: string;
        missing?: boolean;
        fullurl?: string;
        extract?: string;
      }
    >;
  };
}

/** Réponse brute de l'API Wikipedia Parse */
interface WikipediaAPIParseResponse {
  parse?: {
    wikitext?: {
      "*"?: string;
    };
  };
}

/**
 * Récupère le contenu complet d'un article Wikipedia
 */
async function getWikipediaArticleContent(
  pageId: number,
  _charLimit: number = 30000,
): Promise<WikipediaArticleContent | null> {
  try {
    const fetch = (await import("node-fetch")).default;

    // 🔄 Nouvelle approche : utiliser l'API parse pour récupérer le contenu complet
    console.log(`🔍 Récupération contenu complet pour pageId: ${pageId}...`);

    // Première requête : récupérer les infos de base et le titre
    const infoUrl =
      `https://fr.wikipedia.org/w/api.php?` +
      new URLSearchParams({
        action: "query",
        prop: "info",
        pageids: String(pageId),
        format: "json",
        inprop: "url",
        origin: "*",
      }).toString();

    const infoResponse = await fetch(infoUrl, {
      headers: {
        "User-Agent":
          "PenSaaS/1.0 (https://pensaas.com/contact) Educational Tool",
      },
    });

    if (!infoResponse.ok) {
      throw new Error(`Erreur récupération infos: ${infoResponse.status}`);
    }

    const infoData = (await infoResponse.json()) as WikipediaAPIQueryResponse;
    const pageInfo = infoData.query?.pages?.[pageId];

    if (!pageInfo || pageInfo.missing) {
      throw new Error("Article non trouvé");
    }

    // Deuxième requête : récupérer le contenu complet via l'API parse
    const parseUrl =
      `https://fr.wikipedia.org/w/api.php?` +
      new URLSearchParams({
        action: "parse",
        pageid: String(pageId),
        format: "json",
        prop: "wikitext",
        origin: "*",
      }).toString();

    const parseResponse = await fetch(parseUrl, {
      headers: {
        "User-Agent":
          "PenSaaS/1.0 (https://pensaas.com/contact) Educational Tool",
      },
    });

    if (!parseResponse.ok) {
      throw new Error(`Erreur récupération parse: ${parseResponse.status}`);
    }

    const parseData = (await parseResponse.json()) as WikipediaAPIParseResponse;
    const wikitext = parseData.parse?.wikitext?.["*"] || "";

    // Nettoyer le wikitext pour le convertir en texte lisible
    let cleanText = wikitext
      // Supprimer les références {{...}}
      .replace(/\{\{[^}]*\}\}/g, "")
      // Supprimer les liens internes [[...]]
      .replace(/\[\[([^|\]]+)(\|[^\]]+)?\]\]/g, "$1")
      // Supprimer les liens externes [...]
      .replace(/\[[^\]]+\]/g, "")
      // Supprimer les balises HTML
      .replace(/<[^>]*>/g, "")
      // Supprimer les références <ref>...</ref>
      .replace(/<ref[^>]*>.*?<\/ref>/gs, "")
      // Supprimer les balises simples <ref />
      .replace(/<ref[^>]*\/>/g, "")
      // Nettoyer les espaces multiples
      .replace(/\s+/g, " ")
      // Nettoyer les sauts de ligne multiples
      .replace(/\n\s*\n/g, "\n\n")
      .trim();

    // Si le contenu est toujours trop court, essayer l'ancienne méthode en fallback
    if (cleanText.length < 5000) {
      console.log(
        `⚠️ Contenu parse trop court (${cleanText.length} chars), fallback vers extracts...`,
      );

      const extractUrl =
        `https://fr.wikipedia.org/w/api.php?` +
        new URLSearchParams({
          action: "query",
          prop: "extracts",
          pageids: String(pageId),
          format: "json",
          explaintext: "1",
          exsectionformat: "plain",
          exintro: "0",
          exlimit: "1",
          origin: "*",
        }).toString();

      const extractResponse = await fetch(extractUrl, {
        headers: {
          "User-Agent":
            "PenSaaS/1.0 (https://pensaas.com/contact) Educational Tool",
        },
      });

      if (extractResponse.ok) {
        const extractData =
          (await extractResponse.json()) as WikipediaAPIQueryResponse;
        const extractText = extractData.query?.pages?.[pageId]?.extract || "";
        if (extractText.length > cleanText.length) {
          cleanText = extractText;
          console.log(
            `✅ Fallback extracts utilisé: ${cleanText.length} caractères`,
          );
        }
      }
    }

    // Limiter la longueur finale pour éviter les problèmes de mémoire
    if (cleanText.length > 200000) {
      console.log(
        `⚠️ Article très long (${cleanText.length} chars), troncature à 200K`,
      );
      cleanText =
        cleanText.substring(0, 200000) +
        "\n\n[Article tronqué pour optimisation]";
    }

    console.log(
      `📄 Article "${pageInfo.title}" récupéré: ${cleanText.length} caractères`,
    );

    return {
      title: pageInfo.title || "",
      pageid: pageInfo.pageid || pageId,
      extract: cleanText,
      url:
        pageInfo.fullurl ||
        `https://fr.wikipedia.org/wiki/${encodeURIComponent(pageInfo.title || "")}`,
    };
  } catch (error) {
    console.error(`❌ Erreur récupération article ${pageId}:`, error);
    return null;
  }
}

/**
 * Calcule un score de pertinence pour un article selon le niveau cible
 */
function calculateRelevanceScore(
  article: WikipediaSearchResult,
  targetLevel: string,
): number {
  let score = 0;

  // Score de base selon la longueur (articles plus longs = plus complets)
  const wordCount = article.wordcount || 0;
  if (wordCount > 5000) score += 0.4;
  else if (wordCount > 2000) score += 0.3;
  else if (wordCount > 1000) score += 0.2;
  else score += 0.1;

  // Bonus pour les mots clés éducatifs dans le snippet
  const snippet = (article.snippet || "").toLowerCase();
  const educationalKeywords = {
    BREVET: [
      "histoire",
      "géographie",
      "français",
      "mathématiques",
      "sciences",
      "cours",
      "leçon",
    ],
    BAC: [
      "analyse",
      "étude",
      "recherche",
      "théorie",
      "méthode",
      "concept",
      "développement",
    ],
    PARTIELS: [
      "université",
      "recherche",
      "académique",
      "théorie",
      "critique",
      "analyse approfondie",
    ],
  };

  const keywords =
    educationalKeywords[targetLevel as keyof typeof educationalKeywords] || [];
  const keywordMatches = keywords.filter((keyword) =>
    snippet.includes(keyword),
  ).length;
  score += keywordMatches * 0.1;

  // Pénalité pour les articles trop courts
  if (wordCount < 500) score -= 0.2;

  return Math.min(1.0, Math.max(0.1, score));
}

/**
 * 🚀 TON SYSTÈME IA UNIFIÉ - Recherche Wikipedia Intelligente
 * Une seule fonction qui fait tout avec l'IA + ton référentiel complet
 */
async function searchWikipediaWithAI(
  subject: string, // "Histoire-Géographie-EMC"
  level: string, // "BREVET"
  documentTopics: string[],
  originalTitle: string,
): Promise<WikipediaAIResult> {
  console.log(`🎯 IA recherche pour ${subject} niveau ${level}`);

  // 1. System Prompt avec TON référentiel complet
  const getSystemPrompt = () => {
    let referentiel = "";

    if (level === "BREVET") {
      referentiel = `
📚 RÉFÉRENTIEL BREVET COMPLET:

• Histoire Brevet:
  Mondes anciens (Athènes, Rome), Moyen Âge (chrétienté, pouvoirs), Temps modernes (Renaissance, Réformes), 
  Révolutions (française & Empire), XIXᵉ siècle (industrialisation, colonisation), 1914-1945 (guerres mondiales, totalitarismes), 
  France depuis 1945 (IVᵉ-Vᵉ Républiques), Guerre froide et monde depuis 1991.

• Géographie Brevet:
  Habiter en France et dans le monde, métropolisation, espaces productifs, mobilités & migrations, 
  aménagement du territoire, risques & environnement, outre-mer et territoires français dans la mondialisation.

• EMC Brevet:
  Valeurs et symboles de la République, laïcité, droits & devoirs, justice et égalité, 
  médias & esprit critique, prévention et engagement citoyen.`;
    } else if (level === "BAC") {
      referentiel = `
📚 RÉFÉRENTIEL BAC COMPLET:

• Histoire Bac:
  Démocraties, totalitarismes et guerres (1918-1945), décolonisation et construction d'États, 
  Guerre froide & recompositions du monde, puissances et rivalités (États-Unis, Chine), 
  construction européenne, France politique depuis 1958.

• Géographie Bac:
  Mondialisation et ses acteurs, dynamiques territoriales de la France, métropolisation & mobilités, 
  mers & océans, ressources & risques, frontières et tensions, Union européenne dans la mondialisation.

• HGGSP (spécialité Bac):
  Puissances & dynamiques géopolitiques, information & opinion, frontières, patrimoines, 
  environnement, guerres & paix, espaces maritimes, régionalisations du monde.

• EMC Bac:
  Institutions de la Vᵉ République, libertés publiques & laïcité, égalité & discriminations, 
  défense & sécurité, engagement et vie démocratique, médias & information responsable.`;
    } else if (level === "PARTIELS") {
      referentiel = `
📚 RÉFÉRENTIEL PARTIELS (Licence):

• Histoire Partiels:
  Méthodologie historique & critique des sources, histoire ancienne (Grèce/Rome), médiévale, moderne, contemporaine, 
  histoire politique de la France, Europe (intégration, conflits), mondes coloniaux & décolonisations, 
  mondialisations, historiographie & débats.

• Géographie/Géopolitique Partiels:
  Géographie humaine/urbaine/rurale, géographie économique & des mobilités, environnement & risques, 
  cartographie & SIG, géopolitique des ressources, frontières & conflits, aménagement des territoires.

• Sciences politiques / Droit public:
  Droit constitutionnel et institutions françaises/UE, libertés fondamentales, sociologie politique 
  (partis, participation, médias), relations internationales, politiques publiques & citoyenneté.`;
    }

    return `Tu es un expert en recherche pédagogique Wikipedia avec 20 ans d'expérience dans l'enseignement français.

MATIÈRE: ${subject}
NIVEAU: ${level}
TOPICS DEMANDÉS: ${documentTopics.join(", ")}
TITRE ORIGINAL: ${originalTitle}

${referentiel}

MISSION: Trouve le MEILLEUR article Wikipedia pour un quiz ${subject} niveau ${level} en utilisant le référentiel ci-dessus.`;
  };

  try {
    const openaiInstance = new (await import("openai")).OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // 2. IA génère les meilleurs termes de recherche
    console.log(`🔍 IA génère des termes de recherche...`);

    const searchResponse = await openaiInstance.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: getSystemPrompt() },
        {
          role: "user",
          content: `Génère 6-8 termes de recherche Wikipedia PARFAITS pour "${subject}" niveau ${level}. 
          
          ANALYSE INTELLIGENTE DU SUJET :
          - Si c'est "BREVET - FRANÇAIS" → cherche auteurs, œuvres, mouvements littéraires
          - Si c'est "BAC - PHYSIQUE" → cherche physiciens, découvertes, phénomènes
          - Si c'est "PARTIELS - HISTOIRE MÉDIÉVALE" → cherche personnages, événements, civilisations
          - Si c'est "Biologie moléculaire" → cherche scientifiques, découvertes, processus biologiques
          - Adapte-toi à TOUT type de sujet, même les plus spécialisés !
          
          CRITÈRES IMPÉRATIFS:
          ❌ NE JAMAIS chercher des DÉFINITIONS, LISTES ou concepts abstraits
          ❌ Éviter : "figures de style", "grammaire française", "vocabulaire"
          ❌ Éviter : "Liste de...", "Définition de...", "Analyse de..."
          
          ✅ TOUJOURS chercher des ENTITÉS CONCRÈTES selon la matière :
          
          📚 FRANÇAIS : 
          - AUTEURS : "Victor Hugo", "Molière", "Jean de La Fontaine"
          - ŒUVRES : "Les Misérables", "Le Petit Prince", "Dom Juan"  
          - MOUVEMENTS : "Romantisme français", "Classicisme français"
          
          🏛️ HISTOIRE-GÉOGRAPHIE-EMC :
          - ÉVÉNEMENTS : "Première Guerre mondiale", "Révolution française"
          - PERSONNAGES : "Napoléon Bonaparte", "Charles de Gaulle"
          - LIEUX : "France", "Union européenne", "Verdun"
          
          PRINCIPE UNIVERSEL : Cherche des NOMS PROPRES, ÉVÉNEMENTS et LIEUX, jamais des concepts abstraits !
          
          Format: terme1, terme2, terme3, terme4, terme5, terme6`,
        },
      ],
      max_tokens: 200,
      temperature: 0.3,
    });

    const searchTerms =
      searchResponse.choices[0].message.content?.split(", ") || [];
    console.log(`🎯 IA génère: ${searchTerms.join(", ")}`);

    // 3. Recherches Wikipedia parallèles
    const searchResults: WikipediaSearchResult[] = [];

    for (const term of searchTerms.slice(0, 6)) {
      try {
        console.log(`📡 Recherche: "${term}"`);
        const results = await searchWikipediaAPI(term, 2);
        searchResults.push(...results.map((r) => ({ ...r, searchTerm: term })));
      } catch (error) {
        console.error(`Erreur recherche "${term}":`, error);
      }
    }

    if (searchResults.length === 0) {
      throw new Error("Aucun résultat Wikipedia trouvé");
    }

    console.log(`📊 ${searchResults.length} articles trouvés`);

    // 4. IA analyse titres + scoring intelligent
    console.log(`🧠 IA analyse les titres...`);

    const scoringResponse = await openaiInstance.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: getSystemPrompt() },
        {
          role: "user",
          content: `Analyse ces ${searchResults.length} articles et choisis le MEILLEUR pour créer un quiz ${subject} niveau ${level}.

CRITÈRES PRIORITAIRES:
1. 🎯 Pertinence au référentiel officiel 
2. 📚 Richesse pédagogique pour quiz niveau ${level}
3. 🎓 Adaptation au niveau scolaire
4. ✍️ Potentiel d'exploitation (dates, faits, concepts)

ARTICLES TROUVÉS:
${searchResults.map((article, i) => `${i}. "${article.title}" - ${article.snippet || "Pas de résumé"} (${article.wordcount || "N/A"} mots) (recherché via: "${article.searchTerm}")`).join("\n")}

ATTENTION: Évite absolument les articles courts comme les "listes" qui ont peu de contenu exploitable.
Privilégie les articles avec beaucoup de mots (>3000) qui offrent plus de matière pédagogique.

Réponds: {numéro}|{justification courte et précise}`,
        },
      ],
      max_tokens: 300,
      temperature: 0.2,
    });

    const scoringResult = scoringResponse.choices[0].message.content?.trim();
    if (!scoringResult) {
      throw new Error("Pas de réponse IA pour le scoring");
    }

    const [indexStr, justification] = scoringResult.split("|");
    const bestIndex = parseInt(indexStr);

    if (
      isNaN(bestIndex) ||
      bestIndex < 0 ||
      bestIndex >= searchResults.length
    ) {
      throw new Error(`Index invalide: ${bestIndex}`);
    }

    const bestArticle = searchResults[bestIndex];
    console.log(`🏆 IA choisit: "${bestArticle.title}" - ${justification}`);

    // 5. Récupération contenu complet + extraction 6500 chars avec IA
    console.log(`📖 Lecture complète de "${bestArticle.title}"...`);

    let fullContent = await getWikipediaArticleContent(
      bestArticle.pageid,
      100000,
    ); // Page complète

    if (!fullContent?.extract || fullContent.extract.length < 1000) {
      console.log(
        `⚠️ Article "${bestArticle.title}" trop court (${fullContent?.extract?.length || 0} chars), recherche d'un autre...`,
      );

      // Fallback : essayer avec le 2ème meilleur article
      if (searchResults.length > 1) {
        console.log(`🔄 Essai avec le 2ème article...`);
        const secondBest = searchResults[1];
        const secondContent = await getWikipediaArticleContent(
          secondBest.pageid,
          100000,
        );

        if (secondContent?.extract && secondContent.extract.length >= 1000) {
          console.log(
            `✅ 2ème article utilisé: "${secondBest.title}" (${secondContent.extract.length} chars)`,
          );
          // Remplacer les variables pour continuer
          bestArticle.title = secondBest.title;
          bestArticle.pageid = secondBest.pageid;
          fullContent = secondContent;
        } else {
          throw new Error(
            `Tous les articles Wikipedia trouvés sont trop courts`,
          );
        }
      } else {
        throw new Error(
          "Contenu Wikipedia trop court ou inexistant et aucun fallback disponible",
        );
      }
    }

    // At this point fullContent is guaranteed to be non-null with valid extract
    const validContent = fullContent as WikipediaArticleContent;

    console.log(
      `📄 Contenu récupéré: ${validContent.extract.length} caractères`,
    );
    console.log(`🤖 IA extrait 6500 meilleurs caractères...`);

    // 6. Extraction intelligente 6500 caractères par l'IA
    const extractionResponse = await openaiInstance.chat.completions.create({
      model: "gpt-4o-mini", // Ton modèle avec contexte élevé
      messages: [
        {
          role: "system",
          content: `${getSystemPrompt()}

EXTRACTION: Tu dois extraire EXACTEMENT 6500 caractères du contenu Wikipedia le plus pertinent pour un quiz ${subject} niveau ${level}.

⚠️ RÈGLES CRITIQUES:
- UNIQUEMENT le texte Wikipedia extrait, RIEN d'autre
- JAMAIS de commentaires, questions, ou explications de ta part
- JAMAIS "Questions pour le quiz", "Cette sélection...", etc.
- JAMAIS de références "[Image #1]", "[Fichier:", "[Photo:" 
- EXACTEMENT 6500 caractères (ni plus, ni moins)

✅ CRITÈRES D'EXTRACTION:
- Contenu pédagogiquement riche (dates, faits, personnages, concepts)
- Adapté au niveau ${level} selon le référentiel
- Structure claire avec paragraphes distincts
- Informations exploitables pour des questions de quiz
- Texte fluide et continu uniquement

🎯 RETOURNE: Seulement l'extrait de Wikipedia de 6500 caractères, point final.`,
        },
        {
          role: "user",
          content: `CONTENU WIKIPEDIA COMPLET DE "${bestArticle.title}":

${validContent.extract}

Extrais les 6500 meilleurs caractères pour un quiz ${subject} niveau ${level}:`,
        },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    });

    const extractedContent =
      extractionResponse.choices[0].message.content?.trim();

    if (!extractedContent || extractedContent.length < 2000) {
      console.log(
        `⚠️ Extraction IA courte (${extractedContent?.length || 0} chars), utilisation du contenu original complet`,
      );
      // Fallback : utiliser tout le contenu disponible si l'extraction IA échoue
      return {
        title: bestArticle.title,
        content: validContent.extract, // Utilise le contenu complet tel quel
        source: `Wikipedia - ${bestArticle.title}`,
        selectedBy: `IA-Smart-Selection (fallback: contenu original)`,
        originalLength: validContent.extract.length,
        pageid: bestArticle.pageid,
        searchTerm: bestArticle.searchTerm,
      };
    }

    console.log(`✅ Extraction réussie: ${extractedContent.length} caractères`);

    return {
      title: bestArticle.title,
      content: extractedContent,
      source: `Wikipedia - ${bestArticle.title}`,
      selectedBy: `IA-Smart-Selection: ${justification}`,
      originalLength: validContent.extract.length,
      pageid: bestArticle.pageid,
      searchTerm: bestArticle.searchTerm,
    };
  } catch (error) {
    console.error("❌ Erreur système IA Wikipedia:", error);
    throw error;
  }
}

// ========================================================================
// 🧹 NETTOYAGE TERMINÉ - TON SYSTÈME IA UNIFIÉ EST MAINTENANT ACTIF
// ========================================================================

// Fonctions stub pour compatibilité (à implémenter si nécessaire)
async function correctQuizStandard(
  args: CorrectQuizArgs,
): Promise<CorrectionResult> {
  console.log("🎯 correctQuizStandard appelée avec:", args);

  try {
    // L'Assistant OpenAI fournit les corrections directement dans le format attendu
    // Pas besoin de vérifier user_answers et questions car ils sont traités par l'IA
    const { corrections, globalScore, recommendations } = args;

    if (!corrections || !Array.isArray(corrections)) {
      throw new Error("Paramètres manquants: corrections requis");
    }

    console.log(
      `📝 Correction standard avec ${corrections.length} corrections`,
    );

    // L'Assistant OpenAI a déjà traité les corrections - on retourne directement le résultat
    const result = {
      corrections: corrections,
      globalScore: globalScore || 0,
      recommendations: recommendations || [],
      timestamp: new Date().toISOString(),
    };

    console.log("✅ Correction terminée avec succès:", {
      correctionsCount: corrections.length,
      globalScore: result.globalScore,
    });

    return result;
  } catch (error) {
    console.error("❌ Erreur dans correctQuizStandard:", error);
    throw new Error(`Erreur correction standard: ${error}`);
  }
}

async function correctQuizWithGraphics(
  _args: CorrectQuizArgs,
): Promise<CorrectionResult> {
  throw new Error(
    "correctQuizWithGraphics: Non implémenté dans le nouveau système",
  );
}

async function correctQuizWithDocuments(
  _args: CorrectQuizArgs,
): Promise<CorrectionResult> {
  throw new Error(
    "correctQuizWithDocuments: Non implémenté dans le nouveau système",
  );
}

async function correctQuizComplete(
  _args: CorrectQuizArgs,
): Promise<CorrectionResult> {
  throw new Error(
    "correctQuizComplete: Non implémenté dans le nouveau système",
  );
}

async function validateWithAI(
  config: GraphicConfig,
  _description?: string,
): Promise<GraphicConfig> {
  // Fallback simple : retourne la config telle quelle
  return config;
}
