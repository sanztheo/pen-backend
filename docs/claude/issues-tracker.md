# Issues Tracker — Backend

> Source de vérité persistante. Mis à jour automatiquement à chaque audit.
> Dernière mise à jour : 2026-03-24

## Ouvertes
| # | Sévérité | Domaine | Fichier | Problème | Détecté le | Dernière mention |
|---|----------|---------|---------|----------|------------|------------------|
| #29 | **CRITIQUE** | Concurrence | `aiCreditsService.ts` | `refundCredits` read-then-write sans transaction — remboursements concurrents perdus ou gonflés | 2026-03-24 | 2026-03-24 |
| #30 | **CRITIQUE** | Concurrence | `quizLimitsService.ts` | `deductAdvancedQuiz` read-then-write — bypass limite quiz/jour via burst parallèle | 2026-03-24 | 2026-03-24 |
| #31 | **CRITIQUE** | Concurrence | `BetaCronService.ts` | `processWaitlist` sans verrou Redis NX — double promotion + double email en multi-instance | 2026-03-24 | 2026-03-24 |
| #32 | HAUTE | Concurrence | `futuraRss.service.ts` | `lastAICallTime` TOCTOU sur état mutable partagé — rate limiter AI contourné sous concurrence | 2026-03-24 | 2026-03-24 |
| #33 | HAUTE | Résilience | `workflows.ts` | Deep workflows hardcoded Google/Gemini — aucun failover si `GEMINI_API_KEY` absent | 2026-03-24 | 2026-03-24 |
| #34 | HAUTE | Concurrence | `requireAICredits.ts` | Double lecture `canUseAI` + `deductCredits` — fenêtre race inutile + requête DB superflue | 2026-03-24 | 2026-03-24 |
| #35 | HAUTE | Concurrence | `quizLimitsService.ts` | `canCreatePresetSequence` check/create non-atomique — double séquence possible via burst | 2026-03-24 | 2026-03-24 |
| #36 | HAUTE | Concurrence | `aiCreditsService.ts` | `resetMonthlyCredits` read-then-write legacy — idempotent mais non protégé | 2026-03-24 | 2026-03-24 |
| #37 | MOYENNE | Concurrence | `futuraRss.service.ts` | `getWeeklyArticle` findFirst+create sans transaction — doublons article possible | 2026-03-24 | 2026-03-24 |
| #38 | MOYENNE | Concurrence | `circuitBreaker.ts` | HALF_OPEN laisse passer tous les callers concurrents au lieu d'un seul probe | 2026-03-24 | 2026-03-24 |
| #39 | MOYENNE | Sécurité | `waitlistController.ts` | `TURNSTILE_SECRET` module-level const — fail-open si env var absente, rotation requiert restart | 2026-03-24 | 2026-03-24 |
| #40 | MOYENNE | Fiabilité | `EmailService.ts` | Queue email en mémoire — emails perdus si crash, non partagée multi-instance | 2026-03-24 | 2026-03-24 |
| #41 | MOYENNE | Sécurité | `routes/agent.ts` | `prompt` sans limite de longueur sur `/workflow` — quota bypass via prompt géant | 2026-03-24 | 2026-03-24 |
| #42 | MOYENNE | Concurrence | `paddleWebhooks.ts` | Idempotence TOCTOU — findUnique+create au lieu de create-first avec catch P2002 | 2026-03-24 | 2026-03-24 |
| #43 | MOYENNE | Concurrence | `BetaCronService.ts` | Spread metadata sans relecture dans seeding — écrasement si lock TTL expire | 2026-03-24 | 2026-03-24 |
| #44 | BASSE | Fiabilité | `EmailService.ts` | Queue overflow drop silencieux avec retour success au caller | 2026-03-24 | 2026-03-24 |
| #45 | BASSE | Qualité | `EmailService.ts` | `RESEND_FROM_EMAIL \|\| default` viole la règle env vars du projet | 2026-03-24 | 2026-03-24 |
| #46 | BASSE | Validation | `futuraRss.service.ts` | RSS `link` stocké sans validation format URL | 2026-03-24 | 2026-03-24 |
| #47 | BASSE | Qualité | `futuraRss.service.ts` | Code mort `fetchFullArticleContent` (104-309) — maintenance burden | 2026-03-24 | 2026-03-24 |
| #48 | BASSE | Qualité | `timeout.ts` | Handle `setTimeout` non cleared quand la promise wrapped résout en premier | 2026-03-24 | 2026-03-24 |
| #49 | BASSE | Fiabilité | `progressService.ts` | Singleton WebSocket en mémoire — invisible en multi-pod | 2026-03-24 | 2026-03-24 |
| #50 | BASSE | Concurrence | `mem0Client.ts` | Double `addMemories` concurrent possible — déduplication dépend de Mem0 externe | 2026-03-24 | 2026-03-24 |
| #51 | BASSE | Concurrence | `cronJobs.ts` | Crons reset mensuel/quotidien sans lock Redis NX (idempotent mais charge DB inutile) | 2026-03-24 | 2026-03-24 |

## Fermées
| # | Sévérité | Domaine | Fichier | Problème | Détecté | Fermé | Comment |
|---|----------|---------|---------|----------|---------|-------|---------|
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

## Statistiques
- Total détectées : 51
- Total fermées : 28
- Total ouvertes : 23
- Taux de résolution : 55%

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
