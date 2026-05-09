# pen-backend

> Pennote-API — Node.js + Prisma + Vercel AI SDK. Multi-Provider-AI-Streaming, Yjs-Kollaboration, Paddle-Abrechnung, RAG mit pgvector.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)]()
[![AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-v6-black)]()

> **Übersetzungen:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

> **🟡 Projektstatus — Open Source seit Mai 2026.** Pennote wurde als SaaS aufgebaut, hat aber nie Product-Market-Fit erreicht (an ca. 50 Nutzer ausgeliefert, keine Traktion). Statt den Code privat verrotten zu lassen, haben wir ihn quelloffen gemacht. Nutze ihn, forke ihn, lerne daraus, hoste deine eigene Instanz. Issues und PRs sind willkommen — siehe [`CONTRIBUTING.md`](CONTRIBUTING.md). Wartung erfolgt nach bestem Bemühen.

## Was es ist

Die HTTP-/WebSocket-API hinter Pennote. Express-basierter Node-Service mit Prisma gegen zwei Postgres-Schemas (Hauptschema + pgvector für Embeddings), AI-Streaming über SSE durch das Vercel AI SDK und Yjs-WebSocket-Kollaboration mit Postgres-Persistenz. Dieses Repo ist außerdem ein Submodul des [Pennote](https://github.com/sanztheo/Pennote)-Monorepos.

## Highlights

- **Duale Prisma-Schemas** — Haupt-App-Daten plus ein separates pgvector-Schema für RAG-Embeddings, generiert aus `prisma/schema.prisma` und `prisma/schema-embeddings.prisma`
- **Multi-Provider-AI-Failover** über Vercel AI SDK v6 — Anthropic, OpenAI, Google, DeepSeek, Moonshot, xAI; Provider-Routing pro Agentenmodus mit Timeout- + Abort-Propagation
- **Wiederaufnehmbares SSE-Streaming** — Clients können mitten in einer Completion abbrechen und sich erneut verbinden via `resumable-stream`; Chat-Tokens werden persistiert, sobald sie eintreffen
- **Yjs-CRDT-Kollaboration** — WebSocket-Server (`ws` + `y-protocols`) mit in Postgres gespeicherten Snapshots; Offline-Reconciliation bei Reconnect
- **Quiz-Intelligence-Pipeline** — Konzept-Extraktion, adaptive Sequenzierung, Streaming-Generierung, Stats-Aggregation; Benchmark via `npm run benchmark:quiz`
- **BullMQ-Workers** auf Redis für Hintergrund-Jobs (Cleanup, Embeddings, geplante Aufgaben)
- **Single-Replica-Boot-Guard** — der Server wirft beim Boot, wenn `REPLICA_COUNT > 1`; nötig, weil die Yjs-Dokumentmap, der Page-Edit-Mutex und der Tool-Result-Cache allesamt In-Memory sind
- **Paddle-Webhook-Idempotenz** — Raw-Body-Signaturprüfung mit Schutzvorkehrungen gegen Doppelverarbeitung bei Subscription-Lifecycle-Events
- **~200 Endpoints in 31 Route-Dateien**, strukturiert um Middleware-Schichten (Auth → Autorisierung → Validierung → Handler)

## Tech-Stack

| Schicht | Wahl |
|---------|------|
| Runtime | Node.js 22, ESM |
| HTTP | Express 4, Helmet, CORS, compression |
| Datenbank | PostgreSQL via Prisma 6 (duales Schema) |
| Vector DB | pgvector (separates Postgres-Schema) |
| Cache / Queues | Redis (ioredis), BullMQ |
| Auth | Clerk (`@clerk/backend`) |
| Abrechnung | Paddle (`@paddle/paddle-node-sdk`) + Raw-Body-HMAC-Verifikation |
| AI | Vercel AI SDK v6, 6 Provider-Pakete, OpenAI-SDK-Fallback |
| Embeddings | `@xenova/transformers` (lokal) + OpenAI |
| Realtime | `ws`, `y-protocols`, `socket.io` (Legacy) |
| Streaming | `resumable-stream` für SSE-Resume |
| File-Handling | Multer, Sharp, Cloudinary, mammoth (DOCX), pdf-lib |
| Email | Resend |
| Validierung | Zod |
| Rate Limiting | express-rate-limit + rate-limit-redis |

## Schnellstart

```bash
# Klonen (oder im Pennote-Monorepo arbeiten)
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend

# Installieren
npm install

# Konfigurieren
cp .env.example .env
# DATABASE_URL, EMBEDDING_DATABASE_URL, REDIS_URL, CLERK_SECRET_KEY, ... eintragen

# Prisma-Clients generieren (beide Schemas)
npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma

# Migrationen ausführen
npm run db:migrate

# Entwickeln (Port 3001)
npm run dev          # nutzt Infisical für Secrets — siehe unten
npm run dev:local    # reines tsx watch, liest .env direkt
```

## Umgebungsvariablen

Das Repo liefert ein `.env.example` mit der vollständigen Liste. Kritische Variablen:

| Variable | Erforderlich | Beschreibung |
|----------|--------------|--------------|
| `DATABASE_URL` | ja | Haupt-Postgres-Verbindungsstring |
| `EMBEDDING_DATABASE_URL` | ja | **Separates** Postgres mit installierter `vector`-Extension |
| `REDIS_URL` | ja | Redis für Cache, Rate Limiting, BullMQ |
| `CLIENT_URL` | ja | Frontend-Origin (CORS-Allow-List) |
| `CLERK_SECRET_KEY` | ja | Clerk-Backend-Schlüssel |
| `CLERK_WEBHOOK_SECRET` | ja | Zur Verifikation von Clerk-Webhooks |
| `OPENAI_API_KEY` | mind. einer | Mindestens ein AI-Provider-Schlüssel erforderlich |
| `ANTHROPIC_API_KEY` | mind. einer | |
| `GOOGLE_GENERATIVE_AI_API_KEY` | mind. einer | |
| `DEEPSEEK_API_KEY` | mind. einer | |
| `MOONSHOT_API_KEY` | mind. einer | |
| `XAI_API_KEY` | mind. einer | |
| `PADDLE_API_KEY` | für Billing | Paddle-Billing-API-Schlüssel |
| `PADDLE_WEBHOOK_SECRET` | für Billing | Paddle-Webhook-Signing-Secret |
| `ENCRYPTION_KEY` | ja | 32-Byte-Hex für At-Rest-Verschlüsselung sensibler Felder |
| `RESEND_API_KEY` | für Email | Transaktionale E-Mails |
| `CLOUDINARY_*` | für Uploads | Bild-Hosting |
| `REPLICA_COUNT` | optional | Standard `1`. Boot verweigert Start, wenn > 1. |

Konvention: Env Vars werfen bei Fehlen — keine stillen Fallbacks. `if (!process.env.X) throw new Error(...)`.

Secrets in Produktion werden über [Infisical](https://infisical.com/) verwaltet. Die `dev`-Skripte umschließen Befehle automatisch mit `infisical run --env=dev --path=/Backend --`.

> **pgvector-Stolperfalle:** `EMBEDDING_DATABASE_URL` muss auf eine Postgres-Instanz zeigen, in der `CREATE EXTENSION vector;` bereits ausgeführt wurde. Der Prisma-Client für dieses Schema wird separat generiert und liegt in `src/lib/prismaEmbeddings.ts`. Importiere `Prisma` immer aus demselben Paket wie den verwendeten Client, sonst wird `Prisma.raw()` stillschweigend zu JSON zwangskonvertiert.

## Projektstruktur

```
src/
├── index.ts            # Bootstrap, Express-App, gemountete Router
├── routes/             # 31 Route-Dateien — eine pro Domäne
├── controllers/        # Dünne Orchestrierungsschicht
├── services/           # Geschäftslogik, AI-Provider-Routing, Quiz-Pipeline
├── middlewares/        # auth, Autorisierung, Validierung, Rate-Limit
├── workers/            # BullMQ-Workers
├── jobs/               # Job-Definitionen, in BullMQ eingereiht
├── cron/               # node-cron-Schedules
├── lib/                # Prisma-Clients (Haupt + Embeddings), Redis, AI-Clients
├── validators/         # Zod-Schemas
├── utils/              # logger, Error-Helper, Verschlüsselung etc.
└── types/              # Geteilte TS-Typen
prisma/
├── schema.prisma                # Haupt-DB
└── schema-embeddings.prisma     # pgvector-DB
```

## Architektur

**SSE-Streaming.** Chat-Completion-Endpoints schreiben Deltas durch einen `resumable-stream`-Wrapper. Die Stream-ID wird vorab zurückgegeben, sodass ein getrennter Client ab dem letzten persistierten Token wieder aufnehmen kann. Der Provider-Failover passiert vor dem ersten Byte; sobald das Streaming startet, erzwingt ein `AbortSignal.timeout()` eine Obergrenze, und `consumeStream()` wird stets nach `pipeUIMessageStreamToResponse(res)` aufgerufen, um in Bewegung befindliche Tokens zu spülen.

**Dualer Prisma-Client.** Der Hauptclient liegt in `lib/prisma.ts`. Der Embeddings-Client liegt in `lib/prismaEmbeddings.ts` und nutzt einen unter `node_modules/.prisma/client-embeddings` generierten Client. Sie teilen niemals eine Transaktion — Embedding-Schreibvorgänge erfolgen, wenn der Eltern-Flow erfolgreich ist.

**Yjs-Postgres-Persistenz.** Ein WebSocket-Server upgradet `/yjs/:docId`-Verbindungen, instanziiert ein `Y.Doc` pro Dokument und persistiert Snapshots/Updates in Postgres. Der Single-Replica-Boot-Guard stellt sicher, dass nur ein Prozess die Dokumentmap hält; eine zweite Instanz, die zu starten versucht, bricht lautstark ab.

**Webhook-Idempotenz.** Paddle-Webhooks durchlaufen eine Raw-Body-Signaturprüfung (gemountet mit `express.raw()` *vor* `express.json()`), dann eine datenbankgestützte Idempotenz-Schlüssel-Prüfung vor jedem Seiteneffekt. Siehe `src/routes/paddleWebhooks.ts` und `src/routes/paddleWebhookHelpers.ts`.

**Quiz-Intelligence.** Quellinhalt wird gechunkt, Konzepte (LLM) extrahiert, dann werden Fragen gestreamt und von einem adaptiven Sequenzer gerankt, der die jüngsten Antworten des Nutzers verwendet. Die Stats-Aggregation läuft auf Hintergrund-Workers.

**Tool-Cache-Sicherheit.** Jeder Tool-Result-Cache muss sowohl `userId` als auch `workspaceId` in seinem Schlüssel enthalten (`services/agent/tools/helpers/cacheKey.ts` — `toolCacheKey()`). Ein Schlüssel, dem eines davon fehlt, öffnet ein cross-tenant Datenleck.

## Befehle

```bash
npm run dev                    # Infisical + tsx watch (Port 3001)
npm run dev:local              # Reines tsx watch mit lokalem .env
npm run build                  # prisma generate (x2) + tsc
npm run start                  # Produktionsserver
npm run db:migrate             # prisma migrate dev (sichere Migrationen)
npm run db:push                # prisma db push (NUR DEV — niemals in Prod, niemals --force-reset)
npm run db:studio              # Prisma Studio
npm test                       # Jest
npm run test:coverage          # Coverage-Report
npm run test:load              # Lasttest-Runner
npm run test:load:light        # 5 Nutzer / 3 Requests
npm run test:load:medium       # 20 Nutzer / 10 Requests
npm run test:load:heavy        # 50 Nutzer / 20 Requests
npm run benchmark:quiz         # Vollständiger Quiz-Pipeline-Benchmark
npm run benchmark:quiz:small   # ...:medium ...:large ...:xlarge
npm run lint                   # ESLint
npm run format                 # Prettier
```

## Tests

- **Unit / Integration:** Jest mit `--experimental-vm-modules` (ESM). Tests liegen in `src/__tests__` und `src/tests`.
- **Last:** `tsx test-load.ts` — konfigurierbare Nutzer-/Request-Zahlen, Per-Feature-Flags (`--test=quiz`, `--test=credits`).
- **WebSocket-Skalierung:** `npm run test:artillery` gegen `artillery-websocket.yml`.
- **Quiz-Benchmark:** `npm run benchmark:quiz` misst Latenz bei 4 Inhaltsgrößen.

## Deployment

Das Backend deployt auf **Railway** als **Single Replica**. Mehrere Replicas würden die In-Memory-Yjs-Dokumentmap und den Page-Edit-Mutex korrumpieren; der Boot-Guard verweigert den Start, wenn `REPLICA_COUNT > 1`. Der Build führt `prisma generate` für beide Schemas vor `tsc` aus. Produktion startet via `node dist/index.js` mit `NODE_OPTIONS=--max-old-space-size=7168`. Migriere zu einem verteilten Redis-Lock vor jedem horizontalen Scaling. Siehe `docs/guides/deployment-runbook.md` im [Monorepo](https://github.com/sanztheo/Pennote).

## Roadmap & Status

Dies ist ein von der Community gepflegter Snapshot. Das ursprüngliche SaaS ist nicht mehr aktiv. Wir akzeptieren PRs, die:

- Bugs beheben
- Dokumentation verbessern
- Fehlende Tests hinzufügen
- Funktionen mit klarem Use Case für Self-Hoster implementieren

Wir werden PRs wahrscheinlich **ablehnen**, die:

- Architektur ohne vorherige Diskussion umstrukturieren
- Neue SaaS-Provider ohne echten Mehrwert hinzufügen
- Lizenz oder Attribution ändern

## Mitwirken

Siehe [`CONTRIBUTING.md`](CONTRIBUTING.md) und [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md). Alle Mitwirkenden müssen dem [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) zustimmen.

## Sicherheit

Wenn du eine Schwachstelle entdeckst, **eröffne kein öffentliches Issue**. Siehe [`SECURITY.md`](SECURITY.md) — melde an <sanztheopro@gmail.com>.

## Lizenz

[GNU AGPLv3](LICENSE). Copyright (C) 2026 Théo Sanz.

Wenn du eine modifizierte Version von Pennote selbst hostest und Nutzern bereitstellst, verpflichtet dich AGPLv3, deine Modifikationen zu veröffentlichen. Das schützt das Projekt vor closed-source SaaS-Forks. Falls du eine andere Lizenz für legitime kommerzielle Wiederverwendung benötigst, kontaktiere <sanztheopro@gmail.com>.

## Danksagung

Aufgebaut auf [Express](https://expressjs.com/), [Prisma](https://www.prisma.io/), dem [Vercel AI SDK](https://sdk.vercel.ai/), [Yjs](https://yjs.dev/), [BullMQ](https://docs.bullmq.io/), [Clerk](https://clerk.com/) und [Paddle](https://www.paddle.com/). Dank an alle Upstream-Maintainer.

## Kontakt

- Maintainer: Théo Sanz
- Email: <sanztheopro@gmail.com>
- Issues: [GitHub Issues](https://github.com/sanztheo/pen-backend/issues)
- Diskussionen: [GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)
