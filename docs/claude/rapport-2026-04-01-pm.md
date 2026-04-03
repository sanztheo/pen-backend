# Rapport d'Audit Backend — 2026-04-01 (après-midi)

**Deep-dive du jour :** Qualité & Tests
**Raison du choix :** Dernier audit de ce domaine le 2026-03-25 (il y a 7 jours)

---

## PROGRESSION
- Issues ouvertes : 33 (dont 6 nouvelles aujourd'hui, 1 fermée)
- Issues fermées depuis le dernier rapport : 1
- Taux de résolution global : 71%
- Issues critiques ouvertes : 0

### Issues fermées récemment

| # | Problème | Fermé comment |
|---|----------|---------------|
| #92 | `reset-database.ts` référence model `DailyArticle` supprimé | Vérifié — plus aucune occurrence de `dailyArticle` dans `src/`. Supprimé lors du nettoyage Futura. |

### Issues qui traînent (ouvertes depuis > 7 jours)

| # | Sévérité | Problème | Ouverte depuis |
|---|----------|----------|----------------|
| #57 | HAUTE | Couverture tests ~15% (232 fichiers sans tests) | 2026-03-25 (7j) |
| #58 | MOYENNE | CRUD agents sans rate limiting | 2026-03-25 (7j) |
| #59 | MOYENNE | Pas de limite agents custom par user | 2026-03-25 (7j) |
| #60 | MOYENNE | 97 fichiers > 300 lignes (était 60, +62%) | 2026-03-25 (7j) |
| #61 | MOYENNE | Dead code ~5000+ lignes | 2026-03-25 (7j) |
| #62 | MOYENNE | catch-500 dupliqué (68+ occurrences, 20+ fichiers) | 2026-03-25 (7j) |
| #63 | BASSE | Favorites validation manuelle au lieu de Zod | 2026-03-25 (7j) |
| #64 | BASSE | `listConversations` limit non borné | 2026-03-25 (7j) |
| #65 | BASSE | Index composite `CustomAgent(userId, isActive)` manquant | 2026-03-25 (7j) |
| #66 | BASSE | Config RAG dupliquée dans 4 fichiers | 2026-03-25 (7j) |

---

## REVIEW DES CHANGEMENTS RÉCENTS

### Commits sur main (24h)
Uniquement 2 commits d'audit du rapport précédent :
- `b690066` audit: backend 2026-04-01 — ajout findings idempotence billing
- `6c2dfd0` audit: backend 2026-04-01 — concurrence & fiabilité

**Aucun changement de code production.** Pas de PRs ouvertes.

---

## DEEP-DIVE : QUALITÉ & TESTS

### 1. Convention `console.log` vs `logger`

**Résultat : CONFORME.** Zéro violation dans le code production. Les seules occurrences sont dans des fichiers de test (`__tests__/`).

### 2. Usage de `any` en TypeScript

**Résultat : MINIMAL (4 occurrences justifiées).**
- `PennoteAgent.ts:193` — return type `buildProviderOptions` avec eslint-disable intentionnel
- `express.d.ts:18,22` — shims pour modules non-typés (`pdf-parse`)
- `pdf-parse.d.ts:8` — interface `PDFParseResult.metadata`

Tous justifiés — aucune issue créée.

### 3. Fichiers > 300 lignes

**Résultat : DÉGRADATION SIGNIFICATIVE.**

- **Avant (2026-03-25)** : 60 fichiers > 300L
- **Maintenant** : **97 fichiers** > 300L (+62%)

Top 10 fichiers les plus lourds :

| Fichier | Lignes |
|---------|--------|
| `quiz/quizService.ts` | 2390 |
| `quiz/generators/correctionGenerator.ts` | 2169 |
| `controllers/quizStreaming.ts` | 1918 |
| `quiz/assistant/functions.ts` | 1619 |
| `quiz/generators/quizGenerator.ts` | 1471 |
| `rag/index.ts` | 1236 |
| `controllers/page.ts` | 1025 |
| `quiz/documentSearchService.ts` | 985 |
| `agent/workflows.ts` | 939 |
| `quiz/generation/graphicBasedQuizGenerator.ts` | 931 |

L'augmentation de 60→97 fichiers est probablement due à l'ajout de nouvelles features (presets quiz, intelligence pipeline, admin services) sans refactoring.

### 4. Dead Code

**Confirmé : fonctions exportées jamais importées :**

| Fichier | Fonction | Lignes |
|---------|----------|--------|
| `lib/monthlyReset.ts:106` | `testUserReset()` | ~30L |
| `services/cron/resetLimitsCron.ts:62` | `manualResetLimits()` | ~35L |
| `services/cron/resetLimitsCron.ts:98` | `forceResetUserLimits()` | ~30L |

**Régression :** `services/quiz/preprocessor/example-usage.ts` (179L) toujours livré en production. L'issue #67 avait été fermée comme "fichier supprimé" mais le fichier existe toujours.

### 5. Duplication de Code

**5a. Error handling catch-500 (issue #62 confirmée, aggravée)**
- **68+ occurrences** de `res.status(500).json({ error: "..." })` dans 20+ fichiers routes
- Pattern identique copié-collé : `try { ... } catch (error) { logger.error(...); res.status(500).json({ error: "..." }) }`
- Un `asyncHandler` wrapper éliminerait 90% de cette duplication

**5b. SSE headers dupliqués (NOUVEAU)**
- 5 emplacements à travers 3 fichiers configurent les mêmes headers SSE :
  - `quizStreaming.ts` : lignes 411, 718, 1606
  - `agent/chatStream.ts` : ligne 41
  - `quiz/quizController.ts` : ligne 479
- Chaque endroit configure `Content-Type`, `Cache-Control`, `Connection`, et CORS manuellement
- Devrait être un utilitaire `setupSSEHeaders(res)`

**5c. Prisma select patterns (existant #66, élargi)**
- `include: { result: { select: { percentage: true } } }` répété 7x dans `statsService.ts`
- Devrait être une constante `QUIZ_RESULT_SELECT`

### 6. Couverture de Tests

**Résultat : CRITIQUE — couverture effective ~15%**

| Métrique | Valeur |
|----------|--------|
| Fichiers test | 37 |
| Fichiers source sans tests | 232 |
| Controllers sans tests | 50 |
| Services sans tests | 118 |
| Routes sans tests | 36 |
| Middlewares sans tests | 14 |

**Problème structurel :** `jest.config.js` limite `collectCoverageFrom` à `src/services/quiz/intelligence/**/*.ts` et `src/utils/clustering.ts`. Le reste du codebase (95%+) n'a **aucun tracking de couverture**, donc même `npm run test:coverage` ne révèle pas les lacunes.

Top 5 fichiers critiques sans tests :

| Fichier | Lignes | Risque |
|---------|--------|--------|
| `quiz/quizService.ts` | 2390 | Logique métier cœur |
| `quiz/generators/correctionGenerator.ts` | 2169 | Génération AI critique |
| `controllers/quizStreaming.ts` | 1918 | SSE + crédits |
| `quiz/assistant/functions.ts` | 1619 | Orchestration tools |
| `quiz/generators/quizGenerator.ts` | 1471 | Génération quiz |

### 7. TODO / Implémentations Incomplètes

3 TODO dans `quizService.ts` :
- L546 : `examSubject` commenté, en attente de migration
- L1610 : `subjectPerformance: {}` — implémentation vide
- L2282 : Données graphiques — appel service manquant

---

## NOUVELLES ISSUES

| # | Sévérité | Domaine | Fichier | Problème |
|---|----------|---------|---------|----------|
| #113 | BASSE | Qualité | `services/quiz/preprocessor/example-usage.ts` | Fichier example-usage.ts (179L) toujours livré en prod — régression de #67 |
| #114 | BASSE | Qualité | `lib/monthlyReset.ts:106` | Dead code `testUserReset()` exporté mais jamais importé |
| #115 | BASSE | Qualité | `services/cron/resetLimitsCron.ts:62,98` | Dead code `manualResetLimits()` + `forceResetUserLimits()` exportés jamais importés |
| #116 | MOYENNE | Qualité | `quizStreaming.ts`, `chatStream.ts`, `quizController.ts` | SSE headers config dupliquée en 5 endroits sans utilitaire partagé |
| #117 | BASSE | Qualité | `services/quiz/quizService.ts:546,1610,2282` | 3 TODO/implémentations incomplètes (examSubject, subjectPerformance, graphiques) |
| #118 | MOYENNE | Tests | `jest.config.js` | `collectCoverageFrom` limité à quiz/intelligence + clustering — 95%+ du codebase sans tracking |

---

## TABLEAU RÉCAPITULATIF COMPLET (toutes issues ouvertes)

| # | Sévérité | Domaine | Fichier | Problème | Depuis |
|---|----------|---------|---------|----------|--------|
| #57 | HAUTE | Tests | `src/` global | Couverture tests ~15% : 232 fichiers sans tests, 37 fichiers tests | 2026-03-25 |
| #100 | HAUTE | Résilience | `controllers/quizStreaming.ts` | SSE quiz sans `req.on("close")` → crédits gaspillés | 2026-03-30 |
| #58 | MOYENNE | Sécurité | `routes/agents.ts` | CRUD agents sans rate limiting | 2026-03-25 |
| #59 | MOYENNE | Sécurité | `routes/agents.ts:83` | Pas de limite agents custom par user | 2026-03-25 |
| #96 | MOYENNE | Sécurité | `routes/upload.ts:210` | GET /upload/config sans authenticateToken | 2026-03-27 |
| #97 | MOYENNE | Sécurité | `routes/billing.ts:84` | priceId/interval non validés par Zod | 2026-03-27 |
| #98 | MOYENNE | Sécurité | `rag/index.ts:825` + `wikipediaTools.ts:365` | Prisma.raw embedding sans validation numérique | 2026-03-27 |
| #101 | MOYENNE | Résilience | `lib/circuitBreaker.ts` | Circuit breaker dead code (jamais importé) | 2026-03-30 |
| #102 | MOYENNE | Résilience | `index.ts:796-814` | Graceful shutdown incomplet (Redis, WS, server) | 2026-03-30 |
| #104 | MOYENNE | Concurrence | `personalizationController.ts:125-157` | JSON merge non-atomique sur user.settings | 2026-04-01 |
| #110 | MOYENNE | Idempotence | `routes/billing.ts:212-257` | POST /cancel sans vérif cancelAtPeriodEnd | 2026-04-01 |
| #116 | MOYENNE | Qualité | 3 fichiers SSE | SSE headers dupliqués en 5 endroits | 2026-04-01 |
| #118 | MOYENNE | Tests | `jest.config.js` | collectCoverageFrom trop restrictif | 2026-04-01 |
| #60 | MOYENNE | Qualité | `src/` (97 fichiers) | 97 fichiers > 300L (top: quizService 2390L) — était 60 | 2026-03-25 |
| #61 | MOYENNE | Qualité | 5+ modules | Dead code ~5000+ lignes | 2026-03-25 |
| #62 | MOYENNE | Qualité | 20+ fichiers routes | catch-500 dupliqué (68+ occurrences) | 2026-03-25 |
| #84 | MOYENNE | Scalabilité | `simplifiedContent.ts:22,62` | Queries sidebar sans pagination | 2026-03-26 |
| #85 | MOYENNE | Scalabilité | `rag/cleanup.ts:112,281` | findMany sans take | 2026-03-26 |
| #87 | MOYENNE | Scalabilité | `AccountExportService.ts:131` | Export conversations soft-deleted incluses | 2026-03-26 |
| #63 | BASSE | Sécurité | `routes/agents.ts:217` | Favorites sans Zod | 2026-03-25 |
| #99 | BASSE | Sécurité | `routes/conversations.ts` | Rate limiting absent sur CRUD conversations | 2026-03-27 |
| #103 | BASSE | Résilience | `blocknote.ts:682` | `catch {}` silencieux dans toBlockNoteAuto | 2026-03-30 |
| #64 | BASSE | Scalabilité | `conversations.ts:39` | limit query param non borné | 2026-03-25 |
| #65 | BASSE | Scalabilité | `schema.prisma:797` | Index CustomAgent(userId,isActive) manquant | 2026-03-25 |
| #66 | BASSE | Qualité | `rag/*.ts` | Config RAG dupliquée dans 4 fichiers | 2026-03-25 |
| #90 | BASSE | Scalabilité | `schema.prisma` | Index ActivityLog [userId,createdAt] manquant | 2026-03-26 |
| #91 | BASSE | Scalabilité | `simplifiedContent.ts` | Children projects sans filtre isArchived | 2026-03-26 |
| #105 | BASSE | Concurrence | `cron/alertsCron.ts` | Pas de Redis NX lock cron alertes | 2026-04-01 |
| #106 | BASSE | Concurrence | `cron/retentionCron.ts` | Pas de Redis NX lock cron retention | 2026-04-01 |
| #107 | BASSE | Concurrence | `jobs/cronJobs.ts:58-99` | Pas de Redis NX lock cron RAG cleanup | 2026-04-01 |
| #108 | BASSE | Concurrence | `controllers/project.ts:116-130` | projectsUsed increment fire-and-forget | 2026-04-01 |
| #109 | BASSE | Concurrence | `lib/y-prisma.ts:86-107` | flushDocument state hors transaction | 2026-04-01 |
| #111 | BASSE | Idempotence | `routes/billing.ts:79-137` | checkout-session sans dedup | 2026-04-01 |
| #112 | BASSE | Idempotence | `routes/billing.ts:264-302` | upgrade sans dedup | 2026-04-01 |
| #113 | BASSE | Qualité | `preprocessor/example-usage.ts` | 179L livré en prod (régression #67) | 2026-04-01 |
| #114 | BASSE | Qualité | `lib/monthlyReset.ts:106` | Dead code testUserReset() | 2026-04-01 |
| #115 | BASSE | Qualité | `cron/resetLimitsCron.ts:62,98` | Dead code manualResetLimits + forceResetUserLimits | 2026-04-01 |
| #117 | BASSE | Qualité | `quiz/quizService.ts` | 3 TODO implémentations incomplètes | 2026-04-01 |
