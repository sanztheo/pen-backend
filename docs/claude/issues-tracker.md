# Issues Tracker — Backend

> Source de vérité persistante. Mis à jour automatiquement à chaque audit.
> Dernière mise à jour : 2026-03-23

## Ouvertes
| # | Sévérité | Domaine | Fichier | Problème | Détecté le | Dernière mention |
|---|----------|---------|---------|----------|------------|------------------|
| 1 | HAUTE | Résilience | `src/services/agent/PennoteAgent.ts` | Aucun circuit breaker / failover AI — si le provider principal tombe, erreur immédiate sans fallback | 2026-03-23 | 2026-03-23 |
| 2 | HAUTE | Résilience | 25+ fichiers `src/` | 25+ appels `fetch()` sans `AbortSignal.timeout()` (RAG, quiz, assistant, agent, admin) | 2026-03-23 | 2026-03-23 |
| 3 | HAUTE | Résilience | `src/services/agent/PennoteAgent.ts`, `workflows.ts` | 9 appels AI SDK (`streamText`/`generateText`) sans timeout ni `maxDurationMs` | 2026-03-23 | 2026-03-23 |
| 4 | MOYENNE | Résilience | `src/lib/redis.ts` | `withTimeout()` existe mais appliqué à 1 seul service — Redis cmd timeout non configuré globalement | 2026-03-23 | 2026-03-23 |
| 5 | MOYENNE | Résilience | `src/services/auth.ts`, `src/middlewares/auth.ts` | Appels Clerk SDK sans timeout (limitation SDK, mais wrappable) | 2026-03-23 | 2026-03-23 |
| 6 | MOYENNE | Résilience | `src/services/billing/paddleBilling.ts`, `src/routes/billing.ts` | Appels Paddle SDK sans timeout | 2026-03-23 | 2026-03-23 |
| 7 | MOYENNE | Scalabilité | `src/services/BetaCronService.ts:60` | `checkInactiveUsers` — `findMany` sans `take` (pic mémoire si panne heartbeat) | 2026-03-20 | 2026-03-23 |
| 8 | MOYENNE | Scalabilité | `prisma/schema.prisma` | Index composite `@@index([betaStatus, betaJoinedAt])` manquant pour `getTrendData` raw SQL | 2026-03-20 | 2026-03-23 |
| 9 | MOYENNE | Scalabilité | `src/services/agent/tools/quizTools.ts:36-77` | 3 requêtes DB séquentielles dans `getQuizStats` — parallélisables avec `Promise.all()` | 2026-03-21 | 2026-03-23 |
| 10 | MOYENNE | Concurrence | `src/middlewares/requireAdmin.ts` | Double fetch DB par requête admin — `isAdmin` non attaché à `req.user` | 2026-03-22 | 2026-03-23 |
| 11 | BASSE | Qualité | `src/controllers/adminUserDetailController.ts` | 436 lignes — dépasse la limite 300 lignes du projet | 2026-03-20 | 2026-03-23 |
| 12 | BASSE | Qualité | `src/controllers/__tests__/` | Tests d'intégration manquants pour adminDashboardController, adminExportController, adminOpsController | 2026-03-20 | 2026-03-23 |

## Fermées
| # | Sévérité | Domaine | Fichier | Problème | Détecté | Fermé | Comment |
|---|----------|---------|---------|----------|---------|-------|---------|
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
- Total détectées : 28
- Total fermées : 16
- Total ouvertes : 12
- Taux de résolution : 57%

## Historique Deep-Dives
| Date | Domaine | Issues trouvées |
|------|---------|-----------------|
| 2026-03-19 | Revue mixte (commits PR #84-87) | 5 |
| 2026-03-20 | Revue mixte (commits PR #88-89) | 4 |
| 2026-03-21 | Revue quiz tools (quizTools.ts) | 4 |
| 2026-03-22 | Revue sécurité & perf (admin, cron) | 10 |
| 2026-03-23 | **Résilience & Error Handling** | 6 |
