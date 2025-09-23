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
  
  const mathIntent = isMathLatexIntent(query);
  const language = detectPreferredLanguage(req).code;

  console.log(`🧠 [INTELLIGENCE] Résultats de l'analyse:`);
  console.log(`🧠 [INTELLIGENCE] - Type: ${type}`);
  console.log(`🧠 [INTELLIGENCE] - Longueur réponse: ${responseLength}`);
  console.log(`🧠 [INTELLIGENCE] - Thinking chain: ${reasoning ? 'OUI' : 'NON'}`);
  console.log(`🧠 [INTELLIGENCE] - Math/LaTeX: ${mathIntent ? 'OUI' : 'NON'}`);
  console.log(`🧠 [INTELLIGENCE] - Langue: ${language}`);

  return {
    type,
    mathIntent,
    language,
    responseLength,
    reasoning
  };
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
  const maxTokens = getOptimalMaxTokens(analysis.responseLength, analysis.reasoning);
  
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
  
  const thinkingPrompt = analysis.reasoning ? getThinkingPrompt() : '';
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
  const commonRules = `Réponds directement sans demander de clarifications supplémentaires. Base tes réponses sur le contexte fourni et tes connaissances. Évite les formules comme "Pourriez-vous préciser..." et donne une réponse complète et naturelle.`;

  const modeSpecificRules = {
    ask: 'Va droit au but avec des informations complètes. Utilise le contexte disponible pour des réponses précises et conversationnelles.',
    search: 'Cite tes sources quand tu utilises le contexte. Combine intelligemment les informations de différentes sources dans un texte fluide.',
    create: 'Organise le contenu de manière logique et naturelle. Crée du contenu adapté et personnalisé avec un style engageant.'
  };

  return `${commonRules} ${modeSpecificRules[mode]}`;
}

function getTechnicalRules(analysis: QueryAnalysis): string {
  let rules = `Utilise un formatage Markdown naturel avec des titres (# ## ###) seulement quand nécessaire. Sépare clairement les idées avec des paragraphes et maintiens un style conversationnel et cohérent. Privilégie un texte fluide et naturel plutôt que des listes à puces sauf si explicitement demandé.`;

  if (analysis.reasoning) {
    rules += ` Si tu utilises des tags thinking, assure-toi de TOUJOURS finir par une réponse visible en dehors des tags. Après </thinking>, écris immédiatement ta réponse finale de manière naturelle.`;
  }

  if (analysis.mathIntent) {
    rules += ` Utilise $..$ (inline) et $$..$$ (display) pour les formules mathématiques réelles uniquement. ${LATEX_STRICT_RULES}`;
  }

  return rules;
}

function getSecurityRules(): string {
  return `Si l'information n'est pas dans le contexte fourni, indique explicitement "Je n'ai pas cette information dans les sources fournies". Ne jamais inventer d'informations non présentes dans le contexte. Reste fidèle au contexte fourni plutôt que de faire des suppositions.`;
}

function getThinkingPrompt(): string {
  console.log(`💭 [THINKING] Ajout du prompt de réflexion (<thinking> tags)`);
  
  const thinkingPrompt = `Tu DOIS suivre cette structure EXACTE:

<thinking>
1. Que demande l'utilisateur ?
2. Informations clés du contexte ?
3. Structure de réponse ?
</thinking>

ENSUITE, écris ta réponse finale complète (sans tags thinking):

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
TYPE_REQUIS: Adapte ton style au type de requête (${analysis.type})`;
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

function getOptimalMaxTokens(responseLength: QueryAnalysis['responseLength'], hasThinking: boolean = false): number {
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