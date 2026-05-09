> **Translations:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [العربية](README.ar.md)

# Pen バックエンドを別リポジトリで Railway にデプロイする

このガイドでは、`pen-saas` モノレポから `backend/` フォルダを独立した Git リポジトリに切り出し、Railway に接続する方法を説明します。フロントエンドは引き続き Vercel に置きます。

## 1. 前提条件

- `pen-saas` モノレポへの書き込み権限。
- Git ≥ 2.30(`git subtree` 用)と Node.js 18+。
- プロジェクトおよびサービス(PostgreSQL/Redis)を作成できる権限を持つ Railway アカウント。
- バックエンド専用の空の Git リモートリポジトリ(GitHub、GitLab など)。

## 2. バックエンドを新しいリポジトリへ切り出す

> 🎯 目標:`backend/` ディレクトリとそのサブツリー(`prisma/`、`src/`、`scripts/` など)のみを含むクリーンな Git 履歴を得ること。

### `git subtree` を使った迅速な手順

1. モノレポのルートで、バックエンドのみを含む一時ブランチを作成します:
   ```bash
   git subtree split --prefix=backend -b backend-only
   ```
2. このブランチから新しいローカルリポジトリを初期化します:
   ```bash
   git clone . ../pen-backend --branch backend-only --single-branch
   cd ../pen-backend
   ```
3. 不要な参照を整理し、最終的なリモートリポジトリを接続します:
   ```bash
   git remote remove origin
   git remote add origin git@github.com:YOUR-ORG/pen-backend.git
   git push -u origin backend-only:main
   ```
4. 不要になった一時ブランチをモノレポから削除します:
   ```bash
   cd ../pen-saas
   git branch -D backend-only
   ```

### 代替手段:手動コピー(履歴なし)

1. 空のフォルダを作成し、Git を初期化します:
   ```bash
   mkdir ../pen-backend && cp -R backend/* ../pen-backend
   cd ../pen-backend
   git init
   ```
2. backend フォルダのルートにある必須ファイルを追加します:
   - `package.json` / `package-lock.json`
   - `tsconfig.json`
   - `Dockerfile.dev`
   - `prisma/`、`scripts/`、`src/`
3. 最小限の `.gitignore` を作成します:
   ```bash
   cat <<'EOT' > .gitignore
   node_modules
   dist
   .env
   .env.*
   EOT
   ```
4. コミットして新しいリモートリポジトリにプッシュします:
   ```bash
   git add .
   git commit -m "Initial backend export"
   git remote add origin git@github.com:YOUR-ORG/pen-backend.git
   git push -u origin main
   ```

## 3. バックエンドリポジトリを Railway 用に準備する

1. `package.json` が Railway で利用するビルドおよび起動スクリプトを正しく公開していることを確認します:
   - `npm run build` → `tsc`(`dist/` を生成)。
   - `npm run start` → `node dist/index.js`。
2. 必要に応じて `README` ファイル(本ドキュメント)とプロジェクトの説明を追加します。
3. ローカルで実行します:
   ```bash
   npm install
   npx prisma generate
   npm run build
   ```
   これにより、初回デプロイ前に依存関係と TypeScript トランスパイラが正しく機能することを保証できます。

## 4. 必須の環境変数

ローカルで `.env` ファイルを作成し、Railway 上にも変数を設定します。重要なものは以下のとおり:

| 変数 | 役割 |
| --- | --- |
| `DATABASE_URL` | メイン PostgreSQL URL(Railway Postgres を推奨)。 |
| `EMBEDDING_DATABASE_URL` | ベクター DB / 2 つ目の Postgres への接続(使用する場合)。 |
| `REDIS_URL` | キャッシュ、レート制限、WebSocket 用の Redis インスタンス。 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | AI 生成へのアクセス。 |
| `OPENAI_DASHBOARD_MODEL` | ダッシュボード優先モデル(任意、コードでサポート済み)。 |
| `OPENAI_MAX_REQUESTS_PER_HOUR`、`OPENAI_MAX_TOKENS_PER_HOUR`、`OPENAI_MAX_COST_PER_HOUR` | AI クォータ上限(コード内にデフォルト値あり)。 |
| `CLERK_SECRET_KEY`、`CLERK_WEBHOOK_SECRET` | Clerk 認証。 |
| `CLIENT_URL` | CORS 設定用のフロントエンド公開 URL(Vercel)。 |
| `TAVILY_API_KEY` | AI アシスタント用の外部検索(任意だが推奨)。 |
| `GEMINI_API_KEY` / `GEMINI_THINKING_MODEL` | Google Gemini サポート(任意)。 |
| `ASSISTANT_ID`、`ASSISTANT_ID_DOCUMENTS`、`ASSISTANT_ID_2` | 自身の OpenAI Assistant ID を使う場合の識別子。 |
| `RAG_EMBEDDING_CONCURRENCY`、`RAG_DB_BATCH_SIZE` | RAG インジェスチョンのパラメータ(デフォルト値あり)。 |

> ℹ️ Railway は機密変数を自動的にマスクします。フロントエンドが必要とする値(例:`VITE_API_URL`)は Vercel 側にも同期するのを忘れないでください。

## 5. Railway へのデプロイ

1. **Railway プロジェクトの作成**:
   - PostgreSQL サービスを追加し、必要に応じて Redis サービスも追加します。
   - Railway が公開する接続 URL を控えます(「Variables」ボタン)。
2. **Node.js サービスの追加**:
   - 「Deploy from GitHub」を選択し、バックエンドリポジトリを選びます。
   - Railway にビルドを検出させます:
     - Install command:`npm install`
     - Build command:`npm run build`
     - Start command:`npm run start`
   - 上記の環境変数を追加します。
3. **Prisma マイグレーション**:
   - Railway のターミナルで実行します:
     ```bash
     railway run npx prisma migrate deploy
     ```
     またはマイグレーションせずスキーマを反映する場合は `railway run npm run db:push`。
4. **ヘルスチェック**:
   - サービスが割り当てられたポートで応答することを確認します(Railway は `PORT` を提供)。バックエンドコードは既に `process.env.PORT || 3001` を読んでいるため変更不要です。
5. **カスタムドメイン**(任意):
   - Railway でカスタムドメインを追加し、バックエンドの `CLIENT_URL` とフロントエンドの `VITE_API_URL` を更新します。

## 6. Vercel フロントエンドを接続する

Vercel で以下の変数を設定します:

- `VITE_API_URL`:`https://<your-app>.railway.app`(またはカスタムドメイン)。
- `VITE_OPENAI_BASE_URL`(任意):`https://<your-app>.railway.app/api/ai/proxy`。

その後、フロントエンドを再デプロイして新しいバックエンド URL を反映させます。

## 7. バックエンドを同期し続ける

- 新しいリポジトリでバックエンドの開発を継続します。変更をモノレポに戻したい場合は `git subtree pull` を使うか、再度コピーします。
- 各リポジトリで真実の所在(source of truth)を明確にドキュメント化します。
- デプロイ前に各 PR で `npm run build` と `npm run test` を実行する CI ワークフロー(GitHub Actions)の整備を検討してください。

---

これらの手順に従えば、Node.js/Express(TypeScript)バックエンドは独立したリポジトリに分離され、Railway へのデプロイ準備が整います。一方フロントエンドは引き続き Vercel 上で稼働し、`VITE_API_URL` で Railway API を指し示します。
