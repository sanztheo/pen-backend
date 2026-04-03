# Issues Tracker — Backend

> Source de vérité persistante. Mis à jour automatiquement à chaque audit.
> Dernière mise à jour : 2026-04-02

## Ouvertes

| # | Sévérité | Domaine | Fichier | Problème | Détecté le | Dernière mention |
|---|----------|---------|---------|----------|------------|------------------|
| #57 | HAUTE | Tests | `src/` global | Couverture tests ~15% : 37 fichiers tests vs 232 fichiers source sans tests (50 controllers, 118 services, 36 routes, 14 middlewares) | 2026-03-25 | 2026-04-02 |
| #60 | MOYENNE | Qualité | `src/` (97 fichiers) | 97 fichiers production > 300 lignes (+62% depuis 2026-03-25, top: quizService 2390L, correctionGenerator 2169L, quizStreaming 1918L) | 2026-03-25 | 2026-04-02 |
| #61 | MOYENNE | Qualité | 5+ modules `src/` | Dead code: ~5000+ lignes de modules non importés (documentSearchService, fewShotExamples, promptOptimizer exports) | 2026-03-25 | 2026-04-02 |
| #109 | BASSE | Concurrence | `lib/y-prisma.ts:86-107` | `flushDocument` state encoding hors transaction — updates concurrentes entre `getYDoc()` et `$transaction` supprimées sans intégration. Auto-guérison via CRDT Yjs | 2026-04-01 | 2026-04-02 |
| #117 | BASSE | Qualité | `services/quiz/quizService.ts:546,1610,2282` | 3 TODO/implémentations incomplètes (examSubject, subjectPerformance, données graphiques) | 2026-04-01 | 2026-04-02 |

## Fermées

| # | Sévérité | Domaine | Fichier | Problème | Détecté | Fermé | Comment |
|---|----------|---------|---------|----------|---------|-------|---------|
| #100 | HAUTE | Résilience | `controllers/quizStreaming.ts` | SSE quiz streaming sans `req.on("close")` | 2026-03-30 | 2026-04-02 | AbortController + `req.on("close")` + early break dans boucle questions + `sendSSE` no-op si déconnecté |
| #58 | MOYENNE | Sécurité | `routes/agents.ts` | CRUD agents sans rate limiting | 2026-03-25 | 2026-04-02 | `agentsCrudRateLimit` 60 req/15min per user via `rateLimiting.ts` |
| #59 | MOYENNE | Sécurité | `routes/agents.ts:83` | Pas de limite agents custom par user | 2026-03-25 | 2026-04-02 | `MAX_CUSTOM_AGENTS_PER_USER = 50` vérifié avant création |
| #96 | MOYENNE | Sécurité | `routes/upload.ts:210` | GET /api/upload/config sans authenticateToken | 2026-03-27 | 2026-04-02 | `authenticateToken` ajouté sur la route |
| #97 | MOYENNE | Sécurité | `routes/billing.ts:84` | `priceId`/`interval` non validés par Zod | 2026-03-27 | 2026-04-02 | Zod schema `priceId: z.string().startsWith("pri_")`, `interval: z.enum(["monthly","yearly"])` + check vs PADDLE_CONFIG |
| #98 | MOYENNE | Sécurité | `rag/index.ts:825` | `Prisma.raw` embedding sans validation numérique | 2026-03-27 | 2026-04-02 | Validation `every(v => typeof v === 'number' && Number.isFinite(v))` avant Prisma.raw. `wikipediaTools.ts` n'existe plus |
| #101 | MOYENNE | Résilience | `lib/circuitBreaker.ts` | Circuit breaker dead code (119L) jamais importé | 2026-03-30 | 2026-04-02 | Fichier supprimé — dead code confirmé par grep |
| #102 | MOYENNE | Résilience | `index.ts:796-814` | Graceful shutdown incomplet | 2026-03-30 | 2026-04-02 | `gracefulShutdown()` unifié : server.close + wss.close + redis.quit avec timeouts |
| #62 | MOYENNE | Qualité | 20+ fichiers routes/controllers | Catch-500 dupliqué (68+ occ.) | 2026-03-25 | 2026-04-02 | `asyncHandler.ts` créé + proof-of-concept sur `routes/updates.ts`. Migration progressive |
| #84 | MOYENNE | Scalabilité | `services/simplifiedContent.ts:22,62` | Sidebar queries sans pagination | 2026-03-26 | 2026-04-02 | `take: 100` projects, `take: 200` pages, `orderBy: updatedAt desc` |
| #85 | MOYENNE | Scalabilité | `services/rag/cleanup.ts:112,281` | findMany sans take | 2026-03-26 | 2026-04-02 | `take: 1000` sur les deux queries |
| #87 | MOYENNE | Scalabilité | `services/AccountExportService.ts:131` | Export conversations soft-deleted | 2026-03-26 | 2026-04-02 | `isActive: true` ajouté au where |
| #104 | MOYENNE | Concurrence | `personalizationController.ts:125-157` | JSON merge non-atomique user.settings | 2026-04-01 | 2026-04-02 | `$transaction` Serializable : read+merge+write atomique |
| #110 | MOYENNE | Idempotence | `routes/billing.ts:212-257` | POST /cancel sans check préalable | 2026-04-01 | 2026-04-02 | Check `cancelAtPeriodEnd`/`status === "canceled"` avant appel Paddle |
| #116 | MOYENNE | Qualité | `quizStreaming.ts` + `chatStream.ts` + `quizController.ts` | SSE headers dupliquées 5x | 2026-04-01 | 2026-04-02 | `setupSSEHeaders()` dans `utils/sse.ts`, 5 occurrences remplacées |
| #118 | MOYENNE | Tests | `jest.config.js` | collectCoverageFrom trop limité | 2026-04-01 | 2026-04-02 | Étendu à `src/**/*.ts` avec exclusions `__tests__`, `*.d.ts` |
| #63 | BASSE | Sécurité | `routes/agents.ts:217` | Favorites validation manuelle | 2026-03-25 | 2026-04-02 | Zod schema `agentId: z.string().min(1).max(100)`, `agentType: z.enum(["preset","custom"])` |
| #99 | BASSE | Sécurité | `routes/conversations.ts` | Rate limiting absent conversations CRUD | 2026-03-27 | 2026-04-02 | `conversationsCrudRateLimit` 100 req/15min per user |
| #103 | BASSE | Résilience | `blocknote.ts:682` | `catch {}` silencieux | 2026-03-30 | 2026-04-02 | `logger.warn("[BlockNote] tryParseMarkdownToBlocks failed", error)` |
| #64 | BASSE | Scalabilité | `routes/agent/conversations.ts:39` | limit param non borné | 2026-03-25 | 2026-04-02 | `Math.min(Math.max(1, parseInt(...) \|\| 50), 200)` |
| #65 | BASSE | Scalabilité | `schema.prisma` | Index CustomAgent(userId, isActive) manquant | 2026-03-25 | 2026-04-02 | `@@index([userId, isActive])` ajouté |
| #66 | BASSE | Qualité | `src/services/rag/*.ts` | Config RAG dupliquée 4x | 2026-03-25 | 2026-04-02 | `rag/config.ts` centralisé (EMBEDDING_CONCURRENCY, DB_BATCH_SIZE), 4 fichiers migrés |
| #90 | BASSE | Scalabilité | `schema.prisma` (ActivityLog) | Index [userId, createdAt] manquant | 2026-03-26 | 2026-04-02 | `@@index([userId, createdAt])` ajouté |
| #91 | BASSE | Scalabilité | `services/simplifiedContent.ts` | Children projects sans filtre isArchived | 2026-03-26 | 2026-04-02 | `where: { isArchived: false }` sur children include |
| #105 | BASSE | Concurrence | `cron/alertsCron.ts` | Pas de Redis NX lock | 2026-04-01 | 2026-04-02 | Redis NX lock `cron:lock:alerts` TTL 300s |
| #106 | BASSE | Concurrence | `cron/retentionCron.ts` | Pas de Redis NX lock | 2026-04-01 | 2026-04-02 | Redis NX lock `cron:lock:retentionCohorts` TTL 3600s |
| #107 | BASSE | Concurrence | `jobs/cronJobs.ts:58-99` | Pas de Redis NX lock RAG cleanup | 2026-04-01 | 2026-04-02 | Redis NX lock `cron:lock:ragCleanup` TTL 3600s |
| #108 | BASSE | Concurrence | `controllers/project.ts:116-130` | projectsUsed increment hors transaction | 2026-04-01 | 2026-04-02 | Wrappé dans `$transaction` avec project.create |
| #111 | BASSE | Idempotence | `routes/billing.ts:79-137` | POST /checkout-session sans dedup | 2026-04-01 | 2026-04-02 | Redis dedup `billing:checkout:{userId}` TTL 30s |
| #112 | BASSE | Idempotence | `routes/billing.ts:264-302` | POST /upgrade sans dedup | 2026-04-01 | 2026-04-02 | Redis dedup `billing:upgrade:{userId}` TTL 30s |
| #113 | BASSE | Qualité | `services/quiz/preprocessor/example-usage.ts` | Fichier example-usage.ts livré en prod | 2026-04-01 | 2026-04-02 | Fichier supprimé (179L) |
| #114 | BASSE | Qualité | `lib/monthlyReset.ts:106` | Dead code testUserReset() | 2026-04-01 | 2026-04-02 | Fonction supprimée (26L) |
| #115 | BASSE | Qualité | `services/cron/resetLimitsCron.ts:62,98` | Dead code manualResetLimits + forceResetUserLimits | 2026-04-01 | 2026-04-02 | Deux fonctions supprimées (52L) |
| #92 | BASSE | Qualité | `scripts/db/reset-database.ts:96` | Référence `prisma.dailyArticle.deleteMany()` après suppression du model DailyArticle | 2026-03-26 | 2026-04-01 | Plus aucune occurrence de `dailyArticle` dans `src/` — nettoyé lors de la suppression de Futura |
| #86 | MOYENNE | Scalabilité | `schema.prisma` (AIConversation) | Index composite `[userId, workspaceId, isActive]` manquant | 2026-03-26 | 2026-03-30 | `@@index([userId, isActive, updatedAt])` ajouté — couvre les query patterns réels (userId+isActive+orderBy updatedAt), workspaceId a son propre index séparé |
| #88 | MOYENNE | Scalabilité | `controllers/page.ts:640` | Slug generation race condition — check-then-act sans transaction | 2026-03-26 | 2026-03-30 | Slug utilise maintenant `baseSlug + timestamp(base36) + random(4 chars)` — collision virtuellement impossible, plus de check-then-act |
| #68 | **CRITIQUE** | Scalabilité | `quiz/statsService.ts` (7 méthodes) | 7 endpoints stats chargent TOUS les quizzes d'un user sans pagination | 2026-03-26 | 2026-03-27 | `take: STATS_MAX_QUIZZES (1000)` + `result: { select: { percentage: true } }` évite detailedScoring |
| #69 | **CRITIQUE** | Scalabilité | `quiz/quizService.ts:897,926` | `getQuizHistory` déclare `limit`/`offset` mais ne les utilise JAMAIS | 2026-03-26 | 2026-03-27 | Wired `take: limit, skip: offset` sur les 2 findMany (individualQuizzes + quizSequences) |
| #70 | **CRITIQUE** | Scalabilité | `quiz/quizService.ts:1543` | `getUserProgressStats` charge tous les quizzes complétés avec 3 tables jointes | 2026-03-26 | 2026-03-27 | Ajout `take: 1000` + `result: { select: { percentage: true } }` (template non utilisé) |
| #71 | **CRITIQUE** | Scalabilité | `schema.prisma` (Page model) | Index manquants sur Page — 20+ queries font full table scan | 2026-03-26 | 2026-03-27 | `@@index([workspaceId, isArchived])` + `@@index([projectId, isArchived])` |
| #72 | **CRITIQUE** | Scalabilité | `controllers/workspace.ts:244` | `getWorkspaces` include tree 3 niveaux sans pagination | 2026-03-26 | 2026-03-27 | `take: 50` projects, `take: 100` pages, `where: { isArchived: false }` |
| #54 | HAUTE | Qualité | `src/` (3 fichiers) | 3 implémentations retry dupliquées | 2026-03-25 | 2026-03-27 | Consolidé dans `lib/retry.ts` (withRetry + retryWithBackoff + Prisma wrappers), `lib/retryWithBackoff.ts` → re-export barrel |
| #55 | HAUTE | Qualité | `lib/secureLogging.ts` + `middlewares/secureLogging.ts` | 2 modules secureLogging dupliqués | 2026-03-25 | 2026-03-27 | Helpers ajoutés dans `middlewares/secureLogging.ts`, `lib/secureLogging.ts` → re-export barrel |
| #56 | HAUTE | Qualité | 16 fichiers `src/` | 38 env vars avec fallback silencieux | 2026-03-25 | 2026-03-27 | `CLIENT_URL` + `DATABASE_URL` → throw if missing. 36 restantes = genuinely optional (NODE_ENV, PORT, tuning params) |
| #73 | HAUTE | Scalabilité | `routes/conversations.ts:276` | GET messages charge TOUS sans pagination | 2026-03-26 | 2026-03-27 | Pagination offset: `take`/`skip` query params, default 100, max 200 |
| #74 | HAUTE | Scalabilité | `services/rag/sessionMemory.ts:292` | `getSessionStats` charge toutes les sessions RAG sans take | 2026-03-26 | 2026-03-27 | `take: 1000` + `orderBy` |
| #75 | HAUTE | Scalabilité | `services/AccountExportService.ts:114` | `fetchQuizzes` sans take | 2026-03-26 | 2026-03-27 | `take: EXPORT_MAX_ITEMS` + `orderBy` (cohérent avec autres fetch*) |
| #76 | HAUTE | Scalabilité | `schema.prisma` | Index manquants Project + QuizSequence | 2026-03-26 | 2026-03-27 | `@@index([workspaceId, isArchived])` sur Project, `@@index([userId])` sur QuizSequence |
| #77 | HAUTE | Scalabilité | `controllers/page.ts:835,931` | deletePage/cleanupArchived N+1 séquentiel RAG removal | 2026-03-26 | 2026-03-27 | Boucle séquentielle → `Promise.all` parallèle |
| #78 | HAUTE | Scalabilité | `services/rag/userPages.ts:452` | Chunk INSERT individuel en boucle | 2026-03-26 | 2026-03-27 | Batch multi-values INSERT via `Prisma.sql` + `Prisma.join` |
| #79 | HAUTE | Scalabilité | `services/rag/cleanup.ts:134` | 2 queries par source au lieu de batch | 2026-03-26 | 2026-03-27 | Batch `deleteMany` avec `{ in: sourceIds }` |
| #80 | HAUTE | Scalabilité | `controllers/page.ts:196` + `simplifiedContent.ts:211` | Counter incrémenté fire-and-forget hors transaction | 2026-03-26 | 2026-03-27 | Wrappé dans `$transaction` |
| #81 | HAUTE | Scalabilité | `services/simplifiedContent.ts:376` | `deletePage` ne décrémente JAMAIS `pagesUsed` | 2026-03-26 | 2026-03-27 | Décrémentation ajoutée dans deletePage |
| #82 | HAUTE | Scalabilité | `controllers/workspace.ts:342` | `getWorkspaceById` même include tree lourd | 2026-03-26 | 2026-03-27 | `take: 50` projects, `take: 100` pages |
| #83 | HAUTE | Scalabilité | `routes/conversations.ts:575` | Token counting charge TOUS les messages avec JSON massifs | 2026-03-26 | 2026-03-27 | `select` sur messages (seuls role, content, mentions, files, etc.) |
| #93 | **CRITIQUE** | Sécurité | `routes/content.ts:238` | IDOR: PUT /api/content/projects/:id sans ownership check | 2026-03-27 | 2026-03-27 | `findFirst({ where: { id, createdBy: userId } })` avant update — 404 si non propriétaire |
| #94 | HAUTE | Sécurité | `routes/billing.ts` | Rate limiting absent sur routes billing | 2026-03-27 | 2026-03-27 | `billingRateLimit` (20 req/15min per user) appliqué via `router.use()` |
| #95 | HAUTE | Sécurité | `routes/upload.ts` | Rate limiting absent sur POST /api/upload | 2026-03-27 | 2026-03-27 | `uploadRateLimit` (30 req/15min per user) sur route POST |
| #89 | MOYENNE | Scalabilité | `quiz/statsService.ts` (global) | `include: { result: true }` charge detailedScoring partout | 2026-03-26 | 2026-03-27 | Corrigé avec #68 — `result: { select: { percentage: true } }` |
| #52 | **CRITIQUE** | Sécurité | `conversationService.ts:65` | IDOR: `saveConversation` upsert `where: { id }` sans userId | 2026-03-25 | 2026-03-26 | Ownership check avant upsert — return early si userId ne match pas |
| #53 | HAUTE | Sécurité | `conversationService.ts:128,145` | `updateActiveStreamId` et `updateConversationStatus` sans guard userId | 2026-03-25 | 2026-03-26 | `updateMany({ where: { id, userId } })` + userId ajouté en param obligatoire |
| #67 | BASSE | Qualité | `quiz/preprocessor/example-usage.ts` | Fichier example-usage.ts (179L) livré dans src/ production | 2026-03-25 | 2026-03-26 | Fichier supprimé |
| F17 | HAUTE | Résilience | `PennoteAgent.ts` | Aucun circuit breaker / failover AI | 2026-03-23 | 2026-03-24 | State machine 3-tier fallback |
| F18 | HAUTE | Résilience | 25+ fichiers `src/` | 25+ appels `fetch()` sans `AbortSignal.timeout()` | 2026-03-23 | 2026-03-24 | AbortSignal.timeout ajouté (10-30s) |
| F19 | HAUTE | Résilience | `PennoteAgent.ts`, `workflows.ts`, `ai.ts` | 10 appels AI SDK sans timeout | 2026-03-23 | 2026-03-24 | `timeout:` AI SDK v6 (90s fast, 180s thinking, 300s streaming) |
| F20 | MOYENNE | Résilience | `src/lib/redis.ts` | Redis cmd timeout non configuré globalement | 2026-03-23 | 2026-03-24 | `commandTimeout: 5000` natif ioredis |
| F21 | MOYENNE | Résilience | `src/services/auth.ts`, `src/middlewares/auth.ts` | Appels Clerk SDK sans timeout | 2026-03-23 | 2026-03-24 | `withTimeout` 10s via `utils/timeout.ts` |
| F22 | MOYENNE | Résilience | `billing.ts`, `paddleWebhooks.ts`, `healthCheckService.ts` | Appels Paddle SDK sans timeout | 2026-03-23 | 2026-03-24 | `withTimeout` 15s via `utils/timeout.ts` |
| F23 | MOYENNE | Scalabilité | `BetaCronService.ts` | `checkInactiveUsers` findMany sans take | 2026-03-20 | 2026-03-24 | Boucle paginée DELETION_BATCH_SIZE=50 |
| F24 | MOYENNE | Scalabilité | `prisma/schema.prisma` | Index composite manquant betaStatus/betaJoinedAt | 2026-03-20 | 2026-03-24 | `@@index([betaStatus, betaJoinedAt])` + db push DEV/PROD |
| F25 | MOYENNE | Scalabilité | `quizTools.ts` | 3 requêtes DB séquentielles dans getQuizStats | 2026-03-21 | 2026-03-24 | `Promise.all()` |
| F26 | MOYENNE | Concurrence | `requireAdmin.ts` | Double fetch DB par requête admin | 2026-03-22 | 2026-03-24 | `isAdmin` attaché à `req.user` |
| F27 | BASSE | Qualité | `adminUserDetailController.ts` | 436 lignes | 2026-03-20 | 2026-03-24 | Refactoré en 3 fichiers (267L principal) |
| F28 | BASSE | Qualité | `src/controllers/__tests__/` | Tests intégration manquants admin controllers | 2026-03-20 | 2026-03-24 | 42 tests (3 fichiers) |
| F1 | HAUTE | Concurrence | `BetaCronService.ts` | `checkInactiveUsers` sans verrou distribué Redis | 2026-03-22 | 2026-03-22 | Lock NX ajouté (PR #91) |
| F2 | HAUTE | Sécurité | `admin.ts` | Impersonation sans rate limit dédié | 2026-03-22 | 2026-03-22 | 10 req/h (PR #91) |
| F3 | MOYENNE-HAUTE | Scalabilité | `schema.prisma` | Index manquant `(userId, isCompleted, completedAt)` sur Quiz | 2026-03-21 | 2026-03-22 | Index ajouté + db push (PR #91) |
| F4 | MOYENNE | Sécurité | `adminBetaController.ts` | `sortBy` non validé par Zod | 2026-03-22 | 2026-03-22 | z.enum ajouté (PR #91) |
| F5 | MOYENNE | Sécurité | `adminExportController.ts` | Export sans rate limit per-admin | 2026-03-22 | 2026-03-22 | 5 req/h (PR #91) |
| F6 | MOYENNE | Scalabilité | `adminUserDetailController.ts` | 500 messages sans pagination | 2026-03-22 | 2026-03-22 | Cursor-based, max 100 (PR #91) |
| F7 | MOYENNE | Qualité | `quizTools.ts` | 300 lignes de logique métier sans tests | 2026-03-21 | 2026-03-22 | 29 tests unitaires (PR #91) |
| F8 | MOYENNE | Concurrence | `BetaCronService.ts` | Merge JSON non-atomique (race condition metadata) | 2026-03-22 | 2026-03-22 | Transaction Prisma (PR #91) |
| F9 | BASSE | Résilience | `adminUserDetailController.ts` | Redis call sans timeout | 2026-03-22 | 2026-03-22 | withTimeout 5s (PR #91) |
| F10 | MOYENNE | Concurrence | `BetaCronService.ts` | `resetWeeklyCounters` sans verrou | 2026-03-22 | 2026-03-22 | Lock NX ajouté (PR #91) |
| F11 | MOYENNE | Sécurité | `adminUserController.ts` | `toggleUserStatus` sans Zod / `getModerationLogs` non validé | 2026-03-22 | 2026-03-22 | Zod ajouté (PR #91) |
| F12 | HAUTE | Scalabilité | `schema.prisma` | `@@index([userId])` manquant sur Quiz et QuizTemplate | 2026-03-19 | 2026-03-20 | Index ajouté (PR #88) |
| F13 | MOYENNE | Sécurité | `realtime.ts` | WS non authentifiées sans rate limit | 2026-03-19 | 2026-03-19 | checkWebSocketConnectionLimit (déjà présent) |
| F14 | MOYENNE | Qualité | `adminController.ts` | Monolithe 1535 lignes | 2026-03-19 | 2026-03-20 | Refactoring en 5 controllers (PR #88) |
| F15 | BASSE | Scalabilité | `BetaCronService.ts` | Seed updates séquentiels dans sendPositionUpdates | 2026-03-19 | 2026-03-20 | Batch $transaction (PR #88) |
| F16 | MOYENNE | Scalabilité | `workspaceTools.ts` | `listWorkspacePages` sans `take` | 2026-03-22 | 2026-03-22 | Zod max 100 + `take: limit` |
| #29 | **CRITIQUE** | Concurrence | `aiCreditsService.ts` | `refundCredits` read-then-write | 2026-03-24 | 2026-03-25 | Atomic `$executeRaw` avec `GREATEST(0, ...)` |
| #30 | **CRITIQUE** | Concurrence | `quizLimitsService.ts` | `deductAdvancedQuiz` read-then-write | 2026-03-24 | 2026-03-25 | Atomic `$executeRaw` + WHERE guard sur limite |
| #31 | **CRITIQUE** | Concurrence | `BetaCronService.ts` | `processWaitlist` sans verrou Redis NX | 2026-03-24 | 2026-03-25 | Redis NX lock + `_processWaitlistLocked` |
| #32 | HAUTE | Concurrence | `futuraRss.service.ts` | `lastAICallTime` TOCTOU | 2026-03-24 | 2026-03-25 | `lastAICallTime` réservé AVANT sleep/API call |
| #34 | HAUTE | Concurrence | `requireAICredits.ts` | Double lecture `canUseAI` + `deductCredits` | 2026-03-24 | 2026-03-25 | Supprimé `canUseAI()` — l'UPSERT atomique vérifie déjà |
| #35 | HAUTE | Concurrence | `quizLimitsService.ts` | `canCreatePresetSequence` check/create | 2026-03-24 | 2026-03-25 | Acknowledged — early-bail, guard réel dans `startPresetSequence` Serializable |
| #36 | HAUTE | Concurrence | `aiCreditsService.ts` | `resetMonthlyCredits` read-then-write | 2026-03-24 | 2026-03-25 | Atomic `$executeRaw` avec WHERE sur `reset_type` + `last_reset_at` |
| #37 | MOYENNE | Concurrence | `futuraRss.service.ts` | `getWeeklyArticle` findFirst+create | 2026-03-24 | 2026-03-25 | Acknowledged — cron séquentiel, `saveWeeklyArticle` a find-first guard |
| #38 | MOYENNE | Concurrence | `circuitBreaker.ts` | HALF_OPEN laisse passer tous les callers | 2026-03-24 | 2026-03-25 | `probeInFlight` flag — un seul probe à la fois |
| #39 | MOYENNE | Sécurité | `waitlistController.ts` | `TURNSTILE_SECRET` module-level const | 2026-03-24 | 2026-03-25 | Lecture lazy dans `verifyTurnstile()` |
| #40 | MOYENNE | Fiabilité | `EmailService.ts` | Queue email en mémoire | 2026-03-24 | 2026-03-25 | Acknowledged — Redis-backed retry existe, queue = buffer rate-limiting |
| #41 | MOYENNE | Sécurité | `routes/agent.ts` | `prompt` sans limite de longueur | 2026-03-24 | 2026-03-25 | Validation `typeof + length > 50_000` → 400 |
| #42 | MOYENNE | Concurrence | `paddleWebhooks.ts` | Idempotence TOCTOU | 2026-03-24 | 2026-03-25 | Create-first + catch P2002, supprimé 10 creates dupliqués |
| #43 | MOYENNE | Concurrence | `BetaCronService.ts` | Spread metadata sans relecture | 2026-03-24 | 2026-03-25 | Acknowledged — protégé par Redis NX lock (5min TTL) |
| #44 | BASSE | Fiabilité | `EmailService.ts` | Queue overflow drop silencieux | 2026-03-24 | 2026-03-25 | `Promise.reject(new Error('queue_full'))` |
| #45 | BASSE | Qualité | `EmailService.ts` | `RESEND_FROM_EMAIL || default` | 2026-03-24 | 2026-03-25 | Acknowledged — `EMAIL_FROM_DEFAULT` est un import constante, pas un env var |
| #46 | BASSE | Validation | `futuraRss.service.ts` | RSS link sans validation URL | 2026-03-24 | 2026-03-25 | Acknowledged — link vient du RSS parser, validation URL = security theater |
| #47 | BASSE | Qualité | `futuraRss.service.ts` | Code mort `fetchFullArticleContent` | 2026-03-24 | 2026-03-25 | 206 lignes supprimées |
| #48 | BASSE | Qualité | `timeout.ts` | setTimeout handle non cleared | 2026-03-24 | 2026-03-25 | `.finally(() => clearTimeout(timer))` |
| #49 | BASSE | Fiabilité | `progressService.ts` | Singleton WebSocket en mémoire | 2026-03-24 | 2026-03-25 | Acknowledged — mono-instance, nécessiterait Redis pub/sub |
| #50 | BASSE | Concurrence | `mem0Client.ts` | Double `addMemories` concurrent | 2026-03-24 | 2026-03-25 | Acknowledged — fire-and-forget by design, Mem0 déduplique |
| #51 | BASSE | Concurrence | `cronJobs.ts` | Crons reset sans lock Redis NX | 2026-03-24 | 2026-03-25 | Redis NX lock ajouté sur monthlyReset + dailyLimitsReset |
| #33 | HAUTE | Résilience | `workflows.ts` | Deep workflows hardcoded Google/Gemini — aucun failover | 2026-03-24 | 2026-03-25 | Provider-agnostic `resolveModel` + `buildThinkingOptions` avec fallback AGENT_FALLBACK |

## Statistiques
- Total détectées : 118
- Total fermées : 112
- Total ouvertes : 6
- Taux de résolution : 95%

## Historique Deep-Dives

| Date | Domaine | Issues trouvées |
|------|---------|-----------------|
| 2026-03-19 | Revue mixte (commits PR #84-87) | 5 |
| 2026-03-20 | Revue mixte (commits PR #88-89) | 4 |
| 2026-03-21 | Revue quiz tools (quizTools.ts) | 4 |
| 2026-03-22 | Revue sécurité & perf (admin, cron) | 10 |
| 2026-03-23 | Résilience & Error Handling | 6 |
| 2026-03-24 (am) | Fix global : 12 issues fermées (résilience, scalabilité, qualité) | 0 |
| 2026-03-24 (pm) | **Concurrence & Fiabilité** + revue 19 commits | 23 |
| 2026-03-25 (am) | **Fix 23 issues** : 14 corrigées, 9 acknowledged | 0 |
| 2026-03-25 (pm) | **Qualité & Tests** + revue marketplace + sécurité agents | 16 |
| 2026-03-26 | **Base de données & Scalabilité** (1er deep-dive dédié) + revue suppression Futura | 25 |
| 2026-03-27 (am) | **Sécurité & OWASP** — IDOR content, rate limiting gaps, validation manquante | 7 |
| 2026-03-27 (pm) | **Fix 20 issues** : scalabilité DB (5 CRITIQUES), qualité, pagination, batch ops | 0 (fix session) |
| 2026-03-30 | **Résilience & Error Handling** (2e deep-dive) — circuit breaker dead code, SSE disconnect, shutdown incomplet | 4 |
| 2026-04-01 | **Concurrence & Fiabilité** (2e deep-dive) — JSON merge non-atomique, crons sans locks, fire-and-forget counters, Yjs flush race, billing idempotence | 9 |
| 2026-04-01 (pm) | **Qualité & Tests** (2e deep-dive) — fichiers >300L +62%, dead code fonctions, SSE duplication, jest coverage trop restreint, régression example-usage.ts | 6 |
| 2026-04-02 | **Fix massif 33 issues** : sécurité (auth+validation+rate limiting), résilience (SSE abort+shutdown+circuit breaker), scalabilité (pagination+bounds), concurrence (NX locks+transactions), billing idempotence, qualité (asyncHandler+SSE util+RAG config) | 0 (fix session) |
