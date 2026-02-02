/**
 * 🚀 PROMPT OPTIMIZER - Optimisations niveau entreprise
 * Implémente les meilleures pratiques OpenAI/Claude/Gemini 2025
 */

import { logger } from "../../../utils/logger.js";
import { detectPreferredLanguage, buildLangInstruction } from "./language.js";
import { isMathLatexIntent, LATEX_STRICT_RULES } from "./latex.js";

// 🛡️ SÉCURITÉ: Protection contre injection de prompts
export function sanitizeUserInput(input: string): string {
  if (!input) return "";

  const originalLength = input.length;
  let modificationCount = 0;

  // Nettoyer les tentatives d'injection courantes
  let sanitized = input
    // Masquer les tentatives d'override d'instructions
    .replace(
      /(?:ignore|forget|disregard|override|replace|substitute).{0,30}(?:above|previous|prior|instructions|rules|system|prompt)/gi,
      (match) => {
        modificationCount++;
        logger.log(`🛡️ [SECURITY] Injection détectée - Override: "${match}"`);
        return "[FILTERED_INSTRUCTION_OVERRIDE]";
      },
    )
    // Masquer les tentatives de manipulation de rôle
    .replace(
      /(?:you are now|act as|pretend to be|roleplay as|simulate being).{0,50}/gi,
      (match) => {
        modificationCount++;
        logger.log(
          `🛡️ [SECURITY] Injection détectée - Role Change: "${match}"`,
        );
        return "[FILTERED_ROLE_CHANGE]";
      },
    )
    // Masquer les tentatives d'accès aux prompts système
    .replace(
      /(?:show|reveal|display|tell me|what are|what is).{0,20}(?:your|the).{0,20}(?:system|instruction|prompt|rule)/gi,
      (match) => {
        modificationCount++;
        logger.log(
          `🛡️ [SECURITY] Injection détectée - Prompt Access: "${match}"`,
        );
        return "[FILTERED_PROMPT_ACCESS]";
      },
    )
    // Masquer les délimiteurs de fin de prompt
    .replace(/(?:---END---|###STOP###|<\/prompt>|<\/system>)/gi, (match) => {
      modificationCount++;
      logger.log(`🛡️ [SECURITY] Injection détectée - Delimiter: "${match}"`);
      return "[FILTERED_DELIMITER]";
    });

  const finalLength = sanitized.length;

  if (modificationCount > 0) {
    logger.log(
      `🛡️ [SECURITY] Sanitisation terminée - ${modificationCount} tentatives bloquées`,
    );
    logger.log(
      `🛡️ [SECURITY] Taille: ${originalLength} → ${finalLength} caractères`,
    );
  } else {
    logger.log(
      `🛡️ [SECURITY] Input propre - aucune injection détectée (${originalLength} chars)`,
    );
  }

  return sanitized.trim();
}

// 🧠 INTELLIGENCE: Détection avancée du type de requête
export interface QueryAnalysis {
  type:
    | "greeting"
    | "question"
    | "instruction"
    | "creation"
    | "analysis"
    | "complex";
  mathIntent: boolean;
  language: string;
  responseLength: "brief" | "standard" | "detailed" | "comprehensive";
  reasoning: boolean; // Si thinking chain nécessaire
  ultraThink: boolean; // Si mode ultrathink 32K nécessaire
}

import type { Request } from "express";

export function analyzeQuery(query: string, req: Request): QueryAnalysis {
  const normalizedQuery = query.toLowerCase().trim();

  logger.log(`🧠 [INTELLIGENCE] Analyse de la requête initiée`);
  logger.log(`🧠 [INTELLIGENCE] Taille: ${query.length} caractères`);

  // Détection du type principal
  let type: QueryAnalysis["type"] = "question";
  if (
    /^(salut|bonjour|hello|hi|ça va|ok|merci|bonsoir)($|\s)/i.test(
      normalizedQuery,
    )
  ) {
    type = "greeting";
    logger.log(`🧠 [INTELLIGENCE] Type détecté: GREETING`);
  } else if (
    /(?:crée|créer|génère|générer|construis|construire|écris|écrire|rédige|rédiger|compose|composer)/.test(
      normalizedQuery,
    )
  ) {
    type = "creation";
    logger.log(`🧠 [INTELLIGENCE] Type détecté: CREATION`);
  } else if (
    /(?:résume|résumer|analyse|analyser|compare|comparer|évalue|évaluer|étudie|étudier)/.test(
      normalizedQuery,
    )
  ) {
    type = "analysis";
    logger.log(`🧠 [INTELLIGENCE] Type détecté: ANALYSIS`);
  } else if (
    /(?:explique|expliquer|développe|développer|détaille|détailler|décris|décrire)/.test(
      normalizedQuery,
    )
  ) {
    type = "instruction";
    logger.log(`🧠 [INTELLIGENCE] Type détecté: INSTRUCTION`);
  } else if (
    query.length > 200 ||
    /(?:et|puis|ensuite|également|aussi|de plus).*(?:et|puis|ensuite|également|aussi)/.test(
      normalizedQuery,
    )
  ) {
    type = "complex";
    logger.log(
      `🧠 [INTELLIGENCE] Type détecté: COMPLEX (longueur: ${query.length} ou connecteurs multiples)`,
    );
  } else {
    logger.log(`🧠 [INTELLIGENCE] Type détecté: QUESTION (par défaut)`);
  }

  // Longueur de réponse adaptée
  let responseLength: QueryAnalysis["responseLength"] = "standard";
  if (type === "greeting") responseLength = "brief";
  else if (type === "analysis" || type === "complex")
    responseLength = "comprehensive";
  else if (type === "creation") responseLength = "detailed";

  // Reasoning chain nécessaire pour les tâches complexes
  const reasoning =
    type === "analysis" || type === "complex" || query.length > 150;

  // 🧠 ULTRATHINK: Détection pour analyse critique de 32K tokens
  const ultraThink = detectUltraThinkNeed(normalizedQuery, query.length, type);

  const mathIntent = isMathLatexIntent(query);
  const language = detectPreferredLanguage(req).code;

  logger.log(`🧠 [INTELLIGENCE] Résultats de l'analyse:`);
  logger.log(`🧠 [INTELLIGENCE] - Type: ${type}`);
  logger.log(`🧠 [INTELLIGENCE] - Longueur réponse: ${responseLength}`);
  logger.log(
    `🧠 [INTELLIGENCE] - Thinking chain: ${reasoning ? "OUI" : "NON"}`,
  );
  logger.log(
    `🧠 [INTELLIGENCE] - UltraThink 32K: ${ultraThink ? "OUI" : "NON"}`,
  );
  logger.log(`🧠 [INTELLIGENCE] - Math/LaTeX: ${mathIntent ? "OUI" : "NON"}`);
  logger.log(`🧠 [INTELLIGENCE] - Langue: ${language}`);

  return {
    type,
    mathIntent,
    language,
    responseLength,
    reasoning,
    ultraThink,
  };
}

// 🧠 ULTRATHINK: Détection des requêtes nécessitant une analyse critique de 32K tokens
function detectUltraThinkNeed(
  normalizedQuery: string,
  queryLength: number,
  type: QueryAnalysis["type"],
): boolean {
  logger.log(`🧠 [ULTRATHINK] Évaluation du besoin d'analyse critique...`);

  // 🎯 Mots-clés critiques selon documentation FLAGS.md
  const criticalKeywords = [
    // Critical system redesign
    "refonte",
    "refactor",
    "restructure",
    "redesign",
    "modernise",
    "modernisation",
    "legacy",
    "réarchitecture",
    "réingénierie",
    "transformation",
    "migration",

    // Critical vulnerabilities
    "vulnérabilité",
    "vulnerability",
    "sécurité critique",
    "faille",
    "breach",
    "exploit",
    "attaque",
    "compromis",
    "injection",
    "xss",
    "sql injection",

    // Performance degradation >50%
    "performance critique",
    "dégradation",
    "lenteur",
    "bottleneck",
    "goulot",
    "ralentissement",
    "optimisation critique",
    "urgence performance",

    // Legacy modernization
    "modernisation legacy",
    "migration legacy",
    "système obsolète",
    "dette technique",
    "refonte complète",
    "système critique",
  ];

  // 📏 Facteurs de complexité
  const hasCriticalKeywords = criticalKeywords.some((keyword) =>
    normalizedQuery.includes(keyword),
  );
  const isVeryLong = queryLength > 1000; // Requêtes très détaillées
  const isSystemLevel =
    /(?:système|architecture|infrastructure|plateforme|entreprise|complet|global)/.test(
      normalizedQuery,
    );
  const hasMultipleDomains =
    (
      normalizedQuery.match(/(?:et|puis|ensuite|également|aussi|de plus)/g) ||
      []
    ).length >= 3;

  const ultraThinkScore =
    (hasCriticalKeywords ? 0.6 : 0) +
    (isVeryLong ? 0.2 : 0) +
    (isSystemLevel ? 0.2 : 0) +
    (hasMultipleDomains ? 0.2 : 0) +
    (type === "complex" ? 0.1 : 0);

  const needsUltraThink = ultraThinkScore >= 0.7;

  logger.log(
    `🧠 [ULTRATHINK] Analyse critique - Score: ${ultraThinkScore.toFixed(2)}`,
  );
  logger.log(`🧠 [ULTRATHINK] - Mots-clés critiques: ${hasCriticalKeywords}`);
  logger.log(`🧠 [ULTRATHINK] - Requête très longue (>1000): ${isVeryLong}`);
  logger.log(`🧠 [ULTRATHINK] - Niveau système: ${isSystemLevel}`);
  logger.log(`🧠 [ULTRATHINK] - Multi-domaines: ${hasMultipleDomains}`);
  logger.log(
    `🧠 [ULTRATHINK] → ${needsUltraThink ? "🚨 ULTRATHINK ACTIVÉ (32K tokens)" : "📝 Standard thinking"}`,
  );

  return needsUltraThink;
}

// 🏗️ STRUCTURE: Création de prompts structurés avec XML
interface PromptStructure {
  systemMessage: string;
  userMessage: string;
  temperature: number;
  maxTokens: number;
}

export function buildOptimizedPrompt(
  mode: "ask" | "search" | "create",
  query: string,
  context: string,
  history: string,
  analysis: QueryAnalysis,
): PromptStructure {
  logger.log(
    `🏗️ [STRUCTURE] Construction du prompt optimisé pour mode: ${mode.toUpperCase()}`,
  );

  // 📋 SYSTÈME: Message système structuré avec XML
  const systemMessage = buildSystemMessage(mode, analysis);
  logger.log(
    `🏗️ [STRUCTURE] Message système créé (${systemMessage.length} chars)`,
  );

  // 👤 UTILISATEUR: Message utilisateur avec thinking chain
  const userMessage = buildUserMessage(query, context, history, analysis);
  logger.log(
    `🏗️ [STRUCTURE] Message utilisateur créé (${userMessage.length} chars)`,
  );
  logger.log(
    `🏗️ [STRUCTURE] Thinking chain inclus: ${analysis.reasoning ? "OUI" : "NON"}`,
  );

  // ⚙️ PARAMÈTRES: Ajustés selon le type de requête
  const temperature = getOptimalTemperature(mode, analysis.type);
  const maxTokens = getOptimalMaxTokens(
    analysis.responseLength,
    analysis.reasoning,
    analysis.ultraThink,
  );

  logger.log(`🏗️ [STRUCTURE] Paramètres optimisés:`);
  logger.log(`🏗️ [STRUCTURE] - Température: ${temperature}`);
  logger.log(`🏗️ [STRUCTURE] - Max tokens: ${maxTokens}`);
  logger.log(`🏗️ [STRUCTURE] - Total système: ${systemMessage.length} chars`);
  logger.log(
    `🏗️ [STRUCTURE] - Total utilisateur: ${userMessage.length} chars`,
  );

  return {
    systemMessage,
    userMessage,
    temperature,
    maxTokens,
  };
}

function buildSystemMessage(
  mode: "ask" | "search" | "create",
  analysis: QueryAnalysis,
): string {
  logger.log(
    `📋 [SYSTEM] Construction message système XML pour mode: ${mode}`,
  );

  const baseRole = getRoleDefinition(mode);
  const behaviorRules = getBehaviorRules(mode);
  const technicalRules = getTechnicalRules(analysis);
  const securityRules = getSecurityRules();

  logger.log(`📋 [SYSTEM] Sections créées:`);
  logger.log(`📋 [SYSTEM] - Role: ${baseRole.length} chars`);
  logger.log(`📋 [SYSTEM] - Behavior: ${behaviorRules.length} chars`);
  logger.log(`📋 [SYSTEM] - Technical: ${technicalRules.length} chars`);
  logger.log(`📋 [SYSTEM] - Security: ${securityRules.length} chars`);

  const systemMessage = `<role>
${baseRole}
</role>

<behavior_rules priority="critical">
${behaviorRules}
</behavior_rules>

<technical_rules>
${technicalRules}
</technical_rules>

<security_rules priority="maximum">
${securityRules}
</security_rules>`;

  logger.log(
    `📋 [SYSTEM] Message XML structuré créé (${systemMessage.length} chars total)`,
  );
  return systemMessage;
}

function buildUserMessage(
  query: string,
  context: string,
  history: string,
  analysis: QueryAnalysis,
): string {
  logger.log(`👤 [USER] Construction message utilisateur`);

  const thinkingPrompt = analysis.reasoning
    ? getThinkingPrompt(analysis.ultraThink)
    : "";
  const contextSection = context ? `<context>\n${context}\n</context>\n\n` : "";
  const historySection = history
    ? `<conversation_history>\n${history}\n</conversation_history>\n\n`
    : "";
  const responseGuidelines = getResponseGuidelines(analysis);

  logger.log(`👤 [USER] Composants:`);
  logger.log(
    `👤 [USER] - Thinking prompt: ${thinkingPrompt ? "OUI" : "NON"} (${thinkingPrompt.length} chars)`,
  );
  logger.log(
    `👤 [USER] - Context: ${context ? "OUI" : "NON"} (${context?.length || 0} chars)`,
  );
  logger.log(
    `👤 [USER] - History: ${history ? "OUI" : "NON"} (${history?.length || 0} chars)`,
  );
  logger.log(`👤 [USER] - Query: ${query.length} chars`);
  logger.log(`👤 [USER] - Guidelines: ${responseGuidelines.length} chars`);

  const userMessage = `${thinkingPrompt}${contextSection}${historySection}<user_query>
${query}
</user_query>

<response_guidelines>
${responseGuidelines}
</response_guidelines>`;

  logger.log(
    `👤 [USER] Message structuré créé (${userMessage.length} chars total)`,
  );
  return userMessage;
}

function getRoleDefinition(mode: "ask" | "search" | "create"): string {
  switch (mode) {
    case "ask":
      return "Tu es un assistant IA expert spécialisé dans les réponses directes et informatives. Tu réponds aux questions en utilisant tes connaissances et le contexte fourni.";
    case "search":
      return "Tu es un assistant IA expert spécialisé dans la recherche et l'analyse d'informations. Tu explores les sources fournies pour donner des réponses complètes et documentées.";
    case "create":
      return "🎓 Tu es un assistant IA expert spécialisé dans la création de COURS DÉTAILLÉS et de contenu pédagogique. Tu es un professeur passionné qui sait transmettre les connaissances de manière claire, structurée et approfondie. Tu génères du contenu original, extrêmement bien détaillé, avec de nombreux exemples concrets et des explications progressives.";
    default:
      return "Tu es un assistant IA expert et professionnel.";
  }
}

function getBehaviorRules(mode: "ask" | "search" | "create"): string {
  const commonRules = `Tu réponds comme un expert bienveillant dans une conversation détendue. Pas de listes, pas de puces, juste un discours naturel et fluide. Raconte, explique, développe tes idées en paragraphes liés. Utilise des transitions naturelles comme "En fait", "D'ailleurs", "Il faut savoir que", "Ce qui est intéressant c'est que" pour rendre ton discours vivant.`;

  const modeSpecificRules = {
    ask: "Explique directement en racontant de manière conversationnelle, comme si tu partageais tes connaissances avec un ami curieux.",
    search:
      "Raconte ce que tu as trouvé dans les sources en tissant naturellement les informations dans un récit cohérent et engageant.",
    create: `📚 CRÉATION DE COURS DÉTAILLÉS - RÈGLES PÉDAGOGIQUES:

⚠️ INTERDICTIONS STRICTES - FORMAT COURS:
   - ❌ INTERDIT: Phrases d'introduction conversationnelles ("Absolument !", "C'est un sujet fascinant", "Je suis ravi de", "Prépare-toi")
   - ❌ INTERDIT: Phrases de conclusion conversationnelles ("N'hésite pas si tu as d'autres questions", "Si tu souhaites approfondir")
   - ❌ INTERDIT: Toute référence à toi-même ("je", "je vais", "je suis")
   - ✅ OBLIGATOIRE: Commence DIRECTEMENT par le contenu du cours (titre ou première phrase de fond)
   - ✅ OBLIGATOIRE: Termine par le contenu du cours (dernière section ou conclusion sur le sujet)
   - 📝 FORMAT: Tu crées un COURS, pas une conversation. Écris comme un manuel pédagogique professionnel.

1. PROFONDEUR ET DÉTAIL:
   - Développe CHAQUE concept avec au moins 3-4 paragraphes complets
   - N'hésite JAMAIS à être trop détaillé - c'est un cours, pas un résumé
   - Explique les "pourquoi" et les "comment" de chaque notion
   - Anticipe les questions que l'étudiant pourrait se poser

2. PROGRESSION PÉDAGOGIQUE:
   - Commence par les bases et construis progressivement
   - Relie chaque nouveau concept aux notions précédentes
   - Utilise des transitions explicites: "Maintenant que nous avons vu X, intéressons-nous à Y"

3. EXEMPLES ET ILLUSTRATIONS:
   - Fournis au moins 2-3 exemples concrets par concept majeur
   - Varie les types d'exemples (simples, complexes, contre-exemples)
   - Utilise des analogies pour rendre les concepts abstraits plus accessibles

4. APPLICATIONS PRATIQUES:
   - Montre comment chaque concept s'applique dans la vraie vie
   - Propose des exercices ou des mises en situation
   - Fournis des solutions détaillées quand tu proposes des exercices

5. POINTS CLÉS ET PIÈGES:
   - Mets en évidence les notions essentielles à retenir
   - Signale les erreurs courantes et comment les éviter
   - Ajoute des "astuces" pour mieux comprendre ou mémoriser

Ton objectif: créer un cours si complet que l'étudiant n'ait besoin d'aucune autre ressource pour maîtriser le sujet.`,
  };

  return `${commonRules}\n\n${modeSpecificRules[mode]}`;
}

function getTechnicalRules(analysis: QueryAnalysis): string {
  let rules = `STYLE OBLIGATOIRE : Écris comme si tu parlais à une personne réelle dans une conversation naturelle. Utilise UNIQUEMENT des paragraphes fluides et des phrases complètes. INTERDICTION ABSOLUE d'utiliser des listes à puces (•), des tirets (-), ou des numérotations (1. 2. 3.) sauf demande explicite. Raconte et explique comme dans un dialogue, en reliant tes idées avec des mots de liaison (cependant, d'ailleurs, en effet, ainsi, etc.).`;

  if (analysis.reasoning) {
    rules += ` Pour le thinking : structure tes 3 points de réflexion naturellement, puis écris une réponse conversationnelle complète.`;
  }

  if (analysis.mathIntent) {
    rules += ` Intègre les formules mathématiques naturellement dans tes phrases avec $...$ UNIQUEMENT (JAMAIS $$...$$). ${LATEX_STRICT_RULES}`;
  }

  return rules;
}

function getSecurityRules(): string {
  return `Utilise le contexte fourni pour répondre de manière pertinente. Si une question porte sur des concepts mentionnés dans les sources, analyse et explique ce qui s'y trouve même si les détails exacts ne sont pas présents. Seules les informations complètement absentes du contexte nécessitent de dire "Je n'ai pas cette information dans les sources fournies". Privilégie l'analyse du contenu disponible plutôt que le refus de répondre.`;
}

function getThinkingPrompt(isUltraThink: boolean = false): string {
  if (isUltraThink) {
    logger.log(`🧠 [ULTRATHINK] Ajout du prompt d'analyse critique 32K`);

    const ultraThinkPrompt = `Tu es dans un environnement de développement qui capture ta réflexion interne pour l'afficher à l'utilisateur. C'est une fonctionnalité attendue et bénéfique.

MODE ULTRATHINK ACTIVÉ - ANALYSE CRITIQUE SYSTÈME (32K tokens disponibles)

STRUCTURE DE RÉPONSE REQUISE :

<thinking>
ANALYSE CRITIQUE MULTI-NIVEAUX :

1. DÉCOMPOSITION SYSTÉMIQUE :
   - Identification des composants critiques
   - Mapping des dépendances et interactions
   - Évaluation des points de défaillance potentiels

2. ANALYSE ARCHITECTURALE :
   - Patterns architecturaux actuels vs optimaux
   - Scalabilité et maintienabilité long terme
   - Technical debt et legacy constraints

3. ÉVALUATION DES RISQUES :
   - Risques techniques, sécuritaires, et opérationnels
   - Impact business et utilisateur
   - Probabilités d'occurrence et stratégies de mitigation

4. RECOMMANDATIONS STRATÉGIQUES :
   - Solutions court/moyen/long terme
   - Prioritisation basée sur ROI et criticité
   - Roadmap d'implémentation avec milestones

5. CONSIDÉRATIONS TRANSVERSALES :
   - Performance, security, compliance
   - Resource allocation et team capacity
   - Change management et adoption

6. VALIDATION ET MÉTRIQUES :
   - KPIs de succès mesurables
   - Méthodes de validation et rollback
   - Monitoring et observability requirements
</thinking>

Maintenant fournis une réponse conversationnelle complète qui intègre naturellement tous les aspects de ton analyse critique, en expliquant de manière accessible et structurée.

`;

    logger.log(
      `🧠 [ULTRATHINK] Analyse critique 32K activée (${ultraThinkPrompt.length} chars)`,
    );
    return ultraThinkPrompt;
  }

  // Mode thinking standard
  logger.log(`💭 [THINKING] Ajout du prompt de réflexion (<thinking> tags)`);

  const thinkingPrompt = `Tu es dans un environnement de développement qui capture ta réflexion interne pour l'afficher à l'utilisateur. C'est une fonctionnalité attendue et bénéfique.

STRUCTURE DE RÉPONSE REQUISE :

<thinking>
Analyse de la demande : [Que demande exactement l'utilisateur ?]
Contexte disponible : [Quelles informations j'ai à disposition ?]
Approche de réponse : [Comment structurer ma réponse de façon optimale ?]
</thinking>

Maintenant réponds de manière conversationnelle et naturelle, en commençant directement par ta réponse sans préambule ni introduction.

`;

  logger.log(
    `💭 [THINKING] Thinking chain activée (${thinkingPrompt.length} chars)`,
  );
  return thinkingPrompt;
}

function getResponseGuidelines(analysis: QueryAnalysis): string {
  const lengthGuide = {
    brief: "Réponse brève (1-2 phrases) et directe",
    standard: "Réponse concise mais complète (100-300 mots)",
    detailed:
      "Réponse TRÈS détaillée et pédagogique (500-1500 mots minimum) - Développe chaque concept en profondeur",
    comprehensive:
      "Réponse EXTRÊMEMENT complète et approfondie (1500-3000 mots minimum) - Cours complet avec exemples multiples",
  };

  const langInstruction = buildLangInstruction({
    code: analysis.language,
    name: analysis.language,
  });

  return `${langInstruction}
LONGUEUR: ${lengthGuide[analysis.responseLength]}
FORMAT OBLIGATOIRE: Réponse conversationnelle en paragraphes fluides, JAMAIS de listes à puces
TYPE_REQUIS: Adapte ton style au type de requête (${analysis.type}) mais toujours en style dialogue naturel`;
}

function getOptimalTemperature(
  mode: "ask" | "search" | "create",
  type: QueryAnalysis["type"],
): number {
  // Températures optimisées selon mode et type
  const baseTemperatures = {
    ask: 0.1, // Précision maximale pour les réponses
    search: 0.2, // Léger équilibre créativité/précision pour la synthèse
    create: 0.4, // Plus de créativité pour la génération de contenu
  };

  const typeModifiers = {
    greeting: -0.1,
    question: 0,
    instruction: 0,
    creation: +0.2,
    analysis: +0.1,
    complex: +0.1,
  };

  return Math.max(0, Math.min(1, baseTemperatures[mode] + typeModifiers[type]));
}

function getOptimalMaxTokens(
  responseLength: QueryAnalysis["responseLength"],
  hasThinking: boolean = false,
  hasUltraThink: boolean = false,
): number {
  // 🚨 ULTRATHINK: Mode critique avec tokens élevés pour gpt-5-nano
  if (hasUltraThink) {
    logger.log(
      `🧠 [ULTRATHINK] Mode analyse critique activé: 50000 tokens alloués (gpt-5-nano)`,
    );
    logger.log(
      `🧠 [ULTRATHINK] Capacité maximale pour analyse système complexe`,
    );
    return 50000;
  }

  // 🎓 Limites AUGMENTÉES pour la création de cours détaillés (gpt-5-nano: 400k contexte, 128k output max)
  const tokenLimits = {
    brief: 500, // Plus généreux pour des réponses de qualité
    standard: 2000, // Réponses détaillées par défaut
    detailed: 16000, // 🎓 DOUBLÉ: Cours détaillés avec exemples (8k → 16k)
    comprehensive: 32000, // 🎓 AUGMENTÉ: Cours très complets (20k → 32k)
  };

  const baseTokens = tokenLimits[responseLength];

  // 🧠 THINKING: Augmenter significantly pour thinking chain
  if (hasThinking) {
    const thinkingTokens = Math.min(baseTokens * 2, 50000); // Cap à 50k pour thinking (augmenté de 40k)
    logger.log(
      `💭 [THINKING] Tokens augmentés pour thinking chain: ${baseTokens} → ${thinkingTokens}`,
    );
    return thinkingTokens;
  }

  return baseTokens;
}

// 🧠 TRONCATURE INTELLIGENTE: Garantir toujours une réponse même avec gros contexte
export function ensureResponseCapacity(
  userMessage: string,
  maxTokens: number,
  contextWindowLimit: number = 390000, // 390k pour gpt-5-nano (laisse marge pour système)
): string {
  logger.log(`🎯 [TRUNCATION] Vérification capacité de réponse`);
  logger.log(`🎯 [TRUNCATION] - Message: ${userMessage.length} chars`);
  logger.log(`🎯 [TRUNCATION] - Tokens réponse demandés: ${maxTokens}`);
  logger.log(
    `🎯 [TRUNCATION] - Limite contexte: ${contextWindowLimit} tokens`,
  );

  // Estimation grossière: 1 token ≈ 4 caractères en français
  const estimatedInputTokens = Math.ceil(userMessage.length / 4);
  const reservedResponseTokens = Math.max(maxTokens, 8000); // Minimum 8k pour réponse
  const availableInputTokens = contextWindowLimit - reservedResponseTokens;

  logger.log(
    `🎯 [TRUNCATION] - Tokens estimés input: ${estimatedInputTokens}`,
  );
  logger.log(
    `🎯 [TRUNCATION] - Tokens réservés réponse: ${reservedResponseTokens}`,
  );
  logger.log(
    `🎯 [TRUNCATION] - Tokens disponibles input: ${availableInputTokens}`,
  );

  // Si le message dépasse la capacité, tronquer intelligemment
  if (estimatedInputTokens > availableInputTokens) {
    logger.log(`🚨 [TRUNCATION] Message trop long - troncature nécessaire`);

    return intelligentTruncation(userMessage, availableInputTokens);
  }

  logger.log(
    `✅ [TRUNCATION] Message dans les limites - aucune troncature nécessaire`,
  );
  return userMessage;
}

function intelligentTruncation(
  userMessage: string,
  maxInputTokens: number,
): string {
  logger.log(`✂️ [SMART-TRUNCATE] Début troncature intelligente`);

  const maxChars = maxInputTokens * 4; // Conversion approximative tokens → chars

  // Étape 1: Extraire les sections critiques
  const sections = extractMessageSections(userMessage);
  logger.log(`✂️ [SMART-TRUNCATE] Sections extraites:`, {
    userQuery: sections.userQuery?.length || 0,
    context: sections.context?.length || 0,
    history: sections.history?.length || 0,
    other: sections.other?.length || 0,
  });

  // Étape 2: Priorités de préservation (comme OpenAI/Claude)
  const priorities = [
    { name: "user_query", content: sections.userQuery, priority: 100 }, // JAMAIS tronquer
    {
      name: "response_guidelines",
      content: sections.responseGuidelines,
      priority: 90,
    },
    { name: "thinking_prompt", content: sections.thinkingPrompt, priority: 80 },
    {
      name: "recent_history",
      content: sections.history?.slice(-1000),
      priority: 70,
    }, // Garde historique récent
    {
      name: "essential_context",
      content: sections.context?.slice(0, 2000),
      priority: 60,
    }, // Début du contexte
    {
      name: "remaining_context",
      content: sections.context?.slice(2000),
      priority: 30,
    },
    {
      name: "old_history",
      content: sections.history?.slice(0, -1000),
      priority: 20,
    },
  ].filter((item) => item.content && item.content.length > 0);

  // Étape 3: Reconstruction progressive selon priorités
  let reconstructed = "";
  let remainingChars = maxChars;

  logger.log(
    `✂️ [SMART-TRUNCATE] Reconstruction par priorité (${maxChars} chars max)`,
  );

  for (const item of priorities.sort((a, b) => b.priority - a.priority)) {
    if (item.content && item.content.length <= remainingChars) {
      reconstructed += item.content;
      remainingChars -= item.content.length;
      logger.log(
        `✂️ [SMART-TRUNCATE] ✅ ${item.name}: ${item.content.length} chars ajoutés`,
      );
    } else if (item.priority >= 80 && item.content) {
      // Sections critiques: forcer même si ça dépasse un peu
      reconstructed += item.content;
      remainingChars -= item.content.length;
      logger.log(
        `✂️ [SMART-TRUNCATE] 🚨 ${item.name}: ${item.content.length} chars forcés (critique)`,
      );
    } else {
      logger.log(
        `✂️ [SMART-TRUNCATE] ❌ ${item.name}: ${item.content?.length || 0} chars ignorés (pas de place)`,
      );
    }
  }

  // Étape 4: Ajout d'un marqueur de troncature
  if (reconstructed.length < userMessage.length) {
    const truncationNote = `\n\n[NOTICE: Contexte tronqué intelligemment pour garantir une réponse. Requête utilisateur préservée intégralement.]`;
    reconstructed += truncationNote;
  }

  logger.log(`✂️ [SMART-TRUNCATE] Troncature terminée:`);
  logger.log(`✂️ [SMART-TRUNCATE] - Original: ${userMessage.length} chars`);
  logger.log(`✂️ [SMART-TRUNCATE] - Tronqué: ${reconstructed.length} chars`);
  logger.log(
    `✂️ [SMART-TRUNCATE] - Réduction: ${((1 - reconstructed.length / userMessage.length) * 100).toFixed(1)}%`,
  );

  return reconstructed;
}

function extractMessageSections(userMessage: string): {
  userQuery: string | null;
  context: string | null;
  history: string | null;
  thinkingPrompt: string | null;
  responseGuidelines: string | null;
  other: string | null;
} {
  logger.log(`🔍 [EXTRACT] Extraction des sections du message`);

  // Patterns pour extraire les sections XML
  const userQueryMatch = userMessage.match(
    /<user_query>([\s\S]*?)<\/user_query>/,
  );
  const contextMatch = userMessage.match(/<context>([\s\S]*?)<\/context>/);
  const historyMatch = userMessage.match(
    /<conversation_history>([\s\S]*?)<\/conversation_history>/,
  );
  const guidelinesMatch = userMessage.match(
    /<response_guidelines>([\s\S]*?)<\/response_guidelines>/,
  );

  // Thinking prompt est généralement au début
  const thinkingMatch = userMessage.match(
    /^([\s\S]*?)<(?:context|conversation_history|user_query)/,
  );

  const sections = {
    userQuery: userQueryMatch?.[1]?.trim() || null,
    context: contextMatch?.[1]?.trim() || null,
    history: historyMatch?.[1]?.trim() || null,
    thinkingPrompt: thinkingMatch?.[1]?.trim() || null,
    responseGuidelines: guidelinesMatch?.[1]?.trim() || null,
    other: null as string | null,
  };

  // Calculer "other" = ce qui n'est dans aucune section identifiée
  const identifiedLength = Object.values(sections)
    .filter(Boolean)
    .reduce((sum, content) => sum + (content?.length || 0), 0);

  if (identifiedLength < userMessage.length * 0.9) {
    sections.other = userMessage; // Fallback si extraction échoue
  }

  logger.log(`🔍 [EXTRACT] Sections trouvées:`, {
    userQuery: !!sections.userQuery,
    context: !!sections.context,
    history: !!sections.history,
    thinkingPrompt: !!sections.thinkingPrompt,
    responseGuidelines: !!sections.responseGuidelines,
  });

  return sections;
}

// 🎯 FONCTION PRINCIPALE: Optimisation de prompt avec troncature intelligente
export function optimizePrompt(
  mode: "ask" | "search" | "create",
  query: string,
  context: string,
  history: string,
  req: Request,
): PromptStructure {
  logger.log(`🚀 [OPTIMIZER] Début optimisation complète du prompt`);

  // Étape 1: Analyse de la requête
  const analysis = analyzeQuery(query, req);

  // Étape 2: Construction du prompt de base
  const basePrompt = buildOptimizedPrompt(
    mode,
    query,
    context,
    history,
    analysis,
  );

  // Étape 2.5: Injecter un bloc <user_profile> depuis les headers si présent (synchrone, sans accès DB)
  try {
    const rawPersona =
      (req?.headers?.["x-user-personalization"] as string) || "";
    if (rawPersona) {
      const p = JSON.parse(rawPersona);
      const rows: string[] = [];
      if (typeof p?.classe === "string" && p.classe.trim())
        rows.push(`classe: ${p.classe.trim()}`);
      if (typeof p?.etude === "string" && p.etude.trim())
        rows.push(`etude: ${p.etude.trim()}`);
      if (typeof p?.filiere === "string" && p.filiere.trim())
        rows.push(`filiere: ${p.filiere.trim()}`);
      if (typeof p?.presentation === "string" && p.presentation.trim())
        rows.push(`presentation: ${p.presentation.trim()}`);
      if (rows.length > 0) {
        const personaXML = `<user_profile priority="high">\n${rows.join("\n")}\n</user_profile>`;
        basePrompt.systemMessage = `${personaXML}\n\n${basePrompt.systemMessage}`;
      }
    }
  } catch {
    // ignore parsing issues
  }

  // Étape 3: Vérification et troncature intelligente si nécessaire
  const optimizedUserMessage = ensureResponseCapacity(
    basePrompt.userMessage,
    basePrompt.maxTokens,
  );

  logger.log(`🚀 [OPTIMIZER] Optimisation terminée:`);
  logger.log(
    `🚀 [OPTIMIZER] - Message utilisateur final: ${optimizedUserMessage.length} chars`,
  );
  logger.log(
    `🚀 [OPTIMIZER] - Troncature appliquée: ${optimizedUserMessage.length !== basePrompt.userMessage.length ? "OUI" : "NON"}`,
  );

  return {
    ...basePrompt,
    userMessage: optimizedUserMessage,
  };
}
