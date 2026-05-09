# pen-backend

> API Pennote — Node.js + Prisma + Vercel AI SDK. Streaming AI multi-fournisseurs, collaboration Yjs, facturation Paddle, RAG avec pgvector.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)]()
[![AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-v6-black)]()

> **Traductions :** [English](README.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

> **🟡 Statut du projet — open source depuis mai 2026.** Pennote a été conçu comme un SaaS mais n'a jamais atteint le product-market fit (livré à environ 50 utilisateurs, sans traction). Plutôt que de laisser le code pourrir en privé, nous l'avons ouvert. Utilisez-le, forkez-le, apprenez-en, hébergez votre propre instance. Les issues et PR sont bienvenues — voir [`CONTRIBUTING.md`](CONTRIBUTING.md). Maintenance au mieux des efforts.

## De quoi il s'agit

L'API HTTP / WebSocket derrière Pennote. Service Node basé sur Express avec Prisma sur deux schémas Postgres (principal + pgvector pour les embeddings), streaming AI sur SSE via le Vercel AI SDK, et collaboration Yjs WebSocket avec persistance Postgres. Ce dépôt est aussi un sous-module du monorepo [Pennote](https://github.com/sanztheo/Pennote).

## Points forts

- **Doubles schémas Prisma** — données principales de l'app plus un schéma pgvector séparé pour les embeddings RAG, générés depuis `prisma/schema.prisma` et `prisma/schema-embeddings.prisma`
- **Failover AI multi-fournisseurs** via Vercel AI SDK v6 — Anthropic, OpenAI, Google, DeepSeek, Moonshot, xAI ; routage par fournisseur selon le mode agent avec propagation timeout + abort
- **Streaming SSE reprenable** — les clients peuvent se déconnecter et se reconnecter en pleine complétion via `resumable-stream` ; les tokens de chat sont persistés au fur et à mesure
- **Collaboration CRDT Yjs** — serveur WebSocket (`ws` + `y-protocols`) avec snapshots persistés en Postgres ; réconciliation hors-ligne à la reconnexion
- **Pipeline d'intelligence quiz** — extraction de concepts, séquençage adaptatif, génération en streaming, agrégation de stats ; benchmarké via `npm run benchmark:quiz`
- **Workers BullMQ** sur Redis pour les jobs en arrière-plan (cleanup, embeddings, tâches planifiées)
- **Garde-fou single-replica au boot** — le serveur throw au démarrage si `REPLICA_COUNT > 1` ; nécessaire car la map de documents Yjs, le mutex page-edit et le cache de résultats d'outils sont tous en mémoire
- **Idempotence des webhooks Paddle** — vérification de signature sur raw-body avec gardes anti-double-traitement sur les événements de cycle de vie d'abonnement
- **~200 endpoints sur 31 fichiers de routes**, structurés autour de couches de middleware (auth → autorisation → validation → handler)

## Stack technique

| Couche | Choix |
|--------|-------|
| Runtime | Node.js 22, ESM |
| HTTP | Express 4, Helmet, CORS, compression |
| Base de données | PostgreSQL via Prisma 6 (double schéma) |
| Vector DB | pgvector (schéma Postgres séparé) |
| Cache / queues | Redis (ioredis), BullMQ |
| Auth | Clerk (`@clerk/backend`) |
| Facturation | Paddle (`@paddle/paddle-node-sdk`) + vérification HMAC raw-body |
| AI | Vercel AI SDK v6, 6 packages fournisseurs, fallback OpenAI SDK |
| Embeddings | `@xenova/transformers` (local) + OpenAI |
| Temps réel | `ws`, `y-protocols`, `socket.io` (legacy) |
| Streaming | `resumable-stream` pour reprise SSE |
| Fichiers | Multer, Sharp, Cloudinary, mammoth (DOCX), pdf-lib |
| Email | Resend |
| Validation | Zod |
| Rate limiting | express-rate-limit + rate-limit-redis |

## Démarrage rapide

```bash
# Cloner (ou travailler dans le monorepo Pennote)
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend

# Installer
npm install

# Configurer
cp .env.example .env
# Renseigner DATABASE_URL, EMBEDDING_DATABASE_URL, REDIS_URL, CLERK_SECRET_KEY, ...

# Générer les clients Prisma (les deux schémas)
npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma

# Lancer les migrations
npm run db:migrate

# Développer (port 3001)
npm run dev          # utilise Infisical pour les secrets — voir ci-dessous
npm run dev:local    # tsx watch nu, lit le .env directement
```

## Variables d'environnement

Le dépôt fournit un `.env.example` avec la liste complète. Variables critiques :

| Variable | Requise | Description |
|----------|---------|-------------|
| `DATABASE_URL` | oui | Chaîne de connexion Postgres principale |
| `EMBEDDING_DATABASE_URL` | oui | Postgres **séparé** avec l'extension `vector` installée |
| `REDIS_URL` | oui | Redis pour cache, rate limiting, BullMQ |
| `CLIENT_URL` | oui | Origine du frontend (allow-list CORS) |
| `CLERK_SECRET_KEY` | oui | Clé backend Clerk |
| `CLERK_WEBHOOK_SECRET` | oui | Pour vérifier les webhooks Clerk |
| `OPENAI_API_KEY` | une+ | Au moins une clé fournisseur AI requise |
| `ANTHROPIC_API_KEY` | une+ | |
| `GOOGLE_GENERATIVE_AI_API_KEY` | une+ | |
| `DEEPSEEK_API_KEY` | une+ | |
| `MOONSHOT_API_KEY` | une+ | |
| `XAI_API_KEY` | une+ | |
| `PADDLE_API_KEY` | pour billing | Clé API Paddle Billing |
| `PADDLE_WEBHOOK_SECRET` | pour billing | Secret de signature des webhooks Paddle |
| `ENCRYPTION_KEY` | oui | Hex 32 octets utilisé pour le chiffrement at-rest des champs sensibles |
| `RESEND_API_KEY` | pour email | Email transactionnel |
| `CLOUDINARY_*` | pour uploads | Hébergement d'images |
| `REPLICA_COUNT` | optionnelle | Défaut `1`. Le boot refuse de démarrer si > 1. |

Convention : les env vars throw si manquantes — pas de fallback silencieux. `if (!process.env.X) throw new Error(...)`.

Les secrets en production sont gérés via [Infisical](https://infisical.com/). Les scripts `dev` enveloppent automatiquement les commandes avec `infisical run --env=dev --path=/Backend --`.

> **Piège pgvector :** `EMBEDDING_DATABASE_URL` doit pointer vers une instance Postgres avec `CREATE EXTENSION vector;` déjà exécuté. Le client Prisma de ce schéma est généré séparément et vit dans `src/lib/prismaEmbeddings.ts`. Importez toujours `Prisma` depuis le même package que le client utilisé, sinon `Prisma.raw()` est silencieusement coercé en JSON.

## Structure du projet

```
src/
├── index.ts            # Bootstrap, app Express, routeurs montés
├── routes/             # 31 fichiers de routes — un par domaine
├── controllers/        # Couche d'orchestration mince
├── services/           # Logique métier, routage fournisseur AI, pipeline quiz
├── middlewares/        # auth, autorisation, validation, rate-limit
├── workers/            # Workers BullMQ
├── jobs/               # Définitions de jobs enqueued sur BullMQ
├── cron/               # Plannings node-cron
├── lib/                # Clients Prisma (principal + embeddings), Redis, clients AI
├── validators/         # Schémas Zod
├── utils/              # logger, helpers d'erreur, chiffrement, etc.
└── types/              # Types TS partagés
prisma/
├── schema.prisma                # DB principale
└── schema-embeddings.prisma     # DB pgvector
```

## Architecture

**Streaming SSE.** Les endpoints de complétion chat écrivent les deltas via un wrapper `resumable-stream`. L'id du stream est renvoyé d'emblée, donc un client déconnecté peut reprendre depuis le dernier token persisté. Le failover fournisseur a lieu avant le premier octet ; une fois le streaming démarré, un `AbortSignal.timeout()` impose une borne supérieure et `consumeStream()` est toujours appelé après `pipeUIMessageStreamToResponse(res)` pour vidanger les tokens en vol.

**Double client Prisma.** Le client principal vit dans `lib/prisma.ts`. Le client embeddings vit dans `lib/prismaEmbeddings.ts` et utilise un client généré en sortie sur `node_modules/.prisma/client-embeddings`. Ils ne partagent jamais de transaction — les écritures d'embeddings ont lieu en cas de succès du flux parent.

**Persistance Yjs Postgres.** Un serveur WebSocket upgrade les connexions `/yjs/:docId`, instancie un `Y.Doc` par document et persiste snapshots/updates en Postgres. Le garde-fou single-replica au boot garantit qu'un seul process détient la map de documents ; une seconde instance qui tente de démarrer abort bruyamment.

**Idempotence des webhooks.** Les webhooks Paddle passent par une vérification de signature sur raw-body (montée avec `express.raw()` *avant* `express.json()`), puis par un check de clé d'idempotence en base avant tout effet de bord. Voir `src/routes/paddleWebhooks.ts` et `src/routes/paddleWebhookHelpers.ts`.

**Intelligence quiz.** Le contenu source est découpé en chunks, ses concepts extraits (LLM), puis les questions sont streamées et classées par un séquenceur adaptatif qui utilise les réponses récentes de l'utilisateur. L'agrégation de stats tourne sur des workers en arrière-plan.

**Sécurité du cache d'outils.** Tout cache de résultat d'outil doit inclure à la fois `userId` et `workspaceId` dans sa clé (`services/agent/tools/helpers/cacheKey.ts` — `toolCacheKey()`). Une clé qui en omet un ouvre une fuite de données cross-tenant.

## Commandes

```bash
npm run dev                    # Infisical + tsx watch (port 3001)
npm run dev:local              # tsx watch nu avec .env local
npm run build                  # prisma generate (x2) + tsc
npm run start                  # Serveur de production
npm run db:migrate             # prisma migrate dev (migrations sûres)
npm run db:push                # prisma db push (DEV UNIQUEMENT — jamais en prod, jamais --force-reset)
npm run db:studio              # Prisma Studio
npm test                       # Jest
npm run test:coverage          # Rapport de couverture
npm run test:load              # Lanceur de tests de charge
npm run test:load:light        # 5 utilisateurs / 3 requêtes
npm run test:load:medium       # 20 utilisateurs / 10 requêtes
npm run test:load:heavy        # 50 utilisateurs / 20 requêtes
npm run benchmark:quiz         # Benchmark complet du pipeline quiz
npm run benchmark:quiz:small   # ...:medium ...:large ...:xlarge
npm run lint                   # ESLint
npm run format                 # Prettier
```

## Tests

- **Unitaire / intégration :** Jest avec `--experimental-vm-modules` (ESM). Les tests vivent dans `src/__tests__` et `src/tests`.
- **Charge :** `tsx test-load.ts` — nombre d'utilisateurs/requêtes configurable, flags par feature (`--test=quiz`, `--test=credits`).
- **Échelle WebSocket :** `npm run test:artillery` contre `artillery-websocket.yml`.
- **Benchmark quiz :** `npm run benchmark:quiz` mesure la latence sur 4 tailles de contenu.

## Déploiement

Le backend déploie sur **Railway** en **single replica**. Plusieurs replicas corrompraient la map de documents Yjs en mémoire et le mutex page-edit ; le garde-fou de boot refuse de démarrer si `REPLICA_COUNT > 1`. Le build lance `prisma generate` pour les deux schémas avant `tsc`. La production démarre via `node dist/index.js` avec `NODE_OPTIONS=--max-old-space-size=7168`. Migrer vers un lock distribué Redis avant tout scaling horizontal. Voir `docs/guides/deployment-runbook.md` dans le [monorepo](https://github.com/sanztheo/Pennote).

## Roadmap & statut

C'est un snapshot maintenu par la communauté. Le SaaS d'origine n'est plus actif. Nous accepterons les PR qui :

- Corrigent des bugs
- Améliorent la documentation
- Ajoutent des tests manquants
- Implémentent des fonctionnalités avec un cas d'usage clair pour les self-hosters

Nous **déclinerons** probablement les PR qui :

- Restructurent l'architecture sans discussion préalable
- Ajoutent de nouveaux fournisseurs SaaS sans valeur réelle
- Modifient la licence ou l'attribution

## Contribuer

Voir [`CONTRIBUTING.md`](CONTRIBUTING.md) et [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md). Tous les contributeurs doivent accepter le [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Sécurité

Si vous découvrez une vulnérabilité, **n'ouvrez pas d'issue publique**. Voir [`SECURITY.md`](SECURITY.md) — signalez à <sanztheopro@gmail.com>.

## Licence

[GNU AGPLv3](LICENSE). Copyright (C) 2026 Théo Sanz.

Si vous self-hostez une version modifiée de Pennote et la servez à des utilisateurs, l'AGPLv3 vous oblige à publier vos modifications. Cela protège le projet des forks SaaS closed-source. Si vous avez besoin d'une licence différente pour une réutilisation commerciale légitime, contactez <sanztheopro@gmail.com>.

## Remerciements

Construit sur [Express](https://expressjs.com/), [Prisma](https://www.prisma.io/), le [Vercel AI SDK](https://sdk.vercel.ai/), [Yjs](https://yjs.dev/), [BullMQ](https://docs.bullmq.io/), [Clerk](https://clerk.com/) et [Paddle](https://www.paddle.com/). Merci à tous les mainteneurs upstream.

## Contact

- Mainteneur : Théo Sanz
- Email : <sanztheopro@gmail.com>
- Issues : [GitHub Issues](https://github.com/sanztheo/pen-backend/issues)
- Discussions : [GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)
