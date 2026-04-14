/**
 * 🛡️ SYSTÈME DE RATE LIMITING MULTICOUCHE (Niveau SaaS Professionnel)
 * Protection contre spam, brute force, DDoS et abus d'API
 *
 * Benchmarks industrie:
 * - Notion: ~180 req/min (2700/15min)
 * - GitHub: ~83 req/min (5000/heure)
 * - Stripe: ~100 req/sec (live)
 * - OpenAI: 3-3500 RPM selon tier
 *
 * NIVEAUX DE PROTECTION:
 * 1. GLOBAL       → 3000 req/15min par IP (~200/min, niveau Notion)
 * 2. AUTH         → 15 req/15min par IP (protection brute force)
 * 3. AI           → 150 req/15min par user (~10/min, niveau tier payant)
 * 4. QUIZ         → 60 req/15min par user (~4/min, génération coûteuse)
 * 5. ASSISTANT    → 100 req/15min par user (~6.7/min, niveau pro)
 */

import rateLimit, { Options } from "express-rate-limit";
import { Request, Response } from "express";
import { getRateLimitStoreWithFallback } from "../config/rateLimitStore.js";
import { SecureLogger } from "./secureLogging.js";

/**
 * Helper pour générer une clé basée sur l'IP de manière sécurisée (IPv4 + IPv6)
 * Utilise la fonction officielle de express-rate-limit pour gérer IPv6
 */
const getIpKey = (req: Request): string => {
  // req.ip is reliable because app.set("trust proxy", 1) is configured in index.ts
  // This prevents x-forwarded-for spoofing — Express only trusts the proxy layer
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
};

/**
 * Configuration centralisée du rate limiting
 * Peut être surchargée par variables d'environnement
 */
/**
 * Valide qu'une variable d'environnement est définie
 */
const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`❌ Variable d'environnement manquante: ${name}`);
  }
  return value;
};

const RATE_LIMIT_CONFIG = {
  enabled: process.env.RATE_LIMIT_ENABLED !== "false",
  global: {
    windowMs: parseInt(requireEnv("RATE_LIMIT_GLOBAL_WINDOW")),
    max: parseInt(requireEnv("RATE_LIMIT_GLOBAL_MAX")),
  },
  auth: {
    windowMs: parseInt(requireEnv("RATE_LIMIT_AUTH_WINDOW")),
    max: parseInt(requireEnv("RATE_LIMIT_AUTH_MAX")),
  },
  ai: {
    windowMs: parseInt(requireEnv("RATE_LIMIT_AI_WINDOW")),
    max: parseInt(requireEnv("RATE_LIMIT_AI_MAX")),
  },
  quiz: {
    windowMs: parseInt(requireEnv("RATE_LIMIT_QUIZ_WINDOW")),
    max: parseInt(requireEnv("RATE_LIMIT_QUIZ_MAX")),
  },
  assistant: {
    windowMs: parseInt(requireEnv("RATE_LIMIT_ASSISTANT_WINDOW")),
    max: parseInt(requireEnv("RATE_LIMIT_ASSISTANT_MAX")),
  },
};

/**
 * Handler personnalisé lors du dépassement de limite
 * Log les incidents pour analyse de sécurité ET renvoie 429
 * CRITICAL: express-rate-limit `handler` REMPLACE le comportement par défaut.
 * Sans réponse explicite ici, aucun 429 n'est envoyé au client.
 */
const onLimitReached = (req: Request, res: Response) => {
  SecureLogger.warn("🚨 [RATE-LIMIT] Limite atteinte", {
    ip: req.ip,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    userAgent: req.get("user-agent"),
  });

  res.status(429).json({
    success: false,
    error: "RATE_LIMIT_EXCEEDED",
    message: "Trop de requêtes. Veuillez réessayer plus tard.",
  });
};

/**
 * Créer une configuration de base pour un rate limiter
 * IMPORTANT: Chaque limiter doit avoir son propre store
 */
const createBaseConfig = (storePrefix: string): Partial<Options> => ({
  standardHeaders: true, // Retourne les headers RateLimit-*
  legacyHeaders: false, // Désactive les anciens headers X-RateLimit-*
  store: getRateLimitStoreWithFallback(storePrefix), // Redis avec préfixe UNIQUE
  handler: onLimitReached,
  skip: () => {
    // Skip si rate limiting désactivé globalement
    if (!RATE_LIMIT_CONFIG.enabled) return true;
    return false;
  },
});

/**
 * 1. RATE LIMIT GLOBAL
 * Appliqué à TOUS les endpoints (sauf /health)
 * Protection contre DDoS et spam général
 */
export const globalRateLimit = rateLimit({
  ...createBaseConfig("rl:global:"),
  windowMs: RATE_LIMIT_CONFIG.global.windowMs,
  max: RATE_LIMIT_CONFIG.global.max,
  message: {
    success: false,
    error: "RATE_LIMIT_EXCEEDED",
    message: "Trop de requêtes. Veuillez réessayer dans quelques minutes.",
    retryAfter: "15 minutes",
  },
  skip: (req) => {
    // Skip health check et webhooks
    if (req.path === "/health" || req.path.startsWith("/api/webhooks/")) {
      return true;
    }
    return !RATE_LIMIT_CONFIG.enabled;
  },
  // Pas de keyGenerator personnalisé - utiliser le default qui gère IPv6 correctement
});

/**
 * 2. RATE LIMIT AUTHENTIFICATION
 * Protection contre brute force sur login/register
 * Compte uniquement les requêtes échouées
 */
export const authRateLimit = rateLimit({
  ...createBaseConfig("rl:auth:"),
  windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
  max: RATE_LIMIT_CONFIG.auth.max,
  message: {
    success: false,
    error: "AUTH_RATE_LIMIT_EXCEEDED",
    message: "Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes.",
    retryAfter: "15 minutes",
  },
  skipSuccessfulRequests: true, // Ne compte que les échecs d'authentification
  keyGenerator: (req) => {
    // Combiner IP + email pour plus de précision
    const ip = getIpKey(req);
    const email = req.body?.email || "";
    return `${ip}_${email}`;
  },
});

/**
 * 3. RATE LIMIT IA
 * Protection des endpoints AI coûteux
 * Limite par utilisateur authentifié
 */
export const aiRateLimit = rateLimit({
  ...createBaseConfig("rl:ai:"),
  windowMs: RATE_LIMIT_CONFIG.ai.windowMs,
  max: RATE_LIMIT_CONFIG.ai.max,
  message: {
    success: false,
    error: "AI_RATE_LIMIT_EXCEEDED",
    message: "Trop de requêtes IA. Veuillez réessayer dans 15 minutes.",
    retryAfter: "15 minutes",
  },
  keyGenerator: (req) => {
    // Limite par user ID si authentifié, sinon par IP
    const userId = req.user?.id;
    const ip = getIpKey(req);
    return userId ? `user_${userId}` : `ip_${ip}`;
  },
});

/**
 * 4. RATE LIMIT QUIZ
 * Protection génération de quiz
 * Limite par utilisateur authentifié
 */
export const quizRateLimit = rateLimit({
  ...createBaseConfig("rl:quiz:"),
  windowMs: RATE_LIMIT_CONFIG.quiz.windowMs,
  max: RATE_LIMIT_CONFIG.quiz.max,
  message: {
    success: false,
    error: "QUIZ_RATE_LIMIT_EXCEEDED",
    message: "Trop de générations de quiz. Veuillez réessayer dans 15 minutes.",
    retryAfter: "15 minutes",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    const ip = getIpKey(req);
    return userId ? `user_${userId}` : `ip_${ip}`;
  },
});

/**
 * 5. RATE LIMIT PREPROCESSOR QUIZ
 * Protection spécifique pour l'analyse IA pré-quiz (très coûteux)
 * Limite stricte par utilisateur - 30 req/15min (~2/min)
 */
export const preprocessorRateLimit = rateLimit({
  ...createBaseConfig("rl:preprocessor:"),
  windowMs: RATE_LIMIT_CONFIG.quiz.windowMs, // Même fenêtre que quiz
  max: Math.floor(RATE_LIMIT_CONFIG.quiz.max / 2), // Moitié des limites quiz (30/15min)
  message: {
    success: false,
    error: "PREPROCESSOR_RATE_LIMIT_EXCEEDED",
    message: "Trop de demandes d'analyse IA. Veuillez réessayer dans quelques minutes.",
    retryAfter: "15 minutes",
  },
  keyGenerator: (req) => {
    // SÉCURITÉ: Toujours par userId, jamais par IP seule pour éviter les abus
    const userId = req.user?.id;
    if (!userId) {
      // Si pas d'userId, bloquer (ce endpoint nécessite authentification)
      return `blocked_no_user_${getIpKey(req)}`;
    }
    return `user_${userId}`;
  },
});

/**
 * 6. RATE LIMIT ASSISTANT
 * Protection OpenAI Assistant (endpoints très coûteux)
 * Limite stricte par utilisateur
 */
export const assistantRateLimit = rateLimit({
  ...createBaseConfig("rl:assistant:"),
  windowMs: RATE_LIMIT_CONFIG.assistant.windowMs,
  max: RATE_LIMIT_CONFIG.assistant.max,
  message: {
    success: false,
    error: "ASSISTANT_RATE_LIMIT_EXCEEDED",
    message: "Trop de requêtes assistant IA. Veuillez réessayer dans 15 minutes.",
    retryAfter: "15 minutes",
  },
  skip: (req) => {
    // Exclure check-embedding du rate limit strict (endpoint de vérification, pas de génération IA)
    if (req.path === "/user-pages/check-embedding") {
      return true;
    }
    return !RATE_LIMIT_CONFIG.enabled;
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    const ip = getIpKey(req);
    return userId ? `user_${userId}` : `ip_${ip}`;
  },
});

/**
 * 7. RATE LIMIT ADMIN
 * Protection des endpoints admin sensibles
 * Même limite que AI mais par userId admin
 */
export const adminRateLimit = rateLimit({
  ...createBaseConfig("rl:admin:"),
  windowMs: RATE_LIMIT_CONFIG.ai.windowMs, // 15 minutes
  max: RATE_LIMIT_CONFIG.ai.max, // 150 req/15min (same as AI)
  message: {
    success: false,
    error: "ADMIN_RATE_LIMIT_EXCEEDED",
    message: "Trop de requêtes admin. Veuillez réessayer dans 15 minutes.",
    retryAfter: "15 minutes",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `admin_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 8. RATE LIMIT BETA HEARTBEAT
 * Heartbeat pings every 30s — allow 3/min per user (margin for retries)
 */
export const betaHeartbeatRateLimit = rateLimit({
  ...createBaseConfig("rl:beta-hb:"),
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: {
    success: false,
    error: "HEARTBEAT_RATE_LIMIT_EXCEEDED",
    message: "Too many heartbeat requests.",
    retryAfter: "1 minute",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `beta_hb_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 9. RATE LIMIT BETA WAITLIST
 * Anti-spam for public waitlist signup — 5 req/15min per IP
 */
export const betaWaitlistRateLimit = rateLimit({
  ...createBaseConfig("rl:beta-wl:"),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    success: false,
    error: "WAITLIST_RATE_LIMIT_EXCEEDED",
    message: "Trop de tentatives d'inscription. Réessayez dans 15 minutes.",
    retryAfter: "15 minutes",
  },
  // Key by IP since this endpoint uses optionalAuth
});

/**
 * 10. RATE LIMIT ACCOUNT DELETE
 * Destructive action — 1 request per hour per user
 */
const ACCOUNT_DELETE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ACCOUNT_DELETE_MAX = 1;

export const accountDeleteRateLimit = rateLimit({
  ...createBaseConfig("rl:acct-del:"),
  windowMs: ACCOUNT_DELETE_WINDOW_MS,
  max: ACCOUNT_DELETE_MAX,
  message: {
    success: false,
    error: "ACCOUNT_DELETE_RATE_LIMIT_EXCEEDED",
    message: "Account deletion rate limit reached. Please try again later.",
    retryAfter: "1 hour",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `acct_del_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 11. RATE LIMIT ACCOUNT EXPORT
 * Data export — 1 request per day per user
 */
const ACCOUNT_EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const ACCOUNT_EXPORT_MAX = 1;

export const accountExportRateLimit = rateLimit({
  ...createBaseConfig("rl:acct-exp:"),
  windowMs: ACCOUNT_EXPORT_WINDOW_MS,
  max: ACCOUNT_EXPORT_MAX,
  message: {
    success: false,
    error: "ACCOUNT_EXPORT_RATE_LIMIT_EXCEEDED",
    message: "Account export rate limit reached. Please try again tomorrow.",
    retryAfter: "24 hours",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `acct_exp_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 12. RATE LIMIT IMPERSONATION
 * Strict limit on admin impersonation — 10 requests per hour per admin
 */
const IMPERSONATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const IMPERSONATION_MAX = 10;

export const impersonationRateLimit = rateLimit({
  ...createBaseConfig("rl:impersonate:"),
  windowMs: IMPERSONATION_WINDOW_MS,
  max: IMPERSONATION_MAX,
  message: {
    success: false,
    error: "IMPERSONATION_RATE_LIMIT_EXCEEDED",
    message: "Too many impersonation requests. Please try again later.",
    retryAfter: "1 hour",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `impersonate_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 13. RATE LIMIT ADMIN EXPORT
 * Limit admin data exports — 5 requests per hour per admin
 */
const ADMIN_EXPORT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ADMIN_EXPORT_MAX = 5;

export const adminExportRateLimit = rateLimit({
  ...createBaseConfig("rl:admin-exp:"),
  windowMs: ADMIN_EXPORT_WINDOW_MS,
  max: ADMIN_EXPORT_MAX,
  message: {
    success: false,
    error: "ADMIN_EXPORT_RATE_LIMIT_EXCEEDED",
    message: "Too many export requests. Please try again later.",
    retryAfter: "1 hour",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `admin_exp_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 14. RATE LIMIT BILLING
 * Protection des routes checkout, cancel, upgrade, portal-url
 * 20 req/15min par user — opérations sensibles mais pas fréquentes
 */
const BILLING_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BILLING_MAX = 20;

export const billingRateLimit = rateLimit({
  ...createBaseConfig("rl:billing:"),
  windowMs: BILLING_WINDOW_MS,
  max: BILLING_MAX,
  message: {
    success: false,
    error: "BILLING_RATE_LIMIT_EXCEEDED",
    message: "Trop de requêtes billing. Veuillez réessayer dans quelques minutes.",
    retryAfter: "15 minutes",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `billing_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 15. RATE LIMIT UPLOAD
 * Protection contre abus upload (coût Cloudinary + stockage)
 * 30 req/15min par user — assez pour usage normal, bloque le spam
 */
const UPLOAD_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const UPLOAD_MAX = 30;

export const uploadRateLimit = rateLimit({
  ...createBaseConfig("rl:upload:"),
  windowMs: UPLOAD_WINDOW_MS,
  max: UPLOAD_MAX,
  message: {
    success: false,
    error: "UPLOAD_RATE_LIMIT_EXCEEDED",
    message: "Trop d'uploads. Veuillez réessayer dans quelques minutes.",
    retryAfter: "15 minutes",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `upload_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 15b. RATE LIMIT PDF EXTRACT (Mistral OCR)
 * Protection spécifique contre l'abus d'OCR payant ($0.001/page facturé à Pennote).
 * 10 req/15min par user — assez pour usage légitime (import d'un gros cours),
 * bloque toute tentative de spam qui exploserait le budget Mistral.
 */
const PDF_EXTRACT_WINDOW_MS = 15 * 60 * 1000;
const PDF_EXTRACT_MAX = 10;

export const pdfExtractRateLimit = rateLimit({
  ...createBaseConfig("rl:pdf-extract:"),
  windowMs: PDF_EXTRACT_WINDOW_MS,
  max: PDF_EXTRACT_MAX,
  message: {
    success: false,
    error: "PDF_EXTRACT_RATE_LIMIT_EXCEEDED",
    message: "Trop d'imports PDF. Réessaye dans quelques minutes.",
    retryAfter: "15 minutes",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `pdf_extract_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 16. RATE LIMIT AGENTS CRUD
 * Protection des routes CRUD agents custom (create, update, delete, list)
 * 60 req/15min par user — opérations normales, limite raisonnable
 */
const AGENTS_CRUD_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const AGENTS_CRUD_MAX = 60;

export const agentsCrudRateLimit = rateLimit({
  ...createBaseConfig("rl:agents-crud:"),
  windowMs: AGENTS_CRUD_WINDOW_MS,
  max: AGENTS_CRUD_MAX,
  message: {
    success: false,
    error: "AGENTS_RATE_LIMIT_EXCEEDED",
    message: "Trop de requêtes agents. Veuillez réessayer dans quelques minutes.",
    retryAfter: "15 minutes",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `agents_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 17. RATE LIMIT CONVERSATIONS CRUD
 * Protection des routes CRUD conversations (list, create, messages, delete, generate-title)
 * 100 req/15min par user — conversations sont utilisées plus fréquemment
 */
const CONVERSATIONS_CRUD_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const CONVERSATIONS_CRUD_MAX = 100;

export const conversationsCrudRateLimit = rateLimit({
  ...createBaseConfig("rl:conv-crud:"),
  windowMs: CONVERSATIONS_CRUD_WINDOW_MS,
  max: CONVERSATIONS_CRUD_MAX,
  message: {
    success: false,
    error: "CONVERSATIONS_RATE_LIMIT_EXCEEDED",
    message: "Trop de requêtes conversations. Veuillez réessayer dans quelques minutes.",
    retryAfter: "15 minutes",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `conv_${userId}` : `ip_${getIpKey(req)}`;
  },
});

/**
 * 18. RATE LIMIT QUIZ CORRECTION (single question)
 * Protection des corrections IA par question — coût LLM par appel
 * 60 req/10min par user — un quiz a ~20 questions, marge pour retries
 */
const QUIZ_CORRECT_SINGLE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const QUIZ_CORRECT_SINGLE_MAX = 60;

export const quizCorrectSingleRateLimit = rateLimit({
  ...createBaseConfig("rl:quiz-correct:"),
  windowMs: QUIZ_CORRECT_SINGLE_WINDOW_MS,
  max: QUIZ_CORRECT_SINGLE_MAX,
  message: {
    success: false,
    error: "QUIZ_CORRECT_RATE_LIMIT_EXCEEDED",
    message: "Trop de corrections de questions. Veuillez réessayer dans quelques minutes.",
    retryAfter: "10 minutes",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    if (!userId) {
      return `blocked_no_user_${getIpKey(req)}`;
    }
    return `user_${userId}`;
  },
});

/**
 * 19. RATE LIMIT QUIZ COMPLETE
 * Protection de la finalisation de quiz — une seule fois par quiz
 * 10 req/10min par user — un seul appel légitime par quiz
 */
const QUIZ_COMPLETE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const QUIZ_COMPLETE_MAX = 10;

export const quizCompleteRateLimit = rateLimit({
  ...createBaseConfig("rl:quiz-complete:"),
  windowMs: QUIZ_COMPLETE_WINDOW_MS,
  max: QUIZ_COMPLETE_MAX,
  message: {
    success: false,
    error: "QUIZ_COMPLETE_RATE_LIMIT_EXCEEDED",
    message: "Trop de finalisations de quiz. Veuillez réessayer dans quelques minutes.",
    retryAfter: "10 minutes",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    if (!userId) {
      return `blocked_no_user_${getIpKey(req)}`;
    }
    return `user_${userId}`;
  },
});

/**
 * 20. RATE LIMIT TRASH (Corbeille)
 * Protection des opérations de corbeille (archive/restore/list/bulk-delete/empty)
 * 30 req/min par user — opérations destructives, limite stricte
 */
const TRASH_WINDOW_MS = 60 * 1000; // 1 minute
const TRASH_MAX = 30;

export const trashLimiter = rateLimit({
  ...createBaseConfig("rl:trash:"),
  windowMs: TRASH_WINDOW_MS,
  max: TRASH_MAX,
  message: {
    success: false,
    error: "TRASH_RATE_LIMIT_EXCEEDED",
    message: "Trop d'opérations sur la corbeille. Veuillez réessayer dans une minute.",
    retryAfter: "1 minute",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    if (!userId) {
      return `blocked_no_user_${getIpKey(req)}`;
    }
    return `user_${userId}`;
  },
});

/**
 * Helper pour vérifier si le rate limiting est activé
 */
export const isRateLimitEnabled = (): boolean => {
  return RATE_LIMIT_CONFIG.enabled;
};

/**
 * Log la configuration au démarrage
 */
export const logRateLimitConfig = () => {
  if (RATE_LIMIT_CONFIG.enabled) {
    SecureLogger.log("🛡️  Rate Limiting ACTIVÉ:");
    SecureLogger.log(
      `   - Global:    ${RATE_LIMIT_CONFIG.global.max} req/${RATE_LIMIT_CONFIG.global.windowMs}ms`,
    );
    SecureLogger.log(
      `   - Auth:      ${RATE_LIMIT_CONFIG.auth.max} req/${RATE_LIMIT_CONFIG.auth.windowMs}ms`,
    );
    SecureLogger.log(
      `   - AI:        ${RATE_LIMIT_CONFIG.ai.max} req/${RATE_LIMIT_CONFIG.ai.windowMs}ms`,
    );
    SecureLogger.log(
      `   - Quiz:      ${RATE_LIMIT_CONFIG.quiz.max} req/${RATE_LIMIT_CONFIG.quiz.windowMs}ms`,
    );
    SecureLogger.log(
      `   - Assistant: ${RATE_LIMIT_CONFIG.assistant.max} req/${RATE_LIMIT_CONFIG.assistant.windowMs}ms`,
    );
  } else {
    SecureLogger.warn("⚠️  Rate Limiting DÉSACTIVÉ (mode développement)");
  }
};
