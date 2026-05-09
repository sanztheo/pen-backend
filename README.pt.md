# pen-backend

> API do Pennote — Node.js + Prisma + Vercel AI SDK. Streaming de IA multi-fornecedor, colaboração Yjs, faturação Paddle, RAG com pgvector.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)]()
[![AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-v6-black)]()

> **Traduções:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

> **🟡 Estado do projeto — open source desde maio de 2026.** O Pennote foi construído como um SaaS, mas nunca alcançou product-market fit (entregue a cerca de 50 utilizadores, sem tração). Em vez de deixar o código apodrecer privadamente, abrimo-lo. Use-o, faça fork, aprenda com ele, faça self-host da sua própria instância. Issues e PRs são bem-vindas — ver [`CONTRIBUTING.md`](CONTRIBUTING.md). A manutenção é best-effort.

## O que é

A API HTTP / WebSocket por trás do Pennote. Serviço Node baseado em Express com Prisma sobre dois schemas Postgres (principal + pgvector para embeddings), streaming de IA via SSE através do Vercel AI SDK e colaboração Yjs por WebSocket com persistência Postgres. Este repositório também é um submódulo do monorepo [Pennote](https://github.com/sanztheo/Pennote).

## Destaques

- **Schemas Prisma duais** — dados principais da app mais um schema pgvector separado para embeddings RAG, gerados a partir de `prisma/schema.prisma` e `prisma/schema-embeddings.prisma`
- **Failover de IA multi-fornecedor** via Vercel AI SDK v6 — Anthropic, OpenAI, Google, DeepSeek, Moonshot, xAI; routing por fornecedor consoante o modo de agente com propagação de timeout + abort
- **Streaming SSE retomável** — clientes podem cair e reconectar a meio do completion via `resumable-stream`; os tokens do chat são persistidos à medida que chegam
- **Colaboração CRDT Yjs** — servidor WebSocket (`ws` + `y-protocols`) com snapshots persistidos em Postgres; reconciliação offline na reconexão
- **Pipeline de inteligência de quiz** — extração de conceitos, sequenciamento adaptativo, geração em streaming, agregação de estatísticas; benchmark via `npm run benchmark:quiz`
- **Workers BullMQ** sobre Redis para tarefas em background (cleanup, embeddings, tarefas agendadas)
- **Guarda de boot single-replica** — o servidor lança exceção no boot se `REPLICA_COUNT > 1`; necessário porque o mapa de documentos Yjs, o mutex page-edit e a cache de resultados de tools estão todos em memória
- **Idempotência dos webhooks Paddle** — verificação de assinatura sobre raw-body com guardas anti-duplo-processamento nos eventos do ciclo de vida da subscrição
- **~200 endpoints distribuídos por 31 ficheiros de rotas**, estruturados em camadas de middleware (auth → autorização → validação → handler)

## Stack tecnológica

| Camada | Escolha |
|--------|---------|
| Runtime | Node.js 22, ESM |
| HTTP | Express 4, Helmet, CORS, compression |
| Base de dados | PostgreSQL via Prisma 6 (schema dual) |
| Vector DB | pgvector (schema Postgres separado) |
| Cache / filas | Redis (ioredis), BullMQ |
| Auth | Clerk (`@clerk/backend`) |
| Faturação | Paddle (`@paddle/paddle-node-sdk`) + verificação HMAC raw-body |
| IA | Vercel AI SDK v6, 6 pacotes de fornecedores, fallback OpenAI SDK |
| Embeddings | `@xenova/transformers` (local) + OpenAI |
| Tempo real | `ws`, `y-protocols`, `socket.io` (legacy) |
| Streaming | `resumable-stream` para retoma de SSE |
| Manuseamento de ficheiros | Multer, Sharp, Cloudinary, mammoth (DOCX), pdf-lib |
| Email | Resend |
| Validação | Zod |
| Rate limiting | express-rate-limit + rate-limit-redis |

## Início rápido

```bash
# Clonar (ou trabalhar no monorepo Pennote)
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend

# Instalar
npm install

# Configurar
cp .env.example .env
# Preencher DATABASE_URL, EMBEDDING_DATABASE_URL, REDIS_URL, CLERK_SECRET_KEY, ...

# Gerar clientes Prisma (ambos os schemas)
npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma

# Correr migrações
npm run db:migrate

# Desenvolver (porta 3001)
npm run dev          # usa Infisical para os segredos — ver abaixo
npm run dev:local    # tsx watch puro, lê o .env diretamente
```

## Variáveis de ambiente

O repositório inclui um `.env.example` com a lista completa. Variáveis críticas:

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | sim | String de ligação Postgres principal |
| `EMBEDDING_DATABASE_URL` | sim | Postgres **separado** com a extensão `vector` instalada |
| `REDIS_URL` | sim | Redis para cache, rate limiting, BullMQ |
| `CLIENT_URL` | sim | Origem do frontend (allow-list de CORS) |
| `CLERK_SECRET_KEY` | sim | Chave backend do Clerk |
| `CLERK_WEBHOOK_SECRET` | sim | Para verificar webhooks do Clerk |
| `OPENAI_API_KEY` | uma+ | É necessária pelo menos uma chave de fornecedor de IA |
| `ANTHROPIC_API_KEY` | uma+ | |
| `GOOGLE_GENERATIVE_AI_API_KEY` | uma+ | |
| `DEEPSEEK_API_KEY` | uma+ | |
| `MOONSHOT_API_KEY` | uma+ | |
| `XAI_API_KEY` | uma+ | |
| `PADDLE_API_KEY` | para faturação | Chave API do Paddle Billing |
| `PADDLE_WEBHOOK_SECRET` | para faturação | Segredo de assinatura dos webhooks Paddle |
| `ENCRYPTION_KEY` | sim | Hex de 32 bytes usado para cifragem at-rest de campos sensíveis |
| `RESEND_API_KEY` | para email | Email transacional |
| `CLOUDINARY_*` | para uploads | Hosting de imagens |
| `REPLICA_COUNT` | opcional | Por defeito `1`. O boot recusa-se a arrancar se > 1. |

Convenção: as env vars lançam exceção quando faltam — sem fallbacks silenciosos. `if (!process.env.X) throw new Error(...)`.

Os segredos em produção são geridos via [Infisical](https://infisical.com/). Os scripts `dev` envolvem automaticamente os comandos com `infisical run --env=dev --path=/Backend --`.

> **Armadilha do pgvector:** `EMBEDDING_DATABASE_URL` deve apontar para uma instância Postgres com `CREATE EXTENSION vector;` já executado. O cliente Prisma desse schema é gerado em separado e vive em `src/lib/prismaEmbeddings.ts`. Importe sempre `Prisma` do mesmo pacote do cliente que está a usar, caso contrário `Prisma.raw()` é silenciosamente convertido em JSON.

## Estrutura do projeto

```
src/
├── index.ts            # Bootstrap, app Express, routers montados
├── routes/             # 31 ficheiros de rotas — um por domínio
├── controllers/        # Camada fina de orquestração
├── services/           # Lógica de negócio, routing de fornecedores de IA, pipeline de quiz
├── middlewares/        # auth, autorização, validação, rate-limit
├── workers/            # Workers BullMQ
├── jobs/               # Definições de jobs colocados em fila no BullMQ
├── cron/               # Agendamentos node-cron
├── lib/                # Clientes Prisma (principal + embeddings), Redis, clientes IA
├── validators/         # Schemas Zod
├── utils/              # logger, helpers de erro, cifragem, etc.
└── types/              # Tipos TS partilhados
prisma/
├── schema.prisma                # DB principal
└── schema-embeddings.prisma     # DB pgvector
```

## Arquitetura

**Streaming SSE.** Os endpoints de chat completion escrevem deltas através de um wrapper `resumable-stream`. O id do stream é devolvido logo de início, pelo que um cliente desconectado pode retomar a partir do último token persistido. O failover de fornecedor acontece antes do primeiro byte; assim que o streaming arranca, um `AbortSignal.timeout()` impõe um limite superior e `consumeStream()` é sempre chamado depois de `pipeUIMessageStreamToResponse(res)` para esvaziar os tokens em trânsito.

**Cliente Prisma dual.** O cliente principal vive em `lib/prisma.ts`. O cliente de embeddings vive em `lib/prismaEmbeddings.ts` e usa um cliente gerado para `node_modules/.prisma/client-embeddings`. Nunca partilham uma transação — as escritas de embeddings ocorrem após o sucesso do fluxo principal.

**Persistência Yjs em Postgres.** Um servidor WebSocket faz upgrade às ligações `/yjs/:docId`, instancia um `Y.Doc` por documento e persiste snapshots/atualizações em Postgres. A guarda de boot single-replica garante que apenas um processo detém o mapa de documentos; uma segunda instância que tente arrancar aborta ruidosamente.

**Idempotência de webhooks.** Os webhooks Paddle passam por uma verificação de assinatura sobre raw-body (montada com `express.raw()` *antes* de `express.json()`), depois por uma verificação de chave de idempotência baseada na base de dados antes de qualquer efeito secundário. Ver `src/routes/paddleWebhooks.ts` e `src/routes/paddleWebhookHelpers.ts`.

**Inteligência de quiz.** O conteúdo de origem é dividido em chunks, os seus conceitos são extraídos (LLM), depois as perguntas são streamadas e ranqueadas por um sequenciador adaptativo que usa as respostas recentes do utilizador. A agregação de estatísticas corre em workers em background.

**Segurança da cache de tools.** Qualquer cache de resultado de tool deve incluir tanto `userId` como `workspaceId` na sua chave (`services/agent/tools/helpers/cacheKey.ts` — `toolCacheKey()`). Uma chave a que falte qualquer um dos dois abre uma fuga de dados cross-tenant.

## Comandos

```bash
npm run dev                    # Infisical + tsx watch (porta 3001)
npm run dev:local              # tsx watch puro com .env local
npm run build                  # prisma generate (x2) + tsc
npm run start                  # Servidor de produção
npm run db:migrate             # prisma migrate dev (migrações seguras)
npm run db:push                # prisma db push (APENAS DEV — nunca em prod, nunca --force-reset)
npm run db:studio              # Prisma Studio
npm test                       # Jest
npm run test:coverage          # Relatório de cobertura
npm run test:load              # Runner de testes de carga
npm run test:load:light        # 5 utilizadores / 3 pedidos
npm run test:load:medium       # 20 utilizadores / 10 pedidos
npm run test:load:heavy        # 50 utilizadores / 20 pedidos
npm run benchmark:quiz         # Benchmark completo da pipeline de quiz
npm run benchmark:quiz:small   # ...:medium ...:large ...:xlarge
npm run lint                   # ESLint
npm run format                 # Prettier
```

## Testes

- **Unitário / integração:** Jest com `--experimental-vm-modules` (ESM). Os testes vivem em `src/__tests__` e `src/tests`.
- **Carga:** `tsx test-load.ts` — número configurável de utilizadores/pedidos, flags por feature (`--test=quiz`, `--test=credits`).
- **Escala WebSocket:** `npm run test:artillery` contra `artillery-websocket.yml`.
- **Benchmark de quiz:** `npm run benchmark:quiz` mede latência em 4 tamanhos de conteúdo.

## Deploy

O backend deploya em **Railway** como **single replica**. Múltiplas réplicas corromperiam o mapa de documentos Yjs em memória e o mutex page-edit; a guarda de boot recusa-se a arrancar se `REPLICA_COUNT > 1`. O build executa `prisma generate` para ambos os schemas antes de `tsc`. A produção arranca via `node dist/index.js` com `NODE_OPTIONS=--max-old-space-size=7168`. Migrar para um lock distribuído Redis antes de qualquer scaling horizontal. Ver `docs/guides/deployment-runbook.md` no [monorepo](https://github.com/sanztheo/Pennote).

## Roadmap & estado

Este é um snapshot mantido pela comunidade. O SaaS original já não está ativo. Aceitaremos PRs que:

- Corrijam bugs
- Melhorem a documentação
- Adicionem testes em falta
- Implementem funcionalidades com um caso de uso claro para self-hosters

Provavelmente **rejeitaremos** PRs que:

- Reestruturem a arquitetura sem discussão prévia
- Adicionem novos fornecedores SaaS sem valor genuíno
- Alterem licença ou atribuição

## Contribuir

Ver [`CONTRIBUTING.md`](CONTRIBUTING.md) e [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md). Todos os contribuidores devem aceitar o [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Segurança

Se descobrir uma vulnerabilidade, **não abra uma issue pública**. Ver [`SECURITY.md`](SECURITY.md) — reporte para <sanztheopro@gmail.com>.

## Licença

[GNU AGPLv3](LICENSE). Copyright (C) 2026 Théo Sanz.

Se fizer self-host de uma versão modificada do Pennote e a servir a utilizadores, a AGPLv3 obriga-o a publicar as suas modificações. Isto protege o projeto de forks SaaS de código fechado. Se precisar de uma licença diferente para reutilização comercial legítima, contacte <sanztheopro@gmail.com>.

## Agradecimentos

Construído sobre [Express](https://expressjs.com/), [Prisma](https://www.prisma.io/), o [Vercel AI SDK](https://sdk.vercel.ai/), [Yjs](https://yjs.dev/), [BullMQ](https://docs.bullmq.io/), [Clerk](https://clerk.com/) e [Paddle](https://www.paddle.com/). Obrigado a todos os mantainers upstream.

## Contacto

- Mantainer: Théo Sanz
- Email: <sanztheopro@gmail.com>
- Issues: [GitHub Issues](https://github.com/sanztheo/pen-backend/issues)
- Discussões: [GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)
