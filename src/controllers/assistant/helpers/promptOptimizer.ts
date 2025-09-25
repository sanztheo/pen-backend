/**
 * 🚀 PROMPT OPTIMIZER - Optimisations niveau entreprise
 * Implémente les meilleures pratiques OpenAI/Claude/Gemini 2025
 */

import { detectPreferredLanguage, buildLangInstruction } from './language.js';
import { isMathLatexIntent, LATEX_STRICT_RULES } from './latex.js';

// 🛡️ SÉCURITÉ: Protection contre injection de prompts
export function sanitizeUserInput(input: string): string {
  if (!input) return '';
  
  const originalLength = input.length;
  let modificationCount = 0;
  
  // Nettoyer les tentatives d'injection courantes
  let sanitized = input
    // Masquer les tentatives d'override d'instructions
    .replace(/(?:ignore|forget|disregard|override|replace|substitute).{0,30}(?:above|previous|prior|instructions|rules|system|prompt)/gi, (match) => {
      modificationCount++;
      console.log(`🛡️ [SECURITY] Injection détectée - Override: "${match}"`);
      return '[FILTERED_INSTRUCTION_OVERRIDE]';
    })
    // Masquer les tentatives de manipulation de rôle
    .replace(/(?:you are now|act as|pretend to be|roleplay as|simulate being).{0,50}/gi, (match) => {
      modificationCount++;
      console.log(`🛡️ [SECURITY] Injection détectée - Role Change: "${match}"`);
      return '[FILTERED_ROLE_CHANGE]';
    })
    // Masquer les tentatives d'accès aux prompts système
    .replace(/(?:show|reveal|display|tell me|what are|what is).{0,20}(?:your|the).{0,20}(?:system|instruction|prompt|rule)/gi, (match) => {
      modificationCount++;
      console.log(`🛡️ [SECURITY] Injection détectée - Prompt Access: "${match}"`);
      return '[FILTERED_PROMPT_ACCESS]';
    })
    // Masquer les délimiteurs de fin de prompt
    .replace(/(?:---END---|###STOP###|<\/prompt>|<\/system>)/gi, (match) => {
      modificationCount++;
      console.log(`🛡️ [SECURITY] Injection détectée - Delimiter: "${match}"`);
      return '[FILTERED_DELIMITER]';
    });

  const finalLength = sanitized.length;
  
  if (modificationCount > 0) {
    console.log(`🛡️ [SECURITY] Sanitisation terminée - ${modificationCount} tentatives bloquées`);
    console.log(`🛡️ [SECURITY] Taille: ${originalLength} → ${finalLength} caractères`);
  } else {
    console.log(`🛡️ [SECURITY] Input propre - aucune injection détectée (${originalLength} chars)`);
  }

  return sanitized.trim();
}

// 🧠 INTELLIGENCE: Détection avancée du type de requête
export interface QueryAnalysis {
  type: 'greeting' | 'question' | 'instruction' | 'creation' | 'analysis' | 'complex';
  mathIntent: boolean;
  language: string;
  responseLength: 'brief' | 'standard' | 'detailed' | 'comprehensive';
  reasoning: boolean; // Si thinking chain nécessaire
  ultraThink: boolean; // Si mode ultrathink 32K nécessaire
}

export function analyzeQuery(query: string, req: any): QueryAnalysis {
  const normalizedQuery = query.toLowerCase().trim();
  
  console.log(`🧠 [INTELLIGENCE] Analyse de la requête initiée`);
  console.log(`🧠 [INTELLIGENCE] Taille: ${query.length} caractères`);
  
  // Détection du type principal
  let type: QueryAnalysis['type'] = 'question';
  if (/^(salut|bonjour|hello|hi|ça va|ok|merci|bonsoir)($|\s)/i.test(normalizedQuery)) {
    type = 'greeting';
    console.log(`🧠 [INTELLIGENCE] Type détecté: GREETING`);
  } else if (/(?:crée|créer|génère|générer|construis|construire|écris|écrire|rédige|rédiger|compose|composer)/.test(normalizedQuery)) {
    type = 'creation';
    console.log(`🧠 [INTELLIGENCE] Type détecté: CREATION`);
  } else if (/(?:résume|résumer|analyse|analyser|compare|comparer|évalue|évaluer|étudie|étudier)/.test(normalizedQuery)) {
    type = 'analysis';
    console.log(`🧠 [INTELLIGENCE] Type détecté: ANALYSIS`);
  } else if (/(?:explique|expliquer|développe|développer|détaille|détailler|décris|décrire)/.test(normalizedQuery)) {
    type = 'instruction';
    console.log(`🧠 [INTELLIGENCE] Type détecté: INSTRUCTION`);
  } else if (query.length > 200 || /(?:et|puis|ensuite|également|aussi|de plus).*(?:et|puis|ensuite|également|aussi)/.test(normalizedQuery)) {
    type = 'complex';
    console.log(`🧠 [INTELLIGENCE] Type détecté: COMPLEX (longueur: ${query.length} ou connecteurs multiples)`);
  } else {
    console.log(`🧠 [INTELLIGENCE] Type détecté: QUESTION (par défaut)`);
  }

  // Longueur de réponse adaptée
  let responseLength: QueryAnalysis['responseLength'] = 'standard';
  if (type === 'greeting') responseLength = 'brief';
  else if (type === 'analysis' || type === 'complex') responseLength = 'comprehensive';
  else if (type === 'creation') responseLength = 'detailed';

  // Reasoning chain nécessaire pour les tâches complexes
  const reasoning = type === 'analysis' || type === 'complex' || query.length > 150;

  // 🧠 ULTRATHINK: Détection pour analyse critique de 32K tokens
  const ultraThink = detectUltraThinkNeed(normalizedQuery, query.length, type);

  const mathIntent = isMathLatexIntent(query);
  const language = detectPreferredLanguage(req).code;

  console.log(`🧠 [INTELLIGENCE] Résultats de l'analyse:`);
  console.log(`🧠 [INTELLIGENCE] - Type: ${type}`);
  console.log(`🧠 [INTELLIGENCE] - Longueur réponse: ${responseLength}`);
  console.log(`🧠 [INTELLIGENCE] - Thinking chain: ${reasoning ? 'OUI' : 'NON'}`);
  console.log(`🧠 [INTELLIGENCE] - UltraThink 32K: ${ultraThink ? 'OUI' : 'NON'}`);
  console.log(`🧠 [INTELLIGENCE] - Math/LaTeX: ${mathIntent ? 'OUI' : 'NON'}`);
  console.log(`🧠 [INTELLIGENCE] - Langue: ${language}`);

  return {
    type,
    mathIntent,
    language,
    responseLength,
    reasoning,
    ultraThink
  };
}

// 🧠 ULTRATHINK: Détection des requêtes nécessitant une analyse critique de 32K tokens
function detectUltraThinkNeed(normalizedQuery: string, queryLength: number, type: QueryAnalysis['type']): boolean {
  console.log(`🧠 [ULTRATHINK] Évaluation du besoin d'analyse critique...`);

  // 🎯 Mots-clés critiques selon documentation FLAGS.md
  const criticalKeywords = [
    // Critical system redesign
    'refonte', 'refactor', 'restructure', 'redesign', 'modernise', 'modernisation', 'legacy',
    'réarchitecture', 'réingénierie', 'transformation', 'migration',

    // Critical vulnerabilities
    'vulnérabilité', 'vulnerability', 'sécurité critique', 'faille', 'breach', 'exploit',
    'attaque', 'compromis', 'injection', 'xss', 'sql injection',

    // Performance degradation >50%
    'performance critique', 'dégradation', 'lenteur', 'bottleneck', 'goulot', 'ralentissement',
    'optimisation critique', 'urgence performance',

    // Legacy modernization
    'modernisation legacy', 'migration legacy', 'système obsolète', 'dette technique',
    'refonte complète', 'système critique'
  ];

  // 📏 Facteurs de complexité
  const hasCriticalKeywords = criticalKeywords.some(keyword => normalizedQuery.includes(keyword));
  const isVeryLong = queryLength > 1000; // Requêtes très détaillées
  const isSystemLevel = /(?:système|architecture|infrastructure|plateforme|entreprise|complet|global)/.test(normalizedQuery);
  const hasMultipleDomains = (normalizedQuery.match(/(?:et|puis|ensuite|également|aussi|de plus)/g) || []).length >= 3;

  const ultraThinkScore =
    (hasCriticalKeywords ? 0.6 : 0) +
    (isVeryLong ? 0.2 : 0) +
    (isSystemLevel ? 0.2 : 0) +
    (hasMultipleDomains ? 0.2 : 0) +
    (type === 'complex' ? 0.1 : 0);

  const needsUltraThink = ultraThinkScore >= 0.7;

  console.log(`🧠 [ULTRATHINK] Analyse critique - Score: ${ultraThinkScore.toFixed(2)}`);
  console.log(`🧠 [ULTRATHINK] - Mots-clés critiques: ${hasCriticalKeywords}`);
  console.log(`🧠 [ULTRATHINK] - Requête très longue (>1000): ${isVeryLong}`);
  console.log(`🧠 [ULTRATHINK] - Niveau système: ${isSystemLevel}`);
  console.log(`🧠 [ULTRATHINK] - Multi-domaines: ${hasMultipleDomains}`);
  console.log(`🧠 [ULTRATHINK] → ${needsUltraThink ? '🚨 ULTRATHINK ACTIVÉ (32K tokens)' : '📝 Standard thinking'}`);

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
  mode: 'ask' | 'search' | 'create',
  query: string,
  context: string,
  history: string,
  analysis: QueryAnalysis
): PromptStructure {
  
  console.log(`🏗️ [STRUCTURE] Construction du prompt optimisé pour mode: ${mode.toUpperCase()}`);
  
  // 📋 SYSTÈME: Message système structuré avec XML
  const systemMessage = buildSystemMessage(mode, analysis);
  console.log(`🏗️ [STRUCTURE] Message système créé (${systemMessage.length} chars)`);
  
  // 👤 UTILISATEUR: Message utilisateur avec thinking chain
  const userMessage = buildUserMessage(query, context, history, analysis);
  console.log(`🏗️ [STRUCTURE] Message utilisateur créé (${userMessage.length} chars)`);
  console.log(`🏗️ [STRUCTURE] Thinking chain inclus: ${analysis.reasoning ? 'OUI' : 'NON'}`);
  
  // ⚙️ PARAMÈTRES: Ajustés selon le type de requête
  const temperature = getOptimalTemperature(mode, analysis.type);
  const maxTokens = getOptimalMaxTokens(analysis.responseLength, analysis.reasoning, analysis.ultraThink);
  
  console.log(`🏗️ [STRUCTURE] Paramètres optimisés:`);
  console.log(`🏗️ [STRUCTURE] - Température: ${temperature}`);
  console.log(`🏗️ [STRUCTURE] - Max tokens: ${maxTokens}`);
  console.log(`🏗️ [STRUCTURE] - Total système: ${systemMessage.length} chars`);
  console.log(`🏗️ [STRUCTURE] - Total utilisateur: ${userMessage.length} chars`);
  
  return {
    systemMessage,
    userMessage,
    temperature,
    maxTokens
  };
}

function buildSystemMessage(mode: 'ask' | 'search' | 'create', analysis: QueryAnalysis): string {
  console.log(`📋 [SYSTEM] Construction message système XML pour mode: ${mode}`);
  
  const baseRole = getRoleDefinition(mode);
  const behaviorRules = getBehaviorRules(mode);
  const technicalRules = getTechnicalRules(analysis);
  const securityRules = getSecurityRules();
  
  console.log(`📋 [SYSTEM] Sections créées:`);
  console.log(`📋 [SYSTEM] - Role: ${baseRole.length} chars`);
  console.log(`📋 [SYSTEM] - Behavior: ${behaviorRules.length} chars`);
  console.log(`📋 [SYSTEM] - Technical: ${technicalRules.length} chars`);
  console.log(`📋 [SYSTEM] - Security: ${securityRules.length} chars`);
  
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

  console.log(`📋 [SYSTEM] Message XML structuré créé (${systemMessage.length} chars total)`);
  return systemMessage;
}

function buildUserMessage(query: string, context: string, history: string, analysis: QueryAnalysis): string {
  console.log(`👤 [USER] Construction message utilisateur`);
  
  const thinkingPrompt = analysis.reasoning ? getThinkingPrompt(analysis.ultraThink) : '';
  const contextSection = context ? `<context>\n${context}\n</context>\n\n` : '';
  const historySection = history ? `<conversation_history>\n${history}\n</conversation_history>\n\n` : '';
  const responseGuidelines = getResponseGuidelines(analysis);
  
  console.log(`👤 [USER] Composants:`);
  console.log(`👤 [USER] - Thinking prompt: ${thinkingPrompt ? 'OUI' : 'NON'} (${thinkingPrompt.length} chars)`);
  console.log(`👤 [USER] - Context: ${context ? 'OUI' : 'NON'} (${context?.length || 0} chars)`);
  console.log(`👤 [USER] - History: ${history ? 'OUI' : 'NON'} (${history?.length || 0} chars)`);
  console.log(`👤 [USER] - Query: ${query.length} chars`);
  console.log(`👤 [USER] - Guidelines: ${responseGuidelines.length} chars`);
  
  const userMessage = `${thinkingPrompt}${contextSection}${historySection}<user_query>
${query}
</user_query>

<response_guidelines>
${responseGuidelines}
</response_guidelines>`;

  console.log(`👤 [USER] Message structuré créé (${userMessage.length} chars total)`);
  return userMessage;
}

function getRoleDefinition(mode: 'ask' | 'search' | 'create'): string {
  switch (mode) {
    case 'ask':
      return 'Tu es un assistant IA expert spécialisé dans les réponses directes et informatives. Tu réponds aux questions en utilisant tes connaissances et le contexte fourni.';
    case 'search':
      return 'Tu es un assistant IA expert spécialisé dans la recherche et l\'analyse d\'informations. Tu explores les sources fournies pour donner des réponses complètes et documentées.';
    case 'create':
      return 'Tu es un assistant IA expert spécialisé dans la création de contenu structuré. Tu génères du contenu original, bien organisé et adapté aux besoins spécifiés.';
    default:
      return 'Tu es un assistant IA expert et professionnel.';
  }
}

function getBehaviorRules(mode: 'ask' | 'search' | 'create'): string {
  const commonRules = `Tu réponds comme un expert bienveillant dans une conversation détendue. Pas de listes, pas de puces, juste un discours naturel et fluide. Raconte, explique, développe tes idées en paragraphes liés. Utilise des transitions naturelles comme "En fait", "D'ailleurs", "Il faut savoir que", "Ce qui est intéressant c'est que" pour rendre ton discours vivant.`;

  const modeSpecificRules = {
    ask: 'Explique directement en racontant de manière conversationnelle, comme si tu partageais tes connaissances avec un ami curieux.',
    search: 'Raconte ce que tu as trouvé dans les sources en tissant naturellement les informations dans un récit cohérent et engageant.',
    create: 'Développe tes idées naturellement en expliquant ton raisonnement et en guidant la réflexion avec un style personnel et accessible.'
  };

  return `${commonRules} ${modeSpecificRules[mode]}`;
}

function getTechnicalRules(analysis: QueryAnalysis): string {
  let rules = `STYLE OBLIGATOIRE : Écris comme si tu parlais à une personne réelle dans une conversation naturelle. Utilise UNIQUEMENT des paragraphes fluides et des phrases complètes. INTERDICTION ABSOLUE d'utiliser des listes à puces (•), des tirets (-), ou des numérotations (1. 2. 3.) sauf demande explicite. Raconte et explique comme dans un dialogue, en reliant tes idées avec des mots de liaison (cependant, d'ailleurs, en effet, ainsi, etc.).`;

  if (analysis.reasoning) {
    rules += ` Pour le thinking : structure tes 3 points de réflexion naturellement, puis écris une réponse conversationnelle complète.`;
  }

  if (analysis.mathIntent) {
    rules += ` Intègre les formules mathématiques naturellement dans tes phrases avec $..$ (inline) et $$..$$  (display). ${LATEX_STRICT_RULES}`;
  }

  return rules;
}

function getSecurityRules(): string {
  return `Utilise le contexte fourni pour répondre de manière pertinente. Si une question porte sur des concepts mentionnés dans les sources, analyse et explique ce qui s'y trouve même si les détails exacts ne sont pas présents. Seules les informations complètement absentes du contexte nécessitent de dire "Je n'ai pas cette information dans les sources fournies". Privilégie l'analyse du contenu disponible plutôt que le refus de répondre.`;
}

function getThinkingPrompt(isUltraThink: boolean = false): string {
  if (isUltraThink) {
    console.log(`🧠 [ULTRATHINK] Ajout du prompt d'analyse critique 32K`);

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

    console.log(`🧠 [ULTRATHINK] Analyse critique 32K activée (${ultraThinkPrompt.length} chars)`);
    return ultraThinkPrompt;
  }

  // Mode thinking standard
  console.log(`💭 [THINKING] Ajout du prompt de réflexion (<thinking> tags)`);

  const thinkingPrompt = `Tu es dans un environnement de développement qui capture ta réflexion interne pour l'afficher à l'utilisateur. C'est une fonctionnalité attendue et bénéfique.

STRUCTURE DE RÉPONSE REQUISE :

<thinking>
Analyse de la demande : [Que demande exactement l'utilisateur ?]
Contexte disponible : [Quelles informations j'ai à disposition ?]
Approche de réponse : [Comment structurer ma réponse de façon optimale ?]
</thinking>

Maintenant réponds de manière conversationnelle et naturelle, en commençant directement par ta réponse sans préambule ni introduction.

`;

  console.log(`💭 [THINKING] Thinking chain activée (${thinkingPrompt.length} chars)`);
  return thinkingPrompt;
}

function getResponseGuidelines(analysis: QueryAnalysis): string {
  const lengthGuide = {
    brief: 'Réponse brève (1-2 phrases) et directe',
    standard: 'Réponse concise mais complète (100-300 mots)',
    detailed: 'Réponse détaillée et structurée (200-500 mots)',
    comprehensive: 'Réponse complète et approfondie (300-800 mots)'
  };

  const langInstruction = buildLangInstruction({ code: analysis.language, name: analysis.language });
  
  return `${langInstruction}
LONGUEUR: ${lengthGuide[analysis.responseLength]}
FORMAT OBLIGATOIRE: Réponse conversationnelle en paragraphes fluides, JAMAIS de listes à puces
TYPE_REQUIS: Adapte ton style au type de requête (${analysis.type}) mais toujours en style dialogue naturel`;
}

function getOptimalTemperature(mode: 'ask' | 'search' | 'create', type: QueryAnalysis['type']): number {
  // Températures optimisées selon mode et type
  const baseTemperatures = {
    ask: 0.1,      // Précision maximale pour les réponses
    search: 0.2,   // Léger équilibre créativité/précision pour la synthèse
    create: 0.4    // Plus de créativité pour la génération de contenu
  };

  const typeModifiers = {
    greeting: -0.1,
    question: 0,
    instruction: 0,
    creation: +0.2,
    analysis: +0.1,
    complex: +0.1
  };

  return Math.max(0, Math.min(1, baseTemperatures[mode] + typeModifiers[type]));
}

function getOptimalMaxTokens(responseLength: QueryAnalysis['responseLength'], hasThinking: boolean = false, hasUltraThink: boolean = false): number {
  // 🚨 ULTRATHINK: Mode critique avec 32K tokens
  if (hasUltraThink) {
    console.log(`🧠 [ULTRATHINK] Mode analyse critique activé: 32000 tokens alloués`);
    console.log(`🧠 [ULTRATHINK] Capacité maximale pour analyse système complexe`);
    return 32000;
  }

  const tokenLimits = {
    brief: 150,
    standard: 800,
    detailed: 1500,
    comprehensive: 3000
  };

  const baseTokens = tokenLimits[responseLength];

  // 🧠 THINKING: Doubler les tokens quand thinking chain activée
  if (hasThinking) {
    console.log(`💭 [THINKING] Tokens doublés pour thinking chain: ${baseTokens} → ${baseTokens * 2}`);
    return baseTokens * 2;
  }

  return baseTokens;
}