> **Translations:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md)

<div dir="rtl">

# نشر الواجهة الخلفية لـ Pen على Railway في مستودع منفصل

يشرح هذا الدليل كيفية استخراج المجلد `backend/` من مستودع `pen-saas` الموحَّد ووضعه في مستودع Git مستقل لتوصيله بـ Railway، مع إبقاء الواجهة الأمامية على Vercel.

## 1. المتطلبات المسبقة

- صلاحية الكتابة على مستودع `pen-saas` الموحَّد.
- Git ≥ 2.30 (لـ `git subtree`) و Node.js 18+.
- حساب Railway مع صلاحية إنشاء مشروع وخدمات (PostgreSQL/Redis).
- مستودع Git بعيد فارغ (GitHub أو GitLab أو غيرهما) مخصَّص فقط للواجهة الخلفية.

## 2. استخراج الواجهة الخلفية إلى مستودع جديد

> 🎯 الهدف: الحصول على سجل Git نظيف يحتوي فقط على المجلد `backend/` وشجرته الفرعية (`prisma/`، `src/`، `scripts/`، إلخ).

### خطوات سريعة باستخدام `git subtree`

1. من جذر المستودع الموحَّد، أنشئ فرعًا مؤقتًا يحتوي على الواجهة الخلفية فقط:
   ```bash
   git subtree split --prefix=backend -b backend-only
   ```
2. ابدأ مستودعًا محليًا جديدًا انطلاقًا من هذا الفرع:
   ```bash
   git clone . ../pen-backend --branch backend-only --single-branch
   cd ../pen-backend
   ```
3. نظِّف المراجع غير الضرورية، ثم اربط المستودع البعيد النهائي:
   ```bash
   git remote remove origin
   git remote add origin git@github.com:YOUR-ORG/pen-backend.git
   git push -u origin backend-only:main
   ```
4. احذف الفرع المؤقت من المستودع الموحَّد إذا لم تعد بحاجة إليه:
   ```bash
   cd ../pen-saas
   git branch -D backend-only
   ```

### بديل: نسخ يدوي (بدون سجل)

1. أنشئ مجلدًا فارغًا وقم بتهيئة Git:
   ```bash
   mkdir ../pen-backend && cp -R backend/* ../pen-backend
   cd ../pen-backend
   git init
   ```
2. أضف الملفات الأساسية الموجودة في جذر مجلد الواجهة الخلفية:
   - `package.json` / `package-lock.json`
   - `tsconfig.json`
   - `Dockerfile.dev`
   - `prisma/`، `scripts/`، `src/`
3. أنشئ ملف `.gitignore` بسيطًا:
   ```bash
   cat <<'EOT' > .gitignore
   node_modules
   dist
   .env
   .env.*
   EOT
   ```
4. نفِّذ commit ثم push إلى المستودع البعيد الجديد:
   ```bash
   git add .
   git commit -m "Initial backend export"
   git remote add origin git@github.com:YOUR-ORG/pen-backend.git
   git push -u origin main
   ```

## 3. تجهيز مستودع الواجهة الخلفية لـ Railway

1. تأكد من أن `package.json` يكشف بشكل صحيح عن سكربتات البناء والتشغيل التي يستخدمها Railway:
   - `npm run build` → `tsc` (يولِّد `dist/`).
   - `npm run start` → `node dist/index.js`.
2. أضف ملف `README` (هذا المستند) ووصفًا للمشروع عند الحاجة.
3. نفِّذ محليًا:
   ```bash
   npm install
   npx prisma generate
   npm run build
   ```
   هذا يضمن عمل التبعيات ومحوِّل TypeScript قبل أول عملية نشر.

## 4. متغيرات البيئة الضرورية

أنشئ ملف `.env` محليًا (واملأ المتغيرات في Railway). أهم المتغيرات:

| المتغير | الدور |
| --- | --- |
| `DATABASE_URL` | عنوان PostgreSQL الرئيسي (يُنصح بـ Railway Postgres). |
| `EMBEDDING_DATABASE_URL` | الاتصال بقاعدة البيانات المتجهية / Postgres الثاني (إن وُجد). |
| `REDIS_URL` | نسخة Redis للتخزين المؤقت ومحدِّدات المعدَّل وWebSocket. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | الوصول إلى توليدات الذكاء الاصطناعي. |
| `OPENAI_DASHBOARD_MODEL` | النموذج المفضَّل للوحة التحكم (اختياري ومدعوم في الكود). |
| `OPENAI_MAX_REQUESTS_PER_HOUR`، `OPENAI_MAX_TOKENS_PER_HOUR`، `OPENAI_MAX_COST_PER_HOUR` | حدود حصص الذكاء الاصطناعي (قيم افتراضية موجودة في الكود). |
| `CLERK_SECRET_KEY`، `CLERK_WEBHOOK_SECRET` | مصادقة Clerk. |
| `CLIENT_URL` | عنوان الواجهة الأمامية العام (Vercel) لضبط CORS. |
| `TAVILY_API_KEY` | بحث خارجي لمساعد الذكاء الاصطناعي (اختياري لكن موصى به). |
| `GEMINI_API_KEY` / `GEMINI_THINKING_MODEL` | دعم Google Gemini (اختياري). |
| `ASSISTANT_ID`، `ASSISTANT_ID_DOCUMENTS`، `ASSISTANT_ID_2` | معرِّفات OpenAI Assistant إذا كنت تستخدم معرِّفاتك الخاصة. |
| `RAG_EMBEDDING_CONCURRENCY`، `RAG_DB_BATCH_SIZE` | معاملات استيعاب RAG (قيم افتراضية متوفرة). |

> ℹ️ يُخفي Railway المتغيرات الحساسة تلقائيًا. تذكَّر مزامنة القيم نفسها في Vercel عندما تحتاجها الواجهة الأمامية (مثل `VITE_API_URL`).

## 5. النشر على Railway

1. **إنشاء مشروع Railway**:
   - أضف خدمة PostgreSQL، وعند اللزوم خدمة Redis.
   - دوِّن عناوين الاتصال التي يكشفها Railway (زر «Variables»).
2. **إضافة خدمة Node.js**:
   - اختر «Deploy from GitHub» وحدِّد مستودع الواجهة الخلفية.
   - دع Railway يكتشف عملية البناء:
     - Install command: `npm install`
     - Build command: `npm run build`
     - Start command: `npm run start`
   - أضف متغيرات البيئة المذكورة أعلاه.
3. **ترحيلات Prisma**:
   - في طرفية Railway، نفِّذ:
     ```bash
     railway run npx prisma migrate deploy
     ```
     أو لدفع المخطط دون ترحيل: `railway run npm run db:push`.
4. **اختبارات السلامة**:
   - تأكد من أن الخدمة تستجيب على المنفذ المُخصَّص (يقدِّم Railway `PORT`). كود الواجهة الخلفية يقرأ بالفعل `process.env.PORT || 3001`، لا داعي لأي تغيير.
5. **النطاقات المخصَّصة** (اختياري):
   - أضف نطاقًا مخصَّصًا في Railway وحدِّث المتغيِّر `CLIENT_URL` في الواجهة الخلفية و`VITE_API_URL` في الواجهة الأمامية.

## 6. ربط واجهة Vercel الأمامية

في Vercel، اضبط المتغيرات التالية:

- `VITE_API_URL`: `https://<your-app>.railway.app` (أو نطاقك المخصَّص).
- `VITE_OPENAI_BASE_URL` (اختياري): `https://<your-app>.railway.app/api/ai/proxy`.

ثم أعِد نشر الواجهة الأمامية لتعميم عنوان الواجهة الخلفية الجديد.

## 7. إبقاء الواجهة الخلفية متزامنة

- استمر في تطوير الواجهة الخلفية في المستودع الجديد. إذا أردت إعادة التغييرات إلى المستودع الموحَّد، يمكنك استخدام `git subtree pull` أو إعادة نسخ التعديلات.
- وثِّق بوضوح في كل مستودع موقع المصدر الموثوق (source of truth).
- ضع في اعتبارك إعداد سير عمل CI (GitHub Actions) لتشغيل `npm run build` و `npm run test` على كل PR قبل النشر.

---

باتباع هذه الخطوات، تصبح الواجهة الخلفية Node.js/Express (TypeScript) معزولة في مستودع مستقل وجاهزة للنشر على Railway، بينما تستمر الواجهة الأمامية على Vercel مع `VITE_API_URL` يشير إلى واجهة Railway البرمجية.

</div>
