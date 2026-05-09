# pen-backend

> Pennote API — Node.js + Prisma + Vercel AI SDK。多供应商 AI 流式传输、Yjs 协作、Paddle 计费、基于 pgvector 的 RAG。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)]()
[![AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-v6-black)]()

> **翻译:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

> **🟡 项目状态 — 自 2026 年 5 月起开源。** Pennote 最初是作为 SaaS 构建的,但从未达到 product-market fit(交付给约 50 位用户,没有获得增长)。我们没有让代码私下烂掉,而是将其开源。请使用、fork、学习,自托管你自己的实例。欢迎提交 issue 和 PR — 见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。维护以尽力而为的方式进行。

## 它是什么

Pennote 背后的 HTTP / WebSocket API。基于 Express 的 Node 服务,使用 Prisma 操作两个 Postgres schema(主库 + 用于 embedding 的 pgvector),通过 Vercel AI SDK 在 SSE 上进行 AI 流式传输,并通过 Yjs WebSocket 协作配合 Postgres 持久化。本仓库同时也是 [Pennote](https://github.com/sanztheo/Pennote) monorepo 的子模块。

## 亮点

- **双 Prisma schema** — 主应用数据加上单独的 pgvector schema 用于 RAG embeddings,分别从 `prisma/schema.prisma` 和 `prisma/schema-embeddings.prisma` 生成
- **多供应商 AI 故障切换**,基于 Vercel AI SDK v6 — Anthropic、OpenAI、Google、DeepSeek、Moonshot、xAI;按 agent 模式进行供应商路由,带超时 + abort 传播
- **可恢复的 SSE 流式传输** — 客户端可以在响应过程中断开并通过 `resumable-stream` 重新连接;聊天 token 一边到达一边持久化
- **Yjs CRDT 协作** — WebSocket 服务器(`ws` + `y-protocols`)配合存储在 Postgres 中的快照;重新连接时进行离线协调
- **Quiz 智能流水线** — 概念抽取、自适应排序、流式生成、统计聚合;通过 `npm run benchmark:quiz` 进行 benchmark
- **运行在 Redis 之上的 BullMQ workers**,处理后台任务(清理、embeddings、定时任务)
- **单副本启动守卫** — 如果 `REPLICA_COUNT > 1`,服务器在启动时会抛错;之所以必要,是因为 Yjs 文档 map、page-edit mutex 和 tool 结果缓存全部在内存中
- **Paddle webhook 幂等性** — 基于 raw-body 的签名校验,并在订阅生命周期事件上设有防止重复处理的守卫
- **31 个路由文件中约 200 个 endpoint**,围绕中间件层结构组织(auth → 授权 → 校验 → handler)

## 技术栈

| 层级 | 选择 |
|------|------|
| Runtime | Node.js 22, ESM |
| HTTP | Express 4, Helmet, CORS, compression |
| 数据库 | PostgreSQL via Prisma 6(双 schema) |
| 向量数据库 | pgvector(独立的 Postgres schema) |
| 缓存 / 队列 | Redis(ioredis), BullMQ |
| Auth | Clerk(`@clerk/backend`) |
| 计费 | Paddle(`@paddle/paddle-node-sdk`)+ raw-body HMAC 校验 |
| AI | Vercel AI SDK v6,6 个供应商包,OpenAI SDK 兜底 |
| Embeddings | `@xenova/transformers`(本地)+ OpenAI |
| 实时 | `ws`、`y-protocols`、`socket.io`(legacy) |
| 流式传输 | `resumable-stream` 用于 SSE 恢复 |
| 文件处理 | Multer、Sharp、Cloudinary、mammoth(DOCX)、pdf-lib |
| 邮件 | Resend |
| 校验 | Zod |
| 限流 | express-rate-limit + rate-limit-redis |

## 快速开始

```bash
# 克隆(或在 Pennote monorepo 中工作)
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend

# 安装依赖
npm install

# 配置
cp .env.example .env
# 填写 DATABASE_URL, EMBEDDING_DATABASE_URL, REDIS_URL, CLERK_SECRET_KEY, ...

# 生成 Prisma 客户端(两个 schema)
npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma

# 执行迁移
npm run db:migrate

# 开发(端口 3001)
npm run dev          # 使用 Infisical 管理 secret — 见下文
npm run dev:local    # 纯 tsx watch,直接读取 .env
```

## 环境变量

仓库中提供了 `.env.example`,包含完整列表。关键变量:

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | 主 Postgres 连接字符串 |
| `EMBEDDING_DATABASE_URL` | 是 | **独立的** Postgres,需已安装 `vector` 扩展 |
| `REDIS_URL` | 是 | 用于缓存、限流、BullMQ 的 Redis |
| `CLIENT_URL` | 是 | 前端来源(CORS allow-list) |
| `CLERK_SECRET_KEY` | 是 | Clerk backend key |
| `CLERK_WEBHOOK_SECRET` | 是 | 用于校验 Clerk webhook |
| `OPENAI_API_KEY` | 至少一个 | 至少需要一个 AI 供应商 key |
| `ANTHROPIC_API_KEY` | 至少一个 | |
| `GOOGLE_GENERATIVE_AI_API_KEY` | 至少一个 | |
| `DEEPSEEK_API_KEY` | 至少一个 | |
| `MOONSHOT_API_KEY` | 至少一个 | |
| `XAI_API_KEY` | 至少一个 | |
| `PADDLE_API_KEY` | 计费时 | Paddle Billing API key |
| `PADDLE_WEBHOOK_SECRET` | 计费时 | Paddle webhook 签名 secret |
| `ENCRYPTION_KEY` | 是 | 32 字节十六进制,用于敏感字段的静态加密 |
| `RESEND_API_KEY` | 邮件时 | 事务性邮件 |
| `CLOUDINARY_*` | 上传时 | 图片托管 |
| `REPLICA_COUNT` | 可选 | 默认 `1`。当 > 1 时启动会被拒绝。 |

约定:env vars 缺失时直接抛错 — 不做静默兜底。`if (!process.env.X) throw new Error(...)`。

生产环境的 secret 通过 [Infisical](https://infisical.com/) 管理。`dev` 脚本会自动用 `infisical run --env=dev --path=/Backend --` 包装命令。

> **pgvector 注意事项:** `EMBEDDING_DATABASE_URL` 必须指向一个已经执行过 `CREATE EXTENSION vector;` 的 Postgres 实例。该 schema 的 Prisma 客户端是单独生成的,位于 `src/lib/prismaEmbeddings.ts`。永远从你正在使用的客户端所在的同一个包中导入 `Prisma`,否则 `Prisma.raw()` 会被静默地强制转换为 JSON。

## 项目结构

```
src/
├── index.ts            # Bootstrap,Express app,挂载的 router
├── routes/             # 31 个路由文件 — 每个 domain 一个
├── controllers/        # 薄编排层
├── services/           # 业务逻辑、AI 供应商路由、quiz 流水线
├── middlewares/        # auth、授权、校验、rate-limit
├── workers/            # BullMQ workers
├── jobs/               # 入队到 BullMQ 的 job 定义
├── cron/               # node-cron 定时任务
├── lib/                # Prisma 客户端(主库 + embeddings)、Redis、AI 客户端
├── validators/         # Zod schema
├── utils/              # logger、错误辅助函数、加密等
└── types/              # 共享 TS 类型
prisma/
├── schema.prisma                # 主数据库
└── schema-embeddings.prisma     # pgvector 数据库
```

## 架构

**SSE 流式传输。** Chat completion endpoint 通过 `resumable-stream` wrapper 写入 delta。stream id 会预先返回,这样断开的客户端可以从最后持久化的 token 处恢复。供应商 failover 在第一个字节之前发生;一旦流开始,`AbortSignal.timeout()` 会施加上限,并且 `pipeUIMessageStreamToResponse(res)` 之后总会调用 `consumeStream()` 来 flush 在途 token。

**双 Prisma 客户端。** 主客户端位于 `lib/prisma.ts`。embeddings 客户端位于 `lib/prismaEmbeddings.ts`,使用生成到 `node_modules/.prisma/client-embeddings` 的客户端。它们从不共享事务 — embedding 写入发生在父流程成功之后。

**Yjs 在 Postgres 上的持久化。** 一个 WebSocket 服务器升级 `/yjs/:docId` 连接,为每个文档实例化一个 `Y.Doc`,并将快照/更新持久化到 Postgres。单副本启动守卫确保只有一个进程持有文档 map;尝试启动的第二个实例会高调地中止。

**Webhook 幂等性。** Paddle webhook 经过 raw-body 签名校验(用 `express.raw()` 在 `express.json()` *之前* 挂载),然后在产生任何副作用前进行基于数据库的幂等键检查。见 `src/routes/paddleWebhooks.ts` 和 `src/routes/paddleWebhookHelpers.ts`。

**Quiz 智能。** 源内容会被分块、由 LLM 抽取概念,然后题目以流的方式生成,并由一个使用用户最近答案的自适应排序器排名。统计聚合在后台 worker 上运行。

**Tool 缓存安全。** 任何 tool 结果缓存都必须在其 key 中同时包含 `userId` 和 `workspaceId`(`services/agent/tools/helpers/cacheKey.ts` — `toolCacheKey()`)。缺少其中之一的 key 会打开跨租户数据泄漏。

## 命令

```bash
npm run dev                    # Infisical + tsx watch(端口 3001)
npm run dev:local              # 纯 tsx watch,使用本地 .env
npm run build                  # prisma generate(x2)+ tsc
npm run start                  # 生产服务器
npm run db:migrate             # prisma migrate dev(安全迁移)
npm run db:push                # prisma db push(仅 DEV — 切勿在 prod,切勿 --force-reset)
npm run db:studio              # Prisma Studio
npm test                       # Jest
npm run test:coverage          # 覆盖率报告
npm run test:load              # 负载测试运行器
npm run test:load:light        # 5 用户 / 3 请求
npm run test:load:medium       # 20 用户 / 10 请求
npm run test:load:heavy        # 50 用户 / 20 请求
npm run benchmark:quiz         # 完整 quiz 流水线 benchmark
npm run benchmark:quiz:small   # ...:medium ...:large ...:xlarge
npm run lint                   # ESLint
npm run format                 # Prettier
```

## 测试

- **单元 / 集成:** Jest 配合 `--experimental-vm-modules`(ESM)。测试位于 `src/__tests__` 和 `src/tests`。
- **负载:** `tsx test-load.ts` — 用户/请求数可配置,按 feature 提供 flag(`--test=quiz`、`--test=credits`)。
- **WebSocket 规模:** `npm run test:artillery` 针对 `artillery-websocket.yml` 运行。
- **Quiz benchmark:** `npm run benchmark:quiz` 在 4 种内容大小下测量延迟。

## 部署

后端以 **单副本** 形式部署到 **Railway**。多副本会破坏内存中的 Yjs 文档 map 和 page-edit mutex;启动守卫会拒绝在 `REPLICA_COUNT > 1` 时启动。构建会在 `tsc` 之前为两个 schema 运行 `prisma generate`。生产环境通过 `node dist/index.js` 启动,并设置 `NODE_OPTIONS=--max-old-space-size=7168`。在进行任何水平扩展之前,先迁移到 Redis 分布式锁。见 [monorepo](https://github.com/sanztheo/Pennote) 中的 `docs/guides/deployment-runbook.md`。

## Roadmap 与状态

这是一个由社区维护的快照。原始 SaaS 已不再活跃。我们将接受以下 PR:

- 修复 bug
- 改进文档
- 补充缺失的测试
- 实现对 self-hoster 有清晰用例的功能

我们可能会 **拒绝** 以下 PR:

- 在没有事先讨论的情况下重构架构
- 添加没有真正价值的新 SaaS 供应商
- 修改许可证或署名

## 贡献

见 [`CONTRIBUTING.md`](CONTRIBUTING.md) 与 [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md)。所有贡献者都必须同意 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。

## 安全

如果你发现漏洞,**请勿提交公开 issue**。见 [`SECURITY.md`](SECURITY.md) — 请将其报告至 <sanztheopro@gmail.com>。

## 许可证

[GNU AGPLv3](LICENSE)。Copyright (C) 2026 Théo Sanz。

如果你自托管 Pennote 的修改版本并对外提供给用户,AGPLv3 要求你公布你的修改。这能保护项目不被闭源 SaaS fork 吞噬。如果你出于合法的商业再利用需要其他许可证,请联系 <sanztheopro@gmail.com>。

## 致谢

构建于 [Express](https://expressjs.com/)、[Prisma](https://www.prisma.io/)、[Vercel AI SDK](https://sdk.vercel.ai/)、[Yjs](https://yjs.dev/)、[BullMQ](https://docs.bullmq.io/)、[Clerk](https://clerk.com/) 和 [Paddle](https://www.paddle.com/) 之上。感谢所有上游维护者。

## 联系方式

- 维护者:Théo Sanz
- 邮箱:<sanztheopro@gmail.com>
- Issues:[GitHub Issues](https://github.com/sanztheo/pen-backend/issues)
- Discussions:[GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)
