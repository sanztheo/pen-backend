# pen-backend

> API de Pennote — Node.js + Prisma + Vercel AI SDK. Streaming AI multiproveedor, colaboración Yjs, facturación con Paddle, RAG con pgvector.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)]()
[![AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-v6-black)]()

> **Traducciones:** [English](README.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

> **🟡 Estado del proyecto — open source desde mayo de 2026.** Pennote se construyó como un SaaS pero nunca alcanzó el product-market fit (lanzado para ~50 usuarios, sin tracción). En lugar de dejar que el código se pudriera en privado, lo abrimos. Úsalo, fórkalo, aprende de él, autoaloja tu propia instancia. Las issues y PR son bienvenidas — ver [`CONTRIBUTING.md`](CONTRIBUTING.md). El mantenimiento es en la medida de lo posible.

## Qué es

La API HTTP / WebSocket detrás de Pennote. Servicio Node basado en Express con Prisma sobre dos esquemas Postgres (principal + pgvector para embeddings), streaming AI sobre SSE mediante el Vercel AI SDK, y colaboración Yjs por WebSocket con persistencia en Postgres. Este repositorio también es un submódulo del monorepo [Pennote](https://github.com/sanztheo/Pennote).

## Aspectos destacados

- **Esquemas Prisma duales** — datos principales de la app más un esquema pgvector separado para embeddings RAG, generados desde `prisma/schema.prisma` y `prisma/schema-embeddings.prisma`
- **Failover AI multiproveedor** vía Vercel AI SDK v6 — Anthropic, OpenAI, Google, DeepSeek, Moonshot, xAI; enrutamiento por proveedor según el modo de agente con propagación de timeout + abort
- **Streaming SSE reanudable** — los clientes pueden desconectarse y reconectarse en mitad de la completación vía `resumable-stream`; los tokens del chat se persisten a medida que llegan
- **Colaboración CRDT Yjs** — servidor WebSocket (`ws` + `y-protocols`) con snapshots persistidos en Postgres; reconciliación offline al reconectar
- **Pipeline de inteligencia de quiz** — extracción de conceptos, secuenciación adaptativa, generación en streaming, agregación de estadísticas; benchmark vía `npm run benchmark:quiz`
- **Workers BullMQ** sobre Redis para tareas en segundo plano (limpieza, embeddings, tareas programadas)
- **Guardia de arranque single-replica** — el servidor lanza una excepción al arrancar si `REPLICA_COUNT > 1`; necesario porque el mapa de documentos Yjs, el mutex de edición de página y la caché de resultados de tools están todos en memoria
- **Idempotencia de webhooks Paddle** — verificación de firma sobre raw-body con guardas anti doble-procesamiento en eventos del ciclo de vida de suscripción
- **~200 endpoints en 31 archivos de rutas**, estructurados en capas de middleware (auth → autorización → validación → handler)

## Stack tecnológico

| Capa | Elección |
|------|----------|
| Runtime | Node.js 22, ESM |
| HTTP | Express 4, Helmet, CORS, compression |
| Base de datos | PostgreSQL vía Prisma 6 (esquema dual) |
| Vector DB | pgvector (esquema Postgres separado) |
| Caché / colas | Redis (ioredis), BullMQ |
| Auth | Clerk (`@clerk/backend`) |
| Facturación | Paddle (`@paddle/paddle-node-sdk`) + verificación HMAC raw-body |
| AI | Vercel AI SDK v6, 6 paquetes de proveedores, fallback al SDK de OpenAI |
| Embeddings | `@xenova/transformers` (local) + OpenAI |
| Tiempo real | `ws`, `y-protocols`, `socket.io` (legacy) |
| Streaming | `resumable-stream` para reanudar SSE |
| Manejo de archivos | Multer, Sharp, Cloudinary, mammoth (DOCX), pdf-lib |
| Email | Resend |
| Validación | Zod |
| Rate limiting | express-rate-limit + rate-limit-redis |

## Inicio rápido

```bash
# Clonar (o trabajar dentro del monorepo Pennote)
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend

# Instalar
npm install

# Configurar
cp .env.example .env
# Rellenar DATABASE_URL, EMBEDDING_DATABASE_URL, REDIS_URL, CLERK_SECRET_KEY, ...

# Generar clientes Prisma (ambos esquemas)
npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma

# Ejecutar migraciones
npm run db:migrate

# Desarrollar (puerto 3001)
npm run dev          # usa Infisical para los secretos — ver más abajo
npm run dev:local    # tsx watch puro, lee .env directamente
```

## Variables de entorno

El repositorio incluye un `.env.example` con la lista completa. Variables críticas:

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `DATABASE_URL` | sí | Cadena de conexión Postgres principal |
| `EMBEDDING_DATABASE_URL` | sí | Postgres **separado** con la extensión `vector` instalada |
| `REDIS_URL` | sí | Redis para caché, rate limiting, BullMQ |
| `CLIENT_URL` | sí | Origen del frontend (allow-list de CORS) |
| `CLERK_SECRET_KEY` | sí | Clave backend de Clerk |
| `CLERK_WEBHOOK_SECRET` | sí | Para verificar webhooks de Clerk |
| `OPENAI_API_KEY` | una+ | Se requiere al menos una clave de proveedor AI |
| `ANTHROPIC_API_KEY` | una+ | |
| `GOOGLE_GENERATIVE_AI_API_KEY` | una+ | |
| `DEEPSEEK_API_KEY` | una+ | |
| `MOONSHOT_API_KEY` | una+ | |
| `XAI_API_KEY` | una+ | |
| `PADDLE_API_KEY` | para billing | Clave API de Paddle Billing |
| `PADDLE_WEBHOOK_SECRET` | para billing | Secreto de firma de webhooks de Paddle |
| `ENCRYPTION_KEY` | sí | Hex de 32 bytes usado para cifrado at-rest de campos sensibles |
| `RESEND_API_KEY` | para email | Email transaccional |
| `CLOUDINARY_*` | para uploads | Hosting de imágenes |
| `REPLICA_COUNT` | opcional | Por defecto `1`. El arranque rechazará comenzar si > 1. |

Convención: las env vars lanzan excepción cuando faltan — sin fallbacks silenciosos. `if (!process.env.X) throw new Error(...)`.

Los secretos en producción se gestionan vía [Infisical](https://infisical.com/). Los scripts `dev` envuelven automáticamente los comandos con `infisical run --env=dev --path=/Backend --`.

> **Truco de pgvector:** `EMBEDDING_DATABASE_URL` debe apuntar a una instancia Postgres con `CREATE EXTENSION vector;` ya ejecutado. El cliente Prisma de ese esquema se genera por separado y vive en `src/lib/prismaEmbeddings.ts`. Importa siempre `Prisma` desde el mismo paquete que el cliente que utilices, de lo contrario `Prisma.raw()` se coerciona silenciosamente a JSON.

## Estructura del proyecto

```
src/
├── index.ts            # Bootstrap, app Express, routers montados
├── routes/             # 31 archivos de rutas — uno por dominio
├── controllers/        # Capa fina de orquestación
├── services/           # Lógica de negocio, enrutamiento de proveedores AI, pipeline de quiz
├── middlewares/        # auth, autorización, validación, rate-limit
├── workers/            # Workers BullMQ
├── jobs/               # Definiciones de jobs encolados en BullMQ
├── cron/               # Schedules node-cron
├── lib/                # Clientes Prisma (principal + embeddings), Redis, clientes AI
├── validators/         # Esquemas Zod
├── utils/              # logger, helpers de error, cifrado, etc.
└── types/              # Tipos TS compartidos
prisma/
├── schema.prisma                # DB principal
└── schema-embeddings.prisma     # DB pgvector
```

## Arquitectura

**Streaming SSE.** Los endpoints de completación de chat escriben los deltas a través de un wrapper `resumable-stream`. El id del stream se devuelve por adelantado, de modo que un cliente desconectado puede reanudar desde el último token persistido. El failover entre proveedores ocurre antes del primer byte; una vez que comienza el streaming, un `AbortSignal.timeout()` impone un límite superior y `consumeStream()` siempre se llama tras `pipeUIMessageStreamToResponse(res)` para vaciar los tokens en vuelo.

**Cliente Prisma dual.** El cliente principal vive en `lib/prisma.ts`. El cliente de embeddings vive en `lib/prismaEmbeddings.ts` y usa un cliente generado en la salida `node_modules/.prisma/client-embeddings`. Nunca comparten una transacción — las escrituras de embeddings ocurren cuando el flujo padre tiene éxito.

**Persistencia Yjs en Postgres.** Un servidor WebSocket hace upgrade de las conexiones `/yjs/:docId`, instancia un `Y.Doc` por documento y persiste snapshots/updates en Postgres. La guardia de arranque single-replica garantiza que solo un proceso retiene el mapa de documentos; una segunda instancia que intente iniciar aborta de forma ruidosa.

**Idempotencia de webhooks.** Los webhooks de Paddle pasan por verificación de firma sobre raw-body (montada con `express.raw()` *antes* de `express.json()`), después por una comprobación de clave de idempotencia respaldada en base de datos antes de cualquier efecto secundario. Ver `src/routes/paddleWebhooks.ts` y `src/routes/paddleWebhookHelpers.ts`.

**Inteligencia de quiz.** El contenido fuente se trocea, se le extraen conceptos (LLM), después las preguntas se streaman y son ranqueadas por un secuenciador adaptativo que utiliza las respuestas recientes del usuario. La agregación de estadísticas se ejecuta en workers de fondo.

**Seguridad de la caché de tools.** Cualquier caché de resultado de tool debe incluir tanto `userId` como `workspaceId` en su clave (`services/agent/tools/helpers/cacheKey.ts` — `toolCacheKey()`). Una clave que omita cualquiera de los dos abre una fuga de datos cross-tenant.

## Comandos

```bash
npm run dev                    # Infisical + tsx watch (puerto 3001)
npm run dev:local              # tsx watch puro con .env local
npm run build                  # prisma generate (x2) + tsc
npm run start                  # Servidor de producción
npm run db:migrate             # prisma migrate dev (migraciones seguras)
npm run db:push                # prisma db push (SOLO DEV — nunca en prod, nunca --force-reset)
npm run db:studio              # Prisma Studio
npm test                       # Jest
npm run test:coverage          # Reporte de cobertura
npm run test:load              # Lanzador de tests de carga
npm run test:load:light        # 5 usuarios / 3 peticiones
npm run test:load:medium       # 20 usuarios / 10 peticiones
npm run test:load:heavy        # 50 usuarios / 20 peticiones
npm run benchmark:quiz         # Benchmark completo del pipeline de quiz
npm run benchmark:quiz:small   # ...:medium ...:large ...:xlarge
npm run lint                   # ESLint
npm run format                 # Prettier
```

## Tests

- **Unitario / integración:** Jest con `--experimental-vm-modules` (ESM). Los tests viven en `src/__tests__` y `src/tests`.
- **Carga:** `tsx test-load.ts` — recuentos de usuarios/peticiones configurables, flags por feature (`--test=quiz`, `--test=credits`).
- **Escala WebSocket:** `npm run test:artillery` contra `artillery-websocket.yml`.
- **Benchmark de quiz:** `npm run benchmark:quiz` mide la latencia en 4 tamaños de contenido.

## Despliegue

El backend despliega en **Railway** como **single replica**. Múltiples replicas corromperían el mapa de documentos Yjs en memoria y el mutex de edición de página; la guardia de arranque rechaza iniciar si `REPLICA_COUNT > 1`. El build ejecuta `prisma generate` para ambos esquemas antes de `tsc`. Producción arranca vía `node dist/index.js` con `NODE_OPTIONS=--max-old-space-size=7168`. Migra a un lock distribuido en Redis antes de cualquier escalado horizontal. Ver `docs/guides/deployment-runbook.md` en el [monorepo](https://github.com/sanztheo/Pennote).

## Roadmap & estado

Esto es un snapshot mantenido por la comunidad. El SaaS original ya no está activo. Aceptaremos PR que:

- Corrijan bugs
- Mejoren la documentación
- Añadan tests faltantes
- Implementen funcionalidades con un caso de uso claro para self-hosters

Probablemente **rechazaremos** PR que:

- Reestructuren la arquitectura sin discusión previa
- Añadan nuevos proveedores SaaS sin valor real
- Cambien la licencia o la atribución

## Contribuir

Ver [`CONTRIBUTING.md`](CONTRIBUTING.md) y [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md). Todos los contribuidores deben aceptar el [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Seguridad

Si descubres una vulnerabilidad, **no abras una issue pública**. Ver [`SECURITY.md`](SECURITY.md) — repórtala a <sanztheopro@gmail.com>.

## Licencia

[GNU AGPLv3](LICENSE). Copyright (C) 2026 Théo Sanz.

Si self-hosteas una versión modificada de Pennote y la sirves a usuarios, la AGPLv3 te obliga a publicar tus modificaciones. Esto protege al proyecto de forks SaaS de código cerrado. Si necesitas una licencia diferente para una reutilización comercial legítima, contacta a <sanztheopro@gmail.com>.

## Agradecimientos

Construido sobre [Express](https://expressjs.com/), [Prisma](https://www.prisma.io/), el [Vercel AI SDK](https://sdk.vercel.ai/), [Yjs](https://yjs.dev/), [BullMQ](https://docs.bullmq.io/), [Clerk](https://clerk.com/) y [Paddle](https://www.paddle.com/). Gracias a todos los mantenedores upstream.

## Contacto

- Mantenedor: Théo Sanz
- Email: <sanztheopro@gmail.com>
- Issues: [GitHub Issues](https://github.com/sanztheo/pen-backend/issues)
- Discusiones: [GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)
