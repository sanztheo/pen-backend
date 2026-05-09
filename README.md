# pen-backend

> Pennote API — Node.js + Prisma + Vercel AI SDK. Multi-provider AI streaming, Yjs collaboration, Paddle billing, RAG with pgvector.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)]()
[![AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-v6-black)]()

> **Translations:** [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

> **🟡 Project status — open source from May 2026.** Pennote was built as a SaaS but never reached product-market fit (we shipped to ~50 users, no traction). Rather than letting the code rot privately, we open-sourced it. Use it, fork it, learn from it, host your own. Issues and PRs are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Maintenance is best-effort.

## What it is

The HTTP / WebSocket API behind Pennote. Express-based Node service with Prisma against two Postgres schemas (main + pgvector for embeddings), AI streaming over SSE through the Vercel AI SDK, and Yjs WebSocket collaboration with Postgres persistence. This repo is also a submodule of the [Pennote](https://github.com/sanztheo/Pennote) monorepo.

## Highlights

- **Dual Prisma schemas** — main app data plus a separate pgvector schema for RAG embeddings, generated from `prisma/schema.prisma` and `prisma/schema-embeddings.prisma`
- **Multi-provider AI failover** via Vercel AI SDK v6 — Anthropic, OpenAI, Google, DeepSeek, Moonshot, xAI; provider routing per agent mode with timeout + abort propagation
- **Resumable SSE streaming** — clients can drop and reconnect mid-completion via `resumable-stream`; chat tokens are persisted as they arrive
- **Yjs CRDT collaboration** — WebSocket server (`ws` + `y-protocols`) with Postgres-backed snapshots; offline reconciliation on reconnect
- **Quiz intelligence pipeline** — concept extraction, adaptive sequencing, streaming generation, stats aggregation; benchmarked via `npm run benchmark:quiz`
- **BullMQ workers** on Redis for background jobs (cleanup, embeddings, scheduled tasks)
- **Single-replica boot guard** — server throws on boot if `REPLICA_COUNT > 1`; required because the Yjs document map, page-edit mutex, and tool-result cache are all in-memory
- **Paddle webhook idempotency** — raw-body signature verification with double-processing guards on subscription lifecycle events
- **~200 endpoints across 31 route files**, structured around middleware layers (auth → authorization → validation → handler)

## Tech stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 22, ESM |
| HTTP | Express 4, Helmet, CORS, compression |
| Database | PostgreSQL via Prisma 6 (dual schema) |
| Vector DB | pgvector (separate Postgres schema) |
| Cache / queues | Redis (ioredis), BullMQ |
| Auth | Clerk (`@clerk/backend`) |
| Billing | Paddle (`@paddle/paddle-node-sdk`) + raw-body HMAC verification |
| AI | Vercel AI SDK v6, 6 provider packages, OpenAI SDK fallback |
| Embeddings | `@xenova/transformers` (local) + OpenAI |
| Realtime | `ws`, `y-protocols`, `socket.io` (legacy) |
| Streaming | `resumable-stream` for SSE resume |
| File handling | Multer, Sharp, Cloudinary, mammoth (DOCX), pdf-lib |
| Email | Resend |
| Validation | Zod |
| Rate limiting | express-rate-limit + rate-limit-redis |

## Quick start

```bash
# Clone (or work inside the Pennote monorepo)
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend

# Install
npm install

# Configure
cp .env.example .env
# Fill in DATABASE_URL, EMBEDDING_DATABASE_URL, REDIS_URL, CLERK_SECRET_KEY, ...

# Generate Prisma clients (both schemas)
npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma

# Run migrations
npm run db:migrate

# Develop (port 3001)
npm run dev          # uses Infisical for secrets — see below
npm run dev:local    # plain tsx watch, reads .env directly
```

## Environment variables

The repo ships an `.env.example` with the full list. Critical variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | Main Postgres connection string |
| `EMBEDDING_DATABASE_URL` | yes | **Separate** Postgres with the `vector` extension installed |
| `REDIS_URL` | yes | Redis for cache, rate limiting, BullMQ |
| `CLIENT_URL` | yes | Frontend origin (CORS allow-list) |
| `CLERK_SECRET_KEY` | yes | Clerk backend key |
| `CLERK_WEBHOOK_SECRET` | yes | For verifying Clerk webhooks |
| `OPENAI_API_KEY` | one+ | At least one AI provider key required |
| `ANTHROPIC_API_KEY` | one+ | |
| `GOOGLE_GENERATIVE_AI_API_KEY` | one+ | |
| `DEEPSEEK_API_KEY` | one+ | |
| `MOONSHOT_API_KEY` | one+ | |
| `XAI_API_KEY` | one+ | |
| `PADDLE_API_KEY` | for billing | Paddle Billing API key |
| `PADDLE_WEBHOOK_SECRET` | for billing | Paddle webhook signing secret |
| `ENCRYPTION_KEY` | yes | 32-byte hex used for at-rest encryption of sensitive fields |
| `RESEND_API_KEY` | for email | Transactional email |
| `CLOUDINARY_*` | for uploads | Image hosting |
| `REPLICA_COUNT` | optional | Defaults to `1`. Boot will refuse to start if > 1. |

Convention: env vars throw on missing — no silent fallbacks. `if (!process.env.X) throw new Error(...)`.

Secrets in production are managed via [Infisical](https://infisical.com/). The `dev` scripts auto-wrap commands with `infisical run --env=dev --path=/Backend --`.

> **pgvector gotcha:** `EMBEDDING_DATABASE_URL` must point to a Postgres instance with `CREATE EXTENSION vector;` already run. The Prisma client for that schema is generated separately and lives in `src/lib/prismaEmbeddings.ts`. Always import `Prisma` from the same package as the client you use, otherwise `Prisma.raw()` is silently coerced into JSON.

## Project structure

```
src/
├── index.ts            # Bootstrap, Express app, mounted routers
├── routes/             # 31 route files — one per domain
├── controllers/        # Thin orchestration layer
├── services/           # Business logic, AI provider routing, quiz pipeline
├── middlewares/        # auth, authorization, validation, rate-limit
├── workers/            # BullMQ workers
├── jobs/               # Job definitions enqueued onto BullMQ
├── cron/               # node-cron schedules
├── lib/                # Prisma clients (main + embeddings), Redis, AI clients
├── validators/         # Zod schemas
├── utils/              # logger, error helpers, encryption, etc.
└── types/              # Shared TS types
prisma/
├── schema.prisma                # Main DB
└── schema-embeddings.prisma     # pgvector DB
```

## Architecture

**SSE streaming.** Chat completion endpoints write deltas through a `resumable-stream` wrapper. The stream id is returned up front, so a disconnected client can resume from the last persisted token. Provider failover happens before the first byte; once streaming starts, an `AbortSignal.timeout()` enforces an upper bound and `consumeStream()` is always called after `pipeUIMessageStreamToResponse(res)` to flush in-flight tokens.

**Dual Prisma client.** The main client lives in `lib/prisma.ts`. The embeddings client lives in `lib/prismaEmbeddings.ts` and uses a generated client output at `node_modules/.prisma/client-embeddings`. They never share a transaction — embedding writes happen on success of the parent flow.

**Yjs Postgres persistence.** A WebSocket server upgrades `/yjs/:docId` connections, instantiates one `Y.Doc` per document, and persists snapshots/updates to Postgres. The single-replica boot guard ensures only one process holds the document map; a second instance attempting to start aborts loudly.

**Webhook idempotency.** Paddle webhooks pass through raw-body signature verification (mounted with `express.raw()` *before* `express.json()`), then a database-backed idempotency-key check before any side effect. See `src/routes/paddleWebhooks.ts` and `src/routes/paddleWebhookHelpers.ts`.

**Quiz intelligence.** Source content is chunked, concept-extracted (LLM), then questions are streamed and ranked by an adaptive sequencer that uses the user's recent answers. Stats aggregation runs on background workers.

**Tool cache safety.** Any tool-result cache must include both `userId` and `workspaceId` in its key (`services/agent/tools/helpers/cacheKey.ts` — `toolCacheKey()`). A key missing either opens a cross-tenant data leak.

## Commands

```bash
npm run dev                    # Infisical + tsx watch (port 3001)
npm run dev:local              # Plain tsx watch with local .env
npm run build                  # prisma generate (x2) + tsc
npm run start                  # Production server
npm run db:migrate             # prisma migrate dev (safe migrations)
npm run db:push                # prisma db push (DEV ONLY — never on prod, never --force-reset)
npm run db:studio              # Prisma Studio
npm test                       # Jest
npm run test:coverage          # Coverage report
npm run test:load              # Load test runner
npm run test:load:light        # 5 users / 3 requests
npm run test:load:medium       # 20 users / 10 requests
npm run test:load:heavy        # 50 users / 20 requests
npm run benchmark:quiz         # Full quiz pipeline benchmark
npm run benchmark:quiz:small   # ...:medium ...:large ...:xlarge
npm run lint                   # ESLint
npm run format                 # Prettier
```

## Testing

- **Unit / integration:** Jest with `--experimental-vm-modules` (ESM). Tests live in `src/__tests__` and `src/tests`.
- **Load:** `tsx test-load.ts` — configurable user/request counts, per-feature flags (`--test=quiz`, `--test=credits`).
- **WebSocket scale:** `npm run test:artillery` against `artillery-websocket.yml`.
- **Quiz benchmark:** `npm run benchmark:quiz` measures latency at 4 content sizes.

## Deploy

Backend deploys to **Railway** as a **single replica**. Multiple replicas would corrupt the in-memory Yjs document map and the page-edit mutex; the boot guard refuses to start if `REPLICA_COUNT > 1`. Build runs `prisma generate` for both schemas before `tsc`. Production starts via `node dist/index.js` with `NODE_OPTIONS=--max-old-space-size=7168`. Migrate to a Redis distributed lock before any horizontal scaling. See `docs/guides/deployment-runbook.md` in the [monorepo](https://github.com/sanztheo/Pennote).

## Roadmap & status

This is a community-maintained snapshot. The original SaaS is no longer active. We will accept PRs that:

- Fix bugs
- Improve documentation
- Add missing tests
- Implement features that have a clear use case for self-hosters

We will likely **decline** PRs that:

- Restructure architecture without prior discussion
- Add new SaaS providers without genuine value
- Change licensing or attribution

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md). All contributors must agree to the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Security

If you discover a vulnerability, **do not open a public issue**. See [`SECURITY.md`](SECURITY.md) — report to <sanztheopro@gmail.com>.

## License

[GNU AGPLv3](LICENSE). Copyright (C) 2026 Théo Sanz.

If you self-host a modified version of Pennote and serve it to users, the AGPLv3 obliges you to publish your modifications. This protects the project from closed-source SaaS forks. If you need a different license for legitimate commercial reuse, contact <sanztheopro@gmail.com>.

## Acknowledgements

Built on [Express](https://expressjs.com/), [Prisma](https://www.prisma.io/), the [Vercel AI SDK](https://sdk.vercel.ai/), [Yjs](https://yjs.dev/), [BullMQ](https://docs.bullmq.io/), [Clerk](https://clerk.com/), and [Paddle](https://www.paddle.com/). Thanks to all upstream maintainers.

## Contact

- Maintainer: Théo Sanz
- Email: <sanztheopro@gmail.com>
- Issues: [GitHub Issues](https://github.com/sanztheo/pen-backend/issues)
- Discussions: [GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)
