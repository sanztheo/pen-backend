# Issues Tracker — Backend

> Source de vérité persistante. Mis à jour automatiquement à chaque audit.
> Dernière mise à jour : 2026-03-26

## Ouvertes

| # | Sévérité | Domaine | Fichier | Problème | Détecté le | Dernière mention |
|---|----------|---------|---------|----------|------------|------------------|
| #52 | **CRITIQUE** | Sécurité | `conversationService.ts:77` | IDOR: `saveConversation` upsert `where: { id }` sans userId — un user peut écraser la conversation d'un autre | 2026-03-25 | 2026-03-26 |
| #54 | HAUTE | Qualité | `src/` (3 fichiers) | 3 implémentations retry dupliquées: `lib/retry.ts`, `lib/retryWithBackoff.ts`, `quiz/assistant/utils/retry.ts` | 2026-03-25 | 2026-03-26 |
| #55 | HAUTE | Qualité | `lib/secureLogging.ts` + `middlewares/secureLogging.ts` | 2 modules secureLogging dupliqués (fonctionnel vs class-based) | 2026-03-25 | 2026-03-26 |
| #56 | HAUTE | Qualité | 16 fichiers `src/` | 38 env vars avec fallback silencieux (dont DATABASE_URL, CLIENT_URL) — convention: throw si absent | 2026-03-25 | 2026-03-26 |
| #57 | HAUTE | Tests | `src/` global | Couverture tests ~15% : quiz (7k+ L), RAG (3.3k L), billing (1.5k L), agent (3.3k L), middlewares (2.1k L), routes (6.7k L) sans aucun test | 2026-03-25 | 2026-03-26 |
| #58 | MOYENNE | Sécurité | `routes/agents.ts` | CRUD agents sans rate limiting (sauf generate-prompt) | 2026-03-25 | 2026-03-26 |
| #59 | MOYENNE | Sécurité | `routes/agents.ts:83` | Pas de limite sur le nombre d'agents custom par user (storage abuse) | 2026-03-25 | 2026-03-26 |
| #60 | MOYENNE | Qualité | `src/` (60 fichiers) | 60 fichiers production > 300 lignes (top: quizService 2386L, correctionGenerator 2169L, quizStreaming 1918L) | 2026-03-25 | 2026-03-26 |
| #61 | MOYENNE | Qualité | 5+ modules `src/` | Dead code: ~5000+ lignes de modules non importés (documentSearchService, fewShotExamples, promptOptimizer exports) | 2026-03-25 | 2026-03-26 |
| #62 | MOYENNE | Qualité | 27 fichiers routes/controllers | Catch-500 dupliqué partout — asyncHandler wrapper manquant | 2026-03-25 | 2026-03-26 |
| #63 | BASSE | Sécurité | `routes/agents.ts:217` | Favorites: validation manuelle au lieu de Zod (`agentId` sans check longueur) | 2026-03-25 | 2026-03-26 |
| #64 | BASSE | Scalabilité | `routes/agent.ts:852` | `listConversations` limit query param non borné (user peut envoyer `?limit=999999`) | 2026-03-25 | 2026-03-26 |
| #65 | BASSE | Scalabilité | `schema.prisma:797` | Index composite `CustomAgent(userId, isActive)` manquant | 2026-03-25 | 2026-03-26 |
| #66 | BASSE | Qualité | `src/services/rag/*.ts` | Config RAG dupliquée dans 4 fichiers (`RAG_EMBEDDING_CONCURRENCY || "2"`) | 2026-03-25 | 2026-03-26 |
| #68 | **CRITIQUE** | Scalabilité | `quiz/statsService.ts` (7 méthodes) | 7 endpoints stats chargent TOUS les quizzes d'un user sans pagination — include `result: true` charge JSON massifs (detailedScoring) | 2026-03-26 | 2026-03-26 |
| #69 | **CRITIQUE** | Scalabilité | `quiz/quizService.ts:897,926` | `getQuizHistory` déclare `limit`/`offset` en params mais ne les utilise JAMAIS dans les queries — pagination fictive | 2026-03-26 | 2026-03-26 |
| #70 | **CRITIQUE** | Scalabilité | `quiz/quizService.ts:1543` | `getUserProgressStats` charge tous les quizzes complétés avec 3 tables jointes (result + template) sans take | 2026-03-26 | 2026-03-26 |
| #71 | **CRITIQUE** | Scalabilité | `schema.prisma` (Page model) | Index manquants `[workspaceId, isArchived]` et `[projectId, isArchived]` sur Page — 20+ queries font full table scan | 2026-03-26 | 2026-03-26 |
| #72 | **CRITIQUE** | Scalabilité | `controllers/workspace.ts:244` | `getWorkspaces` include tree 3 niveaux (workspace→projects→pages) sans pagination — charge toutes les pages de tous les projets | 2026-03-26 | 2026-03-26 |
| #73 | HAUTE | Scalabilité | `routes/conversations.ts:276` | GET `/conversations/:id/messages` charge TOUS les messages sans pagination — problème à 500+ messages | 2026-03-26 | 2026-03-26 |
| #74 | HAUTE | Scalabilité | `services/rag/sessionMemory.ts:292` | `getSessionStats` charge toutes les sessions RAG d'un user sans take | 2026-03-26 | 2026-03-26 |
| #75 | HAUTE | Scalabilité | `services/AccountExportService.ts:114` | `fetchQuizzes` sans take (contrairement aux autres fetch* qui ont EXPORT_MAX_ITEMS) | 2026-03-26 | 2026-03-26 |
| #76 | HAUTE | Scalabilité | `schema.prisma` | Index manquants: `Project[workspaceId, isArchived]` et `QuizSequence[userId]` | 2026-03-26 | 2026-03-26 |
| #77 | HAUTE | Scalabilité | `controllers/page.ts:835,931` | deletePage/cleanupArchived: boucle N+1 séquentielle sur RAG removal (1 appel par page) | 2026-03-26 | 2026-03-26 |
| #78 | HAUTE | Scalabilité | `services/rag/userPages.ts:452` | Chunk INSERT individuel (`$executeRaw` en boucle) — 100 round-trips DB au lieu de batch multi-values | 2026-03-26 | 2026-03-26 |
| #79 | HAUTE | Scalabilité | `services/rag/cleanup.ts:134` | `processBatch`: 2 queries par source (deleteMany chunks + delete source) au lieu de batch DELETE ... IN | 2026-03-26 | 2026-03-26 |
| #80 | HAUTE | Scalabilité | `controllers/page.ts:196` + `simplifiedContent.ts:211` | Counter `pagesUsed`/`projectsUsed` incrémenté fire-and-forget hors transaction — désync si échec | 2026-03-26 | 2026-03-26 |
| #81 | HAUTE | Scalabilité | `services/simplifiedContent.ts:376` | `deletePage` ne décrémente JAMAIS `pagesUsed` (vs controllers/page.ts qui le fait correctement) | 2026-03-26 | 2026-03-26 |
| #82 | HAUTE | Scalabilité | `controllers/workspace.ts:342` | `getWorkspaceById` même include tree lourd que getWorkspaces — charge tout sans limite | 2026-03-26 | 2026-03-26 |
| #83 | HAUTE | Scalabilité | `routes/conversations.ts:575` | Token counting charge TOUS les messages avec colonnes JSON massives (thinking, toolCalls, intermediateThinkingBlocks) | 2026-03-26 | 2026-03-26 |
| #84 | MOYENNE | Scalabilité | `services/simplifiedContent.ts:22,62` | `_getUserProjects`/`_getUserRootPages` sans pagination (sidebar) | 2026-03-26 | 2026-03-26 |
| #85 | MOYENNE | Scalabilité | `services/rag/cleanup.ts:112,281` | `getStaleSources`/`cleanupOldUserFiles` findMany sans take | 2026-03-26 | 2026-03-26 |
| #86 | MOYENNE | Scalabilité | `schema.prisma` (AIConversation) | Index composite `[userId, workspaceId, isActive]` manquant — query fréquente conversations actives | 2026-03-26 | 2026-03-26 |
| #87 | MOYENNE | Scalabilité | `services/AccountExportService.ts:131` | `fetchConversations` exporte les conversations soft-deleted (pas de filtre `isActive: true`) | 2026-03-26 | 2026-03-26 |
| #88 | MOYENNE | Scalabilité | `controllers/page.ts:640` | Slug generation race condition — check-then-act sans transaction (2 requêtes parallèles → même slug) | 2026-03-26 | 2026-03-26 |
| #89 | MOYENNE | Scalabilité | `quiz/statsService.ts` (global) | `include: { result: true }` charge `detailedScoring` (JSON volumineux) pour CHAQUE quiz dans les stats | 2026-03-26 | 2026-03-26 |
| #90 | BASSE | Scalabilité | `schema.prisma` (ActivityLog) | Index `[userId, createdAt]` manquant — queries admin filtrent souvent par range temporel | 2026-03-26 | 2026-03-26 |
| #91 | BASSE | Scalabilité | `services/simplifiedContent.ts` | Children projects sans filtre `isArchived: false` — sous-projets archivés inclus | 2026-03-26 | 2026-03-26 |
| #92 | BASSE | Qualité | `scripts/db/reset-database.ts:96` | Référence `prisma.dailyArticle.deleteMany()` après suppression du model DailyArticle — build cassé | 2026-03-26 | 2026-03-26 |

## Fermées

| # | Sévérité | Domaine | Fichier | Problème | Détecté | Fermé | Comment |
|---|----------|---------|---------|----------|---------|-------|---------|
| #53 | HAUTE | Sécurité | `conversationService.ts:128,145` | `updateActiveStreamId` et `updateConversationStatus` sans guard userId | 2026-03-25 | 2026-03-26 | Vérifié: les 2 méthodes incluent maintenant `where: { id, userId }` |
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
- Total détectées : 92
- Total fermées : 53
- Total ouvertes : 39
- Taux de résolution : 58%

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
