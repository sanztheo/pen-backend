# pen-backend

> Pennote API — Node.js + Prisma + Vercel AI SDK. بث AI متعدد المزودين، تعاون Yjs، فوترة Paddle، RAG مع pgvector.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)]()
[![AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-v6-black)]()

> **الترجمات:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md)

<div dir="rtl">

> **🟡 حالة المشروع — مفتوح المصدر منذ مايو 2026.** بُنيَ Pennote بوصفه SaaS لكنه لم يبلغ product-market fit (وصلنا إلى نحو 50 مستخدمًا دون نمو فعلي). بدلًا من ترك الكود يتعفّن في الخفاء، فتحنا مصدره. استخدمه، اعمل عليه fork، تعلّم منه، استضِف نسختك بنفسك. تُرحَّب الـ issues والـ PRs — انظر [`CONTRIBUTING.md`](CONTRIBUTING.md). الصيانة تُجرى وفق أفضل جهد.

## ما هو

واجهة HTTP / WebSocket التي تقف خلف Pennote. خدمة Node مبنية على Express مع Prisma فوق مخططَي Postgres (الرئيسي + pgvector لتخزين الـ embeddings)، وبث AI عبر SSE من خلال Vercel AI SDK، وتعاون Yjs عبر WebSocket مع تخزين دائم في Postgres. يُستخدم هذا المستودع أيضًا بصفته submodule ضمن monorepo [Pennote](https://github.com/sanztheo/Pennote).

## أبرز الملامح

- **مخططا Prisma مزدوجان** — بيانات التطبيق الرئيسية بالإضافة إلى مخطط pgvector منفصل لـ embeddings الخاص بـ RAG، يُولَّدان من `prisma/schema.prisma` و`prisma/schema-embeddings.prisma`
- **تجاوز فشل AI متعدد المزودين** عبر Vercel AI SDK v6 — Anthropic، OpenAI، Google، DeepSeek، Moonshot، xAI؛ توجيه المزوّد بحسب وضع الـ agent مع نقل الـ timeout والـ abort
- **بث SSE قابل للاستئناف** — يمكن للعملاء قطع الاتصال وإعادة الاتصال أثناء completion عبر `resumable-stream`؛ تُحفظ tokens المحادثة فور وصولها
- **تعاون Yjs CRDT** — خادم WebSocket (`ws` + `y-protocols`) مع لقطات مخزَّنة في Postgres؛ مصالحة دون اتصال عند إعادة الاتصال
- **خط أنابيب ذكاء الـ Quiz** — استخراج المفاهيم، تسلسل تكيّفي، توليد بثّي، تجميع الإحصائيات؛ مع benchmark عبر `npm run benchmark:quiz`
- **عمال BullMQ** فوق Redis لمهام الخلفية (تنظيف، embeddings، مهام مجدولة)
- **حارس إقلاع لنسخة واحدة** — يرمي الخادم خطأً عند الإقلاع إذا كان `REPLICA_COUNT > 1`؛ هذا ضروري لأن خريطة وثائق Yjs، وقفل تحرير الصفحة (page-edit mutex)، وذاكرة نتائج الـ tools كلها في الذاكرة
- **خاصية idempotency لـ webhooks Paddle** — التحقق من التوقيع على raw-body مع حواجز ضدّ المعالجة المزدوجة على أحداث دورة حياة الاشتراك
- **~200 endpoint موزَّعة على 31 ملف routes**، مهيكَلة حول طبقات middleware (auth ← التفويض ← التحقق ← handler)

## الحزمة التقنية

| الطبقة | الاختيار |
|--------|----------|
| Runtime | Node.js 22، ESM |
| HTTP | Express 4، Helmet، CORS، compression |
| قاعدة البيانات | PostgreSQL عبر Prisma 6 (مخطط مزدوج) |
| Vector DB | pgvector (مخطط Postgres منفصل) |
| الذاكرة المؤقتة / الطوابير | Redis (ioredis)، BullMQ |
| Auth | Clerk (`@clerk/backend`) |
| الفوترة | Paddle (`@paddle/paddle-node-sdk`) + التحقق من HMAC على raw-body |
| AI | Vercel AI SDK v6، 6 حزم مزودين، فولباك OpenAI SDK |
| Embeddings | `@xenova/transformers` (محلي) + OpenAI |
| الزمن الفعلي | `ws`، `y-protocols`، `socket.io` (legacy) |
| البث | `resumable-stream` لاستئناف SSE |
| إدارة الملفات | Multer، Sharp، Cloudinary، mammoth (DOCX)، pdf-lib |
| البريد | Resend |
| التحقق | Zod |
| تحديد المعدل | express-rate-limit + rate-limit-redis |

## بداية سريعة

```bash
# استنساخ (أو العمل داخل monorepo Pennote)
git clone https://github.com/sanztheo/pen-backend.git
cd pen-backend

# تثبيت
npm install

# الإعداد
cp .env.example .env
# املأ DATABASE_URL، EMBEDDING_DATABASE_URL، REDIS_URL، CLERK_SECRET_KEY، ...

# توليد عملاء Prisma (المخططان معًا)
npx prisma generate
npx prisma generate --schema=prisma/schema-embeddings.prisma

# تشغيل الـ migrations
npm run db:migrate

# التطوير (المنفذ 3001)
npm run dev          # يستخدم Infisical للأسرار — انظر أدناه
npm run dev:local    # tsx watch خام، يقرأ .env مباشرةً
```

## متغيرات البيئة

يتضمن المستودع ملف `.env.example` بالقائمة الكاملة. المتغيرات الحرجة:

| المتغير | إلزامي | الوصف |
|---------|--------|-------|
| `DATABASE_URL` | نعم | سلسلة اتصال Postgres الرئيسية |
| `EMBEDDING_DATABASE_URL` | نعم | Postgres **منفصل** مع تثبيت إضافة `vector` |
| `REDIS_URL` | نعم | Redis للذاكرة المؤقتة وتحديد المعدل وBullMQ |
| `CLIENT_URL` | نعم | أصل الواجهة الأمامية (allow-list لـ CORS) |
| `CLERK_SECRET_KEY` | نعم | مفتاح Clerk الخلفي |
| `CLERK_WEBHOOK_SECRET` | نعم | للتحقق من webhooks الخاصة بـ Clerk |
| `OPENAI_API_KEY` | واحد على الأقل | مطلوب مفتاح مزوّد AI واحد على الأقل |
| `ANTHROPIC_API_KEY` | واحد على الأقل | |
| `GOOGLE_GENERATIVE_AI_API_KEY` | واحد على الأقل | |
| `DEEPSEEK_API_KEY` | واحد على الأقل | |
| `MOONSHOT_API_KEY` | واحد على الأقل | |
| `XAI_API_KEY` | واحد على الأقل | |
| `PADDLE_API_KEY` | للفوترة | مفتاح Paddle Billing API |
| `PADDLE_WEBHOOK_SECRET` | للفوترة | سرّ توقيع webhooks في Paddle |
| `ENCRYPTION_KEY` | نعم | hex بطول 32 بايت يُستخدم للتشفير at-rest للحقول الحساسة |
| `RESEND_API_KEY` | للبريد | بريد إلكتروني تعاملي |
| `CLOUDINARY_*` | للرفع | استضافة الصور |
| `REPLICA_COUNT` | اختياري | الافتراضي `1`. يرفض الإقلاع البدء إذا تجاوز 1. |

اصطلاح: تطلق env vars استثناءً عند غيابها — لا fallbacks صامتة. `if (!process.env.X) throw new Error(...)`.

تُدار الأسرار في الإنتاج عبر [Infisical](https://infisical.com/). تغلِّف سكربتات `dev` الأوامر تلقائيًا بـ `infisical run --env=dev --path=/Backend --`.

> **مزلق pgvector:** يجب أن يشير `EMBEDDING_DATABASE_URL` إلى مثيل Postgres نُفِّذ فيه `CREATE EXTENSION vector;` من قبل. يُولَّد عميل Prisma لذلك المخطط بصورة منفصلة ويوجد في `src/lib/prismaEmbeddings.ts`. استورِد `Prisma` دومًا من نفس الحزمة التي يُستورد منها العميل المستخدم، وإلا فسيُحوَّل `Prisma.raw()` بصمت إلى JSON.

## بنية المشروع

```
src/
├── index.ts            # الإقلاع، تطبيق Express، الـ routers المثبتة
├── routes/             # 31 ملف routes — واحد لكل domain
├── controllers/        # طبقة تنسيق رفيعة
├── services/           # منطق العمل، توجيه مزودي AI، خط أنابيب الـ quiz
├── middlewares/        # auth، التفويض، التحقق، rate-limit
├── workers/            # عمال BullMQ
├── jobs/               # تعريفات jobs المُدرَجة في BullMQ
├── cron/               # جداول node-cron
├── lib/                # عملاء Prisma (الرئيسي + embeddings)، Redis، عملاء AI
├── validators/         # مخططات Zod
├── utils/              # logger، مساعدات الأخطاء، التشفير، إلخ.
└── types/              # أنواع TS مشتركة
prisma/
├── schema.prisma                # قاعدة البيانات الرئيسية
└── schema-embeddings.prisma     # قاعدة بيانات pgvector
```

## البنية المعمارية

**بث SSE.** تكتب نقاط نهاية chat completion الـ deltas عبر مغلِّف `resumable-stream`. يُعاد stream id مقدَّمًا، فيتمكّن العميل المنقطع من الاستئناف من آخر token محفوظ. يحدث failover المزوّد قبل البايت الأول؛ ما إن يبدأ البث، يفرض `AbortSignal.timeout()` حدًّا أعلى، ويُستدعى `consumeStream()` دائمًا بعد `pipeUIMessageStreamToResponse(res)` لتفريغ الـ tokens قيد الإرسال.

**عميل Prisma مزدوج.** يقع العميل الرئيسي في `lib/prisma.ts`. أما عميل embeddings فيقع في `lib/prismaEmbeddings.ts` ويستخدم عميلًا مولَّدًا في `node_modules/.prisma/client-embeddings`. لا يتشاركان معاملة (transaction) أبدًا — تتم كتابات embeddings عند نجاح التدفق الأب.

**استمرارية Yjs على Postgres.** يقوم خادم WebSocket بترقية اتصالات `/yjs/:docId`، وينشئ `Y.Doc` لكل وثيقة، ويحفظ اللقطات/التحديثات في Postgres. يضمن حارس الإقلاع لنسخة واحدة أن عملية واحدة فقط تحتفظ بخريطة الوثائق؛ فإذا حاولت نسخة ثانية الإقلاع، فإنها تتوقف بصخب.

**Idempotency للـ webhooks.** تمر webhooks Paddle عبر التحقق من التوقيع على raw-body (يُركَّب بـ `express.raw()` *قبل* `express.json()`)، ثم تخضع لتحقّق من مفتاح idempotency مدعوم بقاعدة البيانات قبل أي أثر جانبي. انظر `src/routes/paddleWebhooks.ts` و`src/routes/paddleWebhookHelpers.ts`.

**ذكاء Quiz.** يُقطَّع المحتوى المصدر إلى chunks، وتُستخرج مفاهيمه (LLM)، ثم تُبثّ الأسئلة وتُرتّب بمسلسل تكيّفي يستخدم إجابات المستخدم الأخيرة. يجري تجميع الإحصائيات على عمال خلفية.

**أمن ذاكرة الـ tools.** يجب أن تتضمن أي ذاكرة لنتائج tool كلًّا من `userId` و`workspaceId` في مفتاحها (`services/agent/tools/helpers/cacheKey.ts` — `toolCacheKey()`). أي مفتاح ينقصه أحدهما يفتح بابًا لتسريب بيانات بين الـ tenants.

## الأوامر

```bash
npm run dev                    # Infisical + tsx watch (المنفذ 3001)
npm run dev:local              # tsx watch خام مع .env المحلي
npm run build                  # prisma generate (x2) + tsc
npm run start                  # خادم الإنتاج
npm run db:migrate             # prisma migrate dev (هجرات آمنة)
npm run db:push                # prisma db push (DEV فقط — ممنوع في الإنتاج، ممنوع --force-reset)
npm run db:studio              # Prisma Studio
npm test                       # Jest
npm run test:coverage          # تقرير التغطية
npm run test:load              # مشغّل اختبار الحمل
npm run test:load:light        # 5 مستخدمين / 3 طلبات
npm run test:load:medium       # 20 مستخدمًا / 10 طلبات
npm run test:load:heavy        # 50 مستخدمًا / 20 طلبًا
npm run benchmark:quiz         # benchmark كامل لخط أنابيب الـ quiz
npm run benchmark:quiz:small   # ...:medium ...:large ...:xlarge
npm run lint                   # ESLint
npm run format                 # Prettier
```

## الاختبارات

- **وحدوية / تكاملية:** Jest مع `--experimental-vm-modules` (ESM). توجد الاختبارات في `src/__tests__` و`src/tests`.
- **اختبار الحمل:** `tsx test-load.ts` — أعداد قابلة للتهيئة من المستخدمين/الطلبات، أعلام لكل ميزة (`--test=quiz`، `--test=credits`).
- **مقياس WebSocket:** `npm run test:artillery` على `artillery-websocket.yml`.
- **benchmark Quiz:** يقيس `npm run benchmark:quiz` التأخير عند 4 أحجام من المحتوى.

## النشر

يُنشَر الـ backend على **Railway** بوصفه **نسخة واحدة (single replica)**. تؤدي عدة نسخ إلى إفساد خريطة وثائق Yjs في الذاكرة وقفل page-edit؛ ويرفض حارس الإقلاع البدء إذا كان `REPLICA_COUNT > 1`. يُشغِّل البناء `prisma generate` للمخططَين قبل `tsc`. تُقلِع البيئة الإنتاجية عبر `node dist/index.js` مع `NODE_OPTIONS=--max-old-space-size=7168`. انتقل إلى قفل موزَّع على Redis قبل أي توسيع أفقي. انظر `docs/guides/deployment-runbook.md` في [monorepo](https://github.com/sanztheo/Pennote).

## خارطة الطريق والحالة

هذه لقطة تصونها المجتمع. لم يعد الـ SaaS الأصلي نشطًا. سنقبل الـ PRs التي:

- تصلح الأخطاء
- تحسّن التوثيق
- تضيف اختبارات ناقصة
- تنفّذ ميزات لها حالة استخدام واضحة لمن يقومون بالاستضافة الذاتية

ومن الأرجح أننا سنرفض الـ PRs التي:

- تعيد هيكلة البنية بدون نقاش مسبق
- تضيف مزودي SaaS جدد دون قيمة حقيقية
- تغيّر الترخيص أو الإسناد

## المساهمة

انظر [`CONTRIBUTING.md`](CONTRIBUTING.md) و[`BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md). يجب أن يوافق جميع المساهمين على [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## الأمن

إذا اكتشفت ثغرة، **لا تفتح issue علنية**. انظر [`SECURITY.md`](SECURITY.md) — أبلغ عنها عبر <sanztheopro@gmail.com>.

## الترخيص

[GNU AGPLv3](LICENSE). Copyright (C) 2026 Théo Sanz.

إذا قمت باستضافة ذاتية لإصدار معدَّل من Pennote وقدّمته لمستخدمين، فإن AGPLv3 يُلزمك بنشر تعديلاتك. هذا يحمي المشروع من forks SaaS مغلقة المصدر. إذا كنت تحتاج ترخيصًا مختلفًا لإعادة استخدام تجاري مشروع، تواصل عبر <sanztheopro@gmail.com>.

## شكر وتقدير

مبني على [Express](https://expressjs.com/) و[Prisma](https://www.prisma.io/) و[Vercel AI SDK](https://sdk.vercel.ai/) و[Yjs](https://yjs.dev/) و[BullMQ](https://docs.bullmq.io/) و[Clerk](https://clerk.com/) و[Paddle](https://www.paddle.com/). شكرًا لجميع صائني الـ upstream.

## التواصل

- الصائن: Théo Sanz
- البريد: <sanztheopro@gmail.com>
- Issues: [GitHub Issues](https://github.com/sanztheo/pen-backend/issues)
- Discussions: [GitHub Discussions](https://github.com/sanztheo/pen-backend/discussions)

</div>
