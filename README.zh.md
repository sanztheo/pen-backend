> **Translations:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

# 在独立仓库中将 Pen 后端部署到 Railway

本指南说明如何将 `backend/` 文件夹从 `pen-saas` 单一仓库中提取到一个独立的 Git 仓库,以便将其连接到 Railway,同时让前端继续部署在 Vercel 上。

## 1. 前置条件

- 对 `pen-saas` 单一仓库具有写入权限。
- Git ≥ 2.30(用于 `git subtree`)和 Node.js 18+。
- 一个具有创建项目和服务(PostgreSQL/Redis)权限的 Railway 账号。
- 一个仅供后端使用的空 Git 远程仓库(GitHub、GitLab 等)。

## 2. 将后端提取到新仓库

> 🎯 目标:获得一份干净的 Git 历史,只包含 `backend/` 目录及其子目录(`prisma/`、`src/`、`scripts/` 等)。

### 使用 `git subtree` 的快速步骤

1. 在单一仓库根目录下,创建只包含后端的临时分支:
   ```bash
   git subtree split --prefix=backend -b backend-only
   ```
2. 基于该分支初始化一个新的本地仓库:
   ```bash
   git clone . ../pen-backend --branch backend-only --single-branch
   cd ../pen-backend
   ```
3. 清理不必要的引用,然后连接最终的远程仓库:
   ```bash
   git remote remove origin
   git remote add origin git@github.com:YOUR-ORG/pen-backend.git
   git push -u origin backend-only:main
   ```
4. 如果不再需要,从单一仓库中删除临时分支:
   ```bash
   cd ../pen-saas
   git branch -D backend-only
   ```

### 备选方案:手动复制(不保留历史)

1. 创建一个空文件夹并初始化 Git:
   ```bash
   mkdir ../pen-backend && cp -R backend/* ../pen-backend
   cd ../pen-backend
   git init
   ```
2. 添加位于后端文件夹根目录的关键文件:
   - `package.json` / `package-lock.json`
   - `tsconfig.json`
   - `Dockerfile.dev`
   - `prisma/`、`scripts/`、`src/`
3. 创建一个最小的 `.gitignore`:
   ```bash
   cat <<'EOT' > .gitignore
   node_modules
   dist
   .env
   .env.*
   EOT
   ```
4. 提交并推送到新的远程仓库:
   ```bash
   git add .
   git commit -m "Initial backend export"
   git remote add origin git@github.com:YOUR-ORG/pen-backend.git
   git push -u origin main
   ```

## 3. 为 Railway 准备后端仓库

1. 确认 `package.json` 中正确暴露了 Railway 使用的构建和启动脚本:
   - `npm run build` → `tsc`(生成 `dist/`)。
   - `npm run start` → `node dist/index.js`。
2. 如需添加 `README` 文件(本文档)和项目描述。
3. 在本地执行:
   ```bash
   npm install
   npx prisma generate
   npm run build
   ```
   这样可以确保依赖和 TypeScript 转译器在首次部署前正常工作。

## 4. 必备的环境变量

在本地创建 `.env` 文件(并在 Railway 中填入这些变量)。最重要的变量:

| 变量 | 作用 |
| --- | --- |
| `DATABASE_URL` | 主 PostgreSQL URL(推荐 Railway Postgres)。 |
| `EMBEDDING_DATABASE_URL` | 向量数据库 / 第二个 Postgres 的连接(如使用)。 |
| `REDIS_URL` | 用于缓存、限流和 WebSocket 的 Redis 实例。 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | AI 生成访问凭证。 |
| `OPENAI_DASHBOARD_MODEL` | 仪表盘首选模型(可选,代码中已支持)。 |
| `OPENAI_MAX_REQUESTS_PER_HOUR`、`OPENAI_MAX_TOKENS_PER_HOUR`、`OPENAI_MAX_COST_PER_HOUR` | AI 配额上限(代码中已有默认值)。 |
| `CLERK_SECRET_KEY`、`CLERK_WEBHOOK_SECRET` | Clerk 认证。 |
| `CLIENT_URL` | 前端公开 URL(Vercel),用于配置 CORS。 |
| `TAVILY_API_KEY` | AI 助手的外部搜索(可选但推荐)。 |
| `GEMINI_API_KEY` / `GEMINI_THINKING_MODEL` | Google Gemini 支持(可选)。 |
| `ASSISTANT_ID`、`ASSISTANT_ID_DOCUMENTS`、`ASSISTANT_ID_2` | 如果你使用自己的 OpenAI Assistant ID。 |
| `RAG_EMBEDDING_CONCURRENCY`、`RAG_DB_BATCH_SIZE` | RAG 数据接入参数(已提供默认值)。 |

> ℹ️ Railway 会自动屏蔽敏感变量。当前端需要时,记得在 Vercel 中同步相同的值(例如 `VITE_API_URL`)。

## 5. 部署到 Railway

1. **创建 Railway 项目**:
   - 添加一个 PostgreSQL 服务,如有需要再添加 Redis 服务。
   - 记下 Railway 暴露的连接 URL(点击「Variables」按钮)。
2. **添加 Node.js 服务**:
   - 选择「Deploy from GitHub」并选中后端仓库。
   - 让 Railway 自动检测构建配置:
     - Install command:`npm install`
     - Build command:`npm run build`
     - Start command:`npm run start`
   - 添加上述列出的环境变量。
3. **Prisma 迁移**:
   - 在 Railway 终端中执行:
     ```bash
     railway run npx prisma migrate deploy
     ```
     或者,要在不进行迁移的情况下推送 schema,使用 `railway run npm run db:push`。
4. **健康检查**:
   - 确保服务在分配的端口上响应(Railway 会提供 `PORT`)。后端代码已经读取 `process.env.PORT || 3001`,无需修改。
5. **自定义域名**(可选):
   - 在 Railway 中添加自定义域名,并更新后端的 `CLIENT_URL` 变量和前端的 `VITE_API_URL` 变量。

## 6. 连接 Vercel 前端

在 Vercel 中,配置以下变量:

- `VITE_API_URL`:`https://<your-app>.railway.app`(或你的自定义域名)。
- `VITE_OPENAI_BASE_URL`(可选):`https://<your-app>.railway.app/api/ai/proxy`。

随后重新部署前端,以应用新的后端 URL。

## 7. 保持后端同步

- 在新仓库中继续开发后端。如果你想将变更回流到单一仓库,可以使用 `git subtree pull` 或重新复制修改。
- 在每个仓库中清楚地标明真理之源所在。
- 考虑搭建一套 CI 工作流(GitHub Actions),在每个 PR 部署前运行 `npm run build` 和 `npm run test`。

---

按照这些步骤,你的 Node.js/Express(TypeScript)后端将被隔离在一个独立仓库中,准备好部署到 Railway,而前端可以继续部署在 Vercel 上,通过 `VITE_API_URL` 指向 Railway 的 API。
