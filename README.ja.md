# pen-backend

> Pennote API — Node.js + Prisma + Vercel AI SDK。マルチプロバイダーの AI ストリーミング、Yjs コラボレーション、Paddle 課金、pgvector による RAG。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)]()
[![AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-v6-black)]()

> **翻訳:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [العربية](README.ar.md)

> **🟡 プロジェクトの状態 — 2026 年 5 月よりオープンソース。** Pennote は SaaS として構築されましたが、product-market fit には到達しませんでした(約 50 ユーザーまで提供しましたが、トラクションは得られませんでした)。コードを非公開のまま腐らせる代わりに、オープンソース化しました。利用、フォーク、学習、ご自身のインスタンスのセルフホスト、いずれもどうぞ。Issue や PR は歓迎します — [`CONTRIBUTING.md`](CONTRIBUTING.md) を参照してください。メンテナンスは best-effort です。

## これは何か

Pennote の背後にある HTTP / WebSocket API。Express ベースの Node サービスで、2 つの Postgres スキーマ(メイン + embedding 用 pgvector)に対して Prisma を使用し、Vercel AI SDK 経由で SSE 上の AI ストリーミング、Yjs WebSocket コラボレーションを Postgres 永続化と組み合わせます。本リポジトリは [Pennote](https://github.com/sanztheo/Pennote) モノレポのサブモジュールでもあります。

## ハイライト

- **デュアル Prisma スキーマ** — メインアプリのデータに加え、RAG embeddings 用の独立した pgvector スキーマ。それぞれ `prisma/schema.prisma` と `prisma/schema-embeddings.prisma` から生成
- **マルチプロバイダー AI フェイルオーバー**(Vercel AI SDK v6 経由)— Anthropic、OpenAI、Google、DeepSeek、Moonshot、xAI;エージェントモードに応じたプロバイダールーティングと、タイムアウト + abort の伝播
- **再開可能な SSE ストリーミング** — クライアントは completion の途中で切断・再接続が可能(`resumable-stream` 経由);チャットトークンは到着次第永続化されます
- **Yjs CRDT コラボレーション** — WebSocket サーバー(`ws` + `y-protocols`)と Postgres にバックされたスナップショット;再接続時にオフラインの整合化
- **Quiz インテリジェンスのパイプライン** — コンセプト抽出、適応的シーケンス、ストリーミング生成、統計集計;`npm run benchmark:quiz` でベンチマーク
- **Redis 上の BullMQ ワーカー** によるバックグラウンドジョブ(クリーンアップ、embeddings、スケジュールタスク)
- **シングルレプリカ起動ガード** — `REPLICA_COUNT > 1` の場合、サーバーは起動時に throw します;Yjs ドキュメントマップ、page-edit mutex、tool 結果キャッシュがいずれもインメモリであるため必要
- **Paddle webhook の冪等性** — raw-body 署名検証と、サブスクリプションのライフサイクルイベントに対する二重処理防止のガード
- **31 のルートファイルにわたる ~200 のエンドポイント**、ミドルウェア層(auth → 認可 → 検証 → handler)を中心に構成

## テックスタック

| レイヤー | 採用 |
|----------|------|
| Runtime | Node.js 22, ESM |
| HTTP | Express 4, Helmet, CORS, compression |
| データベース | PostgreSQL via Prisma 6(デュアルスキーマ) |
| ベクトル DB | pgvector(独立した Postgres スキーマ) |
| キャッシュ / キュー | Redis(ioredis), BullMQ |
| Auth | Clerk(`@clerk/backend`) |
| 課金 | Paddle(`@paddle/paddle-node-sdk`)+ raw-body HMAC 検証 |
| AI | Vercel AI SDK v6、6 つのプロバイダーパッケージ、OpenAI SDK フォールバック |
| Embeddings | `@xenova/transformers`(ローカル)+ OpenAI |
| リアルタイム | `ws`、`y-protocols`、`socket.io`(legacy) |
| ストリーミング | `resumable-stream` による SSE 再開 |
| ファイル処理 | Multer、Sharp、Cloudinary、mammoth(DOCX)、pdf-lib |
| Email | Resend |
| 検証 | Zod |
| レート制限 | express-rate-limit + rate-limit-redis |

## クイックスタート

```bash
# クローン(または Pennote モノレポ内で作業)
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend

# インストール
npm install

# 設定
cp .env.example .env
# DATABASE_URL, EMBEDDING_DATABASE_URL, REDIS_URL, CLERK_SECRET_KEY, ... を埋める

# Prisma クライアントを生成(両方のスキーマ)
npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma

# マイグレーションを実行
npm run db:migrate

# 開発(ポート 3001)
npm run dev          # シークレットに Infisical を使用 — 下記参照
npm run dev:local    # 素の tsx watch、.env を直接読み込む
```

## 環境変数

リポジトリには完全なリストを含む `.env.example` が同梱されています。重要な変数:

| 変数 | 必須 | 説明 |
|------|------|------|
| `DATABASE_URL` | はい | メイン Postgres の接続文字列 |
| `EMBEDDING_DATABASE_URL` | はい | `vector` 拡張がインストール済みの **別の** Postgres |
| `REDIS_URL` | はい | キャッシュ、レート制限、BullMQ 用の Redis |
| `CLIENT_URL` | はい | フロントエンドのオリジン(CORS allow-list) |
| `CLERK_SECRET_KEY` | はい | Clerk のバックエンドキー |
| `CLERK_WEBHOOK_SECRET` | はい | Clerk webhook の検証用 |
| `OPENAI_API_KEY` | 1 つ以上 | AI プロバイダーキーが少なくとも 1 つ必要 |
| `ANTHROPIC_API_KEY` | 1 つ以上 | |
| `GOOGLE_GENERATIVE_AI_API_KEY` | 1 つ以上 | |
| `DEEPSEEK_API_KEY` | 1 つ以上 | |
| `MOONSHOT_API_KEY` | 1 つ以上 | |
| `XAI_API_KEY` | 1 つ以上 | |
| `PADDLE_API_KEY` | 課金時 | Paddle Billing API キー |
| `PADDLE_WEBHOOK_SECRET` | 課金時 | Paddle webhook の署名シークレット |
| `ENCRYPTION_KEY` | はい | 機密フィールドの at-rest 暗号化に用いる 32 バイト hex |
| `RESEND_API_KEY` | メール時 | トランザクションメール |
| `CLOUDINARY_*` | アップロード時 | 画像ホスティング |
| `REPLICA_COUNT` | 任意 | 既定 `1`。1 を超えると起動が拒否されます。 |

慣行: env vars は不在時に throw します — サイレントなフォールバックは行いません。`if (!process.env.X) throw new Error(...)`。

本番のシークレットは [Infisical](https://infisical.com/) で管理されます。`dev` スクリプトはコマンドを自動で `infisical run --env=dev --path=/Backend --` でラップします。

> **pgvector の落とし穴:** `EMBEDDING_DATABASE_URL` は、`CREATE EXTENSION vector;` がすでに実行された Postgres インスタンスを指す必要があります。当該スキーマの Prisma クライアントは別途生成され、`src/lib/prismaEmbeddings.ts` に存在します。利用するクライアントと同じパッケージから常に `Prisma` をインポートしてください。さもないと `Prisma.raw()` がサイレントに JSON に強制変換されます。

## プロジェクト構成

```
src/
├── index.ts            # ブートストラップ、Express アプリ、マウントされたルーター
├── routes/             # 31 のルートファイル — ドメイン毎に 1 つ
├── controllers/        # 薄いオーケストレーション層
├── services/           # ビジネスロジック、AI プロバイダールーティング、quiz パイプライン
├── middlewares/        # auth、認可、検証、rate-limit
├── workers/            # BullMQ ワーカー
├── jobs/               # BullMQ にエンキューされる job 定義
├── cron/               # node-cron スケジュール
├── lib/                # Prisma クライアント(メイン + embeddings)、Redis、AI クライアント
├── validators/         # Zod スキーマ
├── utils/              # logger、エラーヘルパー、暗号化など
└── types/              # 共有 TS 型
prisma/
├── schema.prisma                # メイン DB
└── schema-embeddings.prisma     # pgvector DB
```

## アーキテクチャ

**SSE ストリーミング。** Chat completion エンドポイントは `resumable-stream` ラッパーを通じて delta を書き込みます。stream id は前もって返されるため、切断されたクライアントは最後に永続化されたトークンから再開できます。プロバイダー failover は最初のバイト以前に発生します;ストリーム開始後は `AbortSignal.timeout()` が上限を強制し、`pipeUIMessageStreamToResponse(res)` の後には常に `consumeStream()` を呼び出して in-flight トークンをフラッシュします。

**デュアル Prisma クライアント。** メインクライアントは `lib/prisma.ts` にあります。embeddings クライアントは `lib/prismaEmbeddings.ts` にあり、`node_modules/.prisma/client-embeddings` 配下に生成されたクライアントを使用します。両者はトランザクションを共有しません — embedding の書き込みは親フローの成功時に行われます。

**Yjs の Postgres 永続化。** WebSocket サーバーは `/yjs/:docId` 接続をアップグレードし、ドキュメントごとに 1 つの `Y.Doc` をインスタンス化、スナップショット/更新を Postgres に永続化します。シングルレプリカ起動ガードにより、ドキュメントマップを保持するプロセスは 1 つに限定されます;起動を試みる 2 つ目のインスタンスは派手に abort します。

**Webhook の冪等性。** Paddle webhook は raw-body 署名検証(`express.json()` の *前* に `express.raw()` でマウント)を経たのち、副作用の前にデータベース支援の冪等キーチェックを通過します。`src/routes/paddleWebhooks.ts` と `src/routes/paddleWebhookHelpers.ts` を参照してください。

**Quiz インテリジェンス。** ソースコンテンツはチャンクに分割され、コンセプトが LLM で抽出されたのち、ユーザーの直近の回答を利用する適応的シーケンサーによって質問がストリームされ、ランクされます。統計集計はバックグラウンドワーカー上で実行されます。

**Tool キャッシュの安全性。** Tool 結果キャッシュは、そのキーに `userId` と `workspaceId` の両方を含めなければなりません(`services/agent/tools/helpers/cacheKey.ts` — `toolCacheKey()`)。いずれかが欠落したキーはクロステナントのデータ漏洩を招きます。

## コマンド

```bash
npm run dev                    # Infisical + tsx watch(ポート 3001)
npm run dev:local              # ローカル .env で素の tsx watch
npm run build                  # prisma generate(x2)+ tsc
npm run start                  # 本番サーバー
npm run db:migrate             # prisma migrate dev(安全なマイグレーション)
npm run db:push                # prisma db push(DEV のみ — 本番厳禁、--force-reset 厳禁)
npm run db:studio              # Prisma Studio
npm test                       # Jest
npm run test:coverage          # カバレッジレポート
npm run test:load              # 負荷テストランナー
npm run test:load:light        # 5 ユーザー / 3 リクエスト
npm run test:load:medium       # 20 ユーザー / 10 リクエスト
npm run test:load:heavy        # 50 ユーザー / 20 リクエスト
npm run benchmark:quiz         # quiz パイプラインの完全ベンチマーク
npm run benchmark:quiz:small   # ...:medium ...:large ...:xlarge
npm run lint                   # ESLint
npm run format                 # Prettier
```

## テスト

- **ユニット / 統合:** Jest と `--experimental-vm-modules`(ESM)。テストは `src/__tests__` と `src/tests` に存在します。
- **負荷:** `tsx test-load.ts` — ユーザー/リクエスト数を設定可能、機能ごとのフラグ(`--test=quiz`、`--test=credits`)。
- **WebSocket スケール:** `npm run test:artillery` を `artillery-websocket.yml` に対して実行します。
- **Quiz ベンチマーク:** `npm run benchmark:quiz` は 4 種類のコンテンツサイズでレイテンシを計測します。

## デプロイ

バックエンドは **Railway** に **シングルレプリカ** としてデプロイされます。複数レプリカではインメモリの Yjs ドキュメントマップと page-edit mutex が壊れます;`REPLICA_COUNT > 1` の場合、起動ガードは起動を拒否します。ビルドは `tsc` の前に両方のスキーマで `prisma generate` を実行します。本番は `node dist/index.js` を `NODE_OPTIONS=--max-old-space-size=7168` で起動します。水平スケーリングを行う前に、Redis 分散ロックへ移行してください。[モノレポ](https://github.com/sanztheo/Pennote) の `docs/guides/deployment-runbook.md` を参照してください。

## ロードマップ & 状態

これはコミュニティが維持するスナップショットです。元の SaaS はもう稼働していません。以下に該当する PR は歓迎します:

- バグ修正
- ドキュメント改善
- 不足しているテストの追加
- セルフホスト利用者にとって明確なユースケースのある機能の実装

以下のような PR はおそらく **拒否** します:

- 事前の議論なしのアーキテクチャ再構成
- 真の価値を伴わない新しい SaaS プロバイダーの追加
- ライセンスやアトリビューションの変更

## コントリビュート

[`CONTRIBUTING.md`](CONTRIBUTING.md) と [`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md) を参照してください。すべてのコントリビューターは [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) に同意する必要があります。

## セキュリティ

脆弱性を発見した場合、**公開 issue を立てないでください**。[`SECURITY.md`](SECURITY.md) を参照のうえ、<sanztheopro@gmail.com> までご連絡ください。

## ライセンス

[GNU AGPLv3](LICENSE)。Copyright (C) 2026 Théo Sanz。

Pennote の改変版をセルフホストしてユーザーに提供する場合、AGPLv3 はあなたの改変を公開する義務を課します。これによりプロジェクトはクローズドソースな SaaS フォークから守られます。正当な商用再利用のために別のライセンスが必要な場合は、<sanztheopro@gmail.com> までご連絡ください。

## 謝辞

[Express](https://expressjs.com/)、[Prisma](https://www.prisma.io/)、[Vercel AI SDK](https://sdk.vercel.ai/)、[Yjs](https://yjs.dev/)、[BullMQ](https://docs.bullmq.io/)、[Clerk](https://clerk.com/)、[Paddle](https://www.paddle.com/) の上に構築されています。すべての upstream メンテナーに感謝します。

## 連絡先

- メンテナー: Théo Sanz
- Email: <sanztheopro@gmail.com>
- Issues: [GitHub Issues](https://github.com/sanztheo/pen-backend/issues)
- Discussions: [GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)
