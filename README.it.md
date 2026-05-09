# pen-backend

> API di Pennote — Node.js + Prisma + Vercel AI SDK. Streaming AI multi-provider, collaborazione Yjs, fatturazione con Paddle, RAG con pgvector.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)]()
[![AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-v6-black)]()

> **Traduzioni:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

> **🟡 Stato del progetto — open source da maggio 2026.** Pennote è stato costruito come SaaS ma non ha mai raggiunto il product-market fit (rilasciato a circa 50 utenti, senza trazione). Invece di lasciare marcire il codice in privato, l'abbiamo reso open source. Usalo, forkalo, impara da esso, ospita la tua istanza. Issue e PR sono benvenute — vedi [`CONTRIBUTING.md`](CONTRIBUTING.md). La manutenzione è best-effort.

## Che cos'è

L'API HTTP / WebSocket dietro Pennote. Servizio Node basato su Express con Prisma su due schemi Postgres (principale + pgvector per gli embedding), streaming AI su SSE tramite il Vercel AI SDK, e collaborazione Yjs WebSocket con persistenza Postgres. Questo repository è anche un sottomodulo del monorepo [Pennote](https://github.com/sanztheo/Pennote).

## Punti salienti

- **Schemi Prisma duali** — dati principali dell'app più uno schema pgvector separato per gli embedding RAG, generati da `prisma/schema.prisma` e `prisma/schema-embeddings.prisma`
- **Failover AI multi-provider** tramite Vercel AI SDK v6 — Anthropic, OpenAI, Google, DeepSeek, Moonshot, xAI; routing per provider in base alla modalità agent con propagazione di timeout + abort
- **Streaming SSE riprendibile** — i client possono disconnettersi e riconnettersi a metà completamento via `resumable-stream`; i token della chat vengono persistiti man mano che arrivano
- **Collaborazione CRDT Yjs** — server WebSocket (`ws` + `y-protocols`) con snapshot persistiti su Postgres; riconciliazione offline alla riconnessione
- **Pipeline di intelligenza quiz** — estrazione dei concetti, sequenziamento adattivo, generazione in streaming, aggregazione delle statistiche; benchmark via `npm run benchmark:quiz`
- **Worker BullMQ** su Redis per job in background (cleanup, embeddings, task pianificati)
- **Guardia di boot single-replica** — il server lancia un'eccezione all'avvio se `REPLICA_COUNT > 1`; necessario perché la mappa dei documenti Yjs, il mutex page-edit e la cache dei risultati dei tool sono tutti in memoria
- **Idempotenza dei webhook Paddle** — verifica della firma su raw-body con guardie anti doppio-processamento sugli eventi del ciclo di vita dell'abbonamento
- **~200 endpoint distribuiti su 31 file di route**, strutturati attorno a livelli di middleware (auth → autorizzazione → validazione → handler)

## Stack tecnologico

| Livello | Scelta |
|---------|--------|
| Runtime | Node.js 22, ESM |
| HTTP | Express 4, Helmet, CORS, compression |
| Database | PostgreSQL via Prisma 6 (schema duale) |
| Vector DB | pgvector (schema Postgres separato) |
| Cache / queue | Redis (ioredis), BullMQ |
| Auth | Clerk (`@clerk/backend`) |
| Fatturazione | Paddle (`@paddle/paddle-node-sdk`) + verifica HMAC raw-body |
| AI | Vercel AI SDK v6, 6 pacchetti provider, fallback OpenAI SDK |
| Embedding | `@xenova/transformers` (locale) + OpenAI |
| Tempo reale | `ws`, `y-protocols`, `socket.io` (legacy) |
| Streaming | `resumable-stream` per riprendere SSE |
| File handling | Multer, Sharp, Cloudinary, mammoth (DOCX), pdf-lib |
| Email | Resend |
| Validazione | Zod |
| Rate limiting | express-rate-limit + rate-limit-redis |

## Avvio rapido

```bash
# Clonare (o lavorare nel monorepo Pennote)
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend

# Installare
npm install

# Configurare
cp .env.example .env
# Compilare DATABASE_URL, EMBEDDING_DATABASE_URL, REDIS_URL, CLERK_SECRET_KEY, ...

# Generare i client Prisma (entrambi gli schemi)
npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma

# Eseguire le migrazioni
npm run db:migrate

# Sviluppare (porta 3001)
npm run dev          # usa Infisical per i secret — vedi sotto
npm run dev:local    # tsx watch puro, legge .env direttamente
```

## Variabili d'ambiente

Il repository fornisce un `.env.example` con l'elenco completo. Variabili critiche:

| Variabile | Richiesta | Descrizione |
|-----------|-----------|-------------|
| `DATABASE_URL` | sì | Stringa di connessione Postgres principale |
| `EMBEDDING_DATABASE_URL` | sì | Postgres **separato** con l'estensione `vector` installata |
| `REDIS_URL` | sì | Redis per cache, rate limiting, BullMQ |
| `CLIENT_URL` | sì | Origin del frontend (allow-list CORS) |
| `CLERK_SECRET_KEY` | sì | Chiave backend Clerk |
| `CLERK_WEBHOOK_SECRET` | sì | Per verificare i webhook Clerk |
| `OPENAI_API_KEY` | una+ | Almeno una chiave provider AI è richiesta |
| `ANTHROPIC_API_KEY` | una+ | |
| `GOOGLE_GENERATIVE_AI_API_KEY` | una+ | |
| `DEEPSEEK_API_KEY` | una+ | |
| `MOONSHOT_API_KEY` | una+ | |
| `XAI_API_KEY` | una+ | |
| `PADDLE_API_KEY` | per la fatturazione | Chiave API Paddle Billing |
| `PADDLE_WEBHOOK_SECRET` | per la fatturazione | Secret di firma dei webhook Paddle |
| `ENCRYPTION_KEY` | sì | Hex 32 byte usato per la crittografia at-rest dei campi sensibili |
| `RESEND_API_KEY` | per l'email | Email transazionale |
| `CLOUDINARY_*` | per gli upload | Hosting immagini |
| `REPLICA_COUNT` | opzionale | Default `1`. Il boot rifiuterà di partire se > 1. |

Convenzione: le env var lanciano un'eccezione quando mancano — niente fallback silenziosi. `if (!process.env.X) throw new Error(...)`.

I secret in produzione sono gestiti tramite [Infisical](https://infisical.com/). Gli script `dev` racchiudono automaticamente i comandi con `infisical run --env=dev --path=/Backend --`.

> **Insidia di pgvector:** `EMBEDDING_DATABASE_URL` deve puntare a un'istanza Postgres dove `CREATE EXTENSION vector;` è già stato eseguito. Il client Prisma per quello schema viene generato separatamente e vive in `src/lib/prismaEmbeddings.ts`. Importa sempre `Prisma` dallo stesso pacchetto del client che stai usando, altrimenti `Prisma.raw()` viene silenziosamente forzato in JSON.

## Struttura del progetto

```
src/
├── index.ts            # Bootstrap, app Express, router montati
├── routes/             # 31 file di route — uno per dominio
├── controllers/        # Sottile livello di orchestrazione
├── services/           # Logica di business, routing dei provider AI, pipeline quiz
├── middlewares/        # auth, autorizzazione, validazione, rate-limit
├── workers/            # Worker BullMQ
├── jobs/               # Definizioni di job in coda su BullMQ
├── cron/               # Pianificazioni node-cron
├── lib/                # Client Prisma (principale + embeddings), Redis, client AI
├── validators/         # Schemi Zod
├── utils/              # logger, helper di errore, crittografia, ecc.
└── types/              # Tipi TS condivisi
prisma/
├── schema.prisma                # DB principale
└── schema-embeddings.prisma     # DB pgvector
```

## Architettura

**Streaming SSE.** Gli endpoint di completamento chat scrivono i delta tramite un wrapper `resumable-stream`. L'id dello stream viene restituito in anticipo, così un client disconnesso può riprendere dall'ultimo token persistito. Il failover di provider avviene prima del primo byte; una volta avviato lo streaming, un `AbortSignal.timeout()` impone un limite massimo e `consumeStream()` viene sempre chiamato dopo `pipeUIMessageStreamToResponse(res)` per scaricare i token in transito.

**Client Prisma duale.** Il client principale vive in `lib/prisma.ts`. Il client di embeddings vive in `lib/prismaEmbeddings.ts` e usa un client generato in output su `node_modules/.prisma/client-embeddings`. Non condividono mai una transazione — le scritture di embedding avvengono al successo del flusso principale.

**Persistenza Yjs su Postgres.** Un server WebSocket fa upgrade delle connessioni `/yjs/:docId`, istanzia un `Y.Doc` per ciascun documento e persiste snapshot/aggiornamenti su Postgres. La guardia di boot single-replica garantisce che un solo processo mantenga la mappa dei documenti; una seconda istanza che tenta di partire termina rumorosamente.

**Idempotenza dei webhook.** I webhook Paddle passano per la verifica della firma su raw-body (montata con `express.raw()` *prima* di `express.json()`), poi per un check di chiave di idempotenza basato su database prima di qualsiasi effetto collaterale. Vedi `src/routes/paddleWebhooks.ts` e `src/routes/paddleWebhookHelpers.ts`.

**Intelligenza quiz.** Il contenuto sorgente viene segmentato in chunk, ne vengono estratti i concetti (LLM), poi le domande vengono streamate e classificate da un sequenziatore adattivo che usa le risposte recenti dell'utente. L'aggregazione delle statistiche gira su worker in background.

**Sicurezza della cache dei tool.** Qualsiasi cache di risultati di tool deve includere sia `userId` sia `workspaceId` nella sua chiave (`services/agent/tools/helpers/cacheKey.ts` — `toolCacheKey()`). Una chiave a cui manca uno dei due apre una fuga di dati cross-tenant.

## Comandi

```bash
npm run dev                    # Infisical + tsx watch (porta 3001)
npm run dev:local              # tsx watch puro con .env locale
npm run build                  # prisma generate (x2) + tsc
npm run start                  # Server di produzione
npm run db:migrate             # prisma migrate dev (migrazioni sicure)
npm run db:push                # prisma db push (SOLO DEV — mai in prod, mai --force-reset)
npm run db:studio              # Prisma Studio
npm test                       # Jest
npm run test:coverage          # Report di copertura
npm run test:load              # Runner di test di carico
npm run test:load:light        # 5 utenti / 3 richieste
npm run test:load:medium       # 20 utenti / 10 richieste
npm run test:load:heavy        # 50 utenti / 20 richieste
npm run benchmark:quiz         # Benchmark completo della pipeline quiz
npm run benchmark:quiz:small   # ...:medium ...:large ...:xlarge
npm run lint                   # ESLint
npm run format                 # Prettier
```

## Test

- **Unitari / di integrazione:** Jest con `--experimental-vm-modules` (ESM). I test vivono in `src/__tests__` e `src/tests`.
- **Carico:** `tsx test-load.ts` — conteggi configurabili di utenti/richieste, flag per feature (`--test=quiz`, `--test=credits`).
- **Scala WebSocket:** `npm run test:artillery` contro `artillery-websocket.yml`.
- **Benchmark quiz:** `npm run benchmark:quiz` misura la latenza su 4 dimensioni di contenuto.

## Deploy

Il backend si distribuisce su **Railway** come **single replica**. Più replica corromperebbero la mappa dei documenti Yjs in memoria e il mutex page-edit; la guardia di boot rifiuta di partire se `REPLICA_COUNT > 1`. La build esegue `prisma generate` per entrambi gli schemi prima di `tsc`. La produzione parte tramite `node dist/index.js` con `NODE_OPTIONS=--max-old-space-size=7168`. Migrare a un lock distribuito Redis prima di qualsiasi scaling orizzontale. Vedi `docs/guides/deployment-runbook.md` nel [monorepo](https://github.com/sanztheo/Pennote).

## Roadmap & stato

Questo è uno snapshot mantenuto dalla community. Il SaaS originale non è più attivo. Accetteremo PR che:

- Correggono bug
- Migliorano la documentazione
- Aggiungono test mancanti
- Implementano funzionalità con un caso d'uso chiaro per i self-hoster

Probabilmente **rifiuteremo** PR che:

- Ristrutturano l'architettura senza discussione preventiva
- Aggiungono nuovi provider SaaS senza valore reale
- Modificano la licenza o l'attribuzione

## Contribuire

Vedi [`CONTRIBUTING.md`](CONTRIBUTING.md) e [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md). Tutti i contributor devono accettare il [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Sicurezza

Se scopri una vulnerabilità, **non aprire una issue pubblica**. Vedi [`SECURITY.md`](SECURITY.md) — segnala a <sanztheopro@gmail.com>.

## Licenza

[GNU AGPLv3](LICENSE). Copyright (C) 2026 Théo Sanz.

Se ospiti in self-hosting una versione modificata di Pennote e la servi a degli utenti, l'AGPLv3 ti obbliga a pubblicare le tue modifiche. Questo protegge il progetto dai fork SaaS closed-source. Se hai bisogno di una licenza diversa per un riutilizzo commerciale legittimo, contatta <sanztheopro@gmail.com>.

## Ringraziamenti

Costruito su [Express](https://expressjs.com/), [Prisma](https://www.prisma.io/), il [Vercel AI SDK](https://sdk.vercel.ai/), [Yjs](https://yjs.dev/), [BullMQ](https://docs.bullmq.io/), [Clerk](https://clerk.com/) e [Paddle](https://www.paddle.com/). Grazie a tutti i mantainer upstream.

## Contatti

- Maintainer: Théo Sanz
- Email: <sanztheopro@gmail.com>
- Issue: [GitHub Issues](https://github.com/sanztheo/pen-backend/issues)
- Discussioni: [GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)
