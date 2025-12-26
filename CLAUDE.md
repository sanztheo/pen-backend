# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## ⛔ RÈGLES ABSOLUES - LIRE EN PREMIER

**Ces règles sont NON-NÉGOCIABLES. Les violer = bug en production.**

### 🚫 INTERDICTIONS STRICTES

| ❌ INTERDIT                               | ✅ FAIRE À LA PLACE                                  |
| ----------------------------------------- | ---------------------------------------------------- |
| `fetch("/api/...")` (chemin relatif)      | `fetch(\`${import.meta.env.VITE_API_URL}/api/...\`)` |
| `process.env.X \|\| "default"` (fallback) | `if (!process.env.X) throw new Error(...)`           |
| `<input>`, `<button>`, `<select>` natifs  | `NotionInput`, `NotionButton`, `NotionSelect`        |
| `window.location.reload()`                | `setResetKey(k => k + 1)` avec `key={resetKey}`      |
| Fichier > 300 lignes                      | Séparer en `types.ts`, `utils.ts`, `hooks/`          |
| Prompts AI en français/markdown           | Prompts XML en anglais                               |
| `any` dans TypeScript                     | Types stricts ou `unknown`                           |
| Ajouter signature Claude aux commits      | Commit sans signature                                |

### 📋 CHECKLIST AVANT CHAQUE MODIFICATION

1. [ ] **API calls** → Utilise `VITE_API_URL` (jamais `/api/...` seul)
2. [ ] **UI Forms** → Utilise `Notion*` components
3. [ ] **Env vars** → Pas de fallback, fail fast
4. [ ] **Code structure** → Fichiers < 300 lignes, séparés par responsabilité
5. [ ] **Texte UI** → En français
6. [ ] **Prompts AI** → En anglais, format XML

### 🎨 COMPOSANTS UI OBLIGATOIRES

```typescript
// ⛔ JAMAIS
<input type="text" />
<button onClick={...}>Click</button>
<select><option>...</option></select>
<input type="checkbox" />
<input type="number" />

// ✅ TOUJOURS
import { NotionInput, NotionButton, NotionSelect, NotionCheckbox, NotionNumberInput } from "@/components/ui/...";
```

### 🔑 PATTERN API OBLIGATOIRE

```typescript
// ⛔ CASSE EN PRODUCTION (va vers Vercel, pas le backend)
fetch("/api/users");

// ✅ FONCTIONNE PARTOUT
fetch(`${import.meta.env.VITE_API_URL}/api/users`);
```

### 📝 PATTERN LOGS OBLIGATOIRE

```typescript
// ⛔ POLLUE LA CONSOLE EN PROD
console.log("debug:", data);

// ✅ CONTRÔLÉ
console.log("[PREFIX]:", data);
```

---

## 🚧 PROJET EN COURS - LIRE APRÈS COMPACT

**⚠️ Si tu reviens après un compact de conversation, LIS CETTE SECTION EN PREMIER.**

### Projet Actif: Quiz Intelligence System ✅ COMPLÉTÉ

**Linear Project:** https://linear.app/pennotelinear/project/quiz-simplification-mode-auto-ia-8a55619d87c5

**✅ Fonctionnalités Backend implémentées:**
- Quiz Preprocessor Agent (détermination automatique des paramètres)
- Quiz Intelligence Pipeline (extraction concepts, clustering K-means/DBSCAN)
- Question scoring et déduplication
- Correction enrichment avec références aux sources
- Génération automatique de titres de quiz
- Wikipedia RAG tools pour recherche approfondie
- Support Gemini 3 Flash avec thinking mode + DeepSeek provider
- Système de personnalisation en cascade

**Fichiers clés Backend:**
```
src/services/quiz/
├── preprocessor/
│   └── QuizPreprocessorAgent.ts   → Détermination auto des paramètres
├── intelligence/
│   ├── conceptExtractor.ts        → Extraction async des concepts (BullMQ)
│   ├── thematicClustering.ts      → K-means et DBSCAN clustering
│   ├── questionScoring.ts         → Scoring et déduplication
│   └── smartContentSelector.ts    → Sélection intelligente du contenu
└── correctionEnrichment.ts        → Enrichissement avec références sources

src/services/agent/tools/
└── wikipediaTools.ts              → RAG tools Wikipedia

prisma/schema.prisma
└── model PageConcepts             → Stockage des concepts extraits
```

**Pour reprendre le contexte:**
```bash
mcp__linear__list_issues --project="Quiz Simplification - Mode Auto IA"
```

**⚠️ Utiliser des sub-agents pour les grosses tâches pour éviter d'exploser le contexte.**

---

## Project Overview

Pennote is a Notion-like SaaS application with AI-powered features. Monorepo with two applications:

- **pen-frontend**: React + Vite + TypeScript (port 5173)
- **pen-backend**: Express + TypeScript + Prisma (port 3001)

## Development Commands

### Frontend (pen-frontend/)

```bash
npm run dev          # Start Vite dev server
npm run build        # TypeScript + Vite build
npm run lint         # ESLint check
npx tsc --noEmit     # Type check (use after changes)
```

### Backend (pen-backend/)

```bash
npm run dev          # Start with tsx watch
npm run build        # Prisma generate (both schemas) + tsc
npm run start        # Run compiled dist/index.js

# Database (two Prisma schemas)
npm run db:generate  # Generate main Prisma client
npm run db:push      # Push schema to database
npm run db:migrate   # Run migrations
npm run db:studio    # Open Prisma Studio

# Testing
npm run test:load:light   # Light load test (5 users, 3 requests)
npm run test:load:medium  # Medium load test
npm run test:scalability  # Run scalability tests
```

### Validation After Changes

Always run `npx tsc --noEmit` in the affected directory. Do not run full builds for validation.

## Architecture

### Tech Stack

| Layer     | Frontend                            | Backend                                        |
| --------- | ----------------------------------- | ---------------------------------------------- |
| Framework | Vite + React 18 (NOT Next.js)       | Express.js + TypeScript                        |
| Editor    | BlockNote v0.45.0                   | @blocknote/server-util                         |
| Auth      | Clerk (@clerk/clerk-react)          | Clerk (@clerk/backend)                         |
| Billing   | Paddle.js (checkout overlay)        | Paddle Node SDK (@paddle/paddle-node-sdk)      |
| UI        | Tailwind + Shadcn + Radix + Mantine | -                                              |
| Data      | SWR + React Context                 | Prisma ORM (2 schemas)                         |
| Real-time | Yjs + WebSocket                     | Socket.io + y-protocols                        |
| AI        | Vercel AI SDK + Streamdown          | OpenAI + Gemini 3 Flash + DeepSeek + ai SDK    |
| Queue     | -                                   | BullMQ + Redis                                 |

### Dual Prisma Schema Architecture

The backend uses **two separate Prisma schemas**:

1. **schema.prisma** → Main database (users, workspaces, pages, quizzes)
2. **schema-embeddings.prisma** → Vector database with pgvector for RAG

```bash
# Build generates both clients
prisma generate                                    # Main client
prisma generate --schema=prisma/schema-embeddings.prisma  # Embeddings client
```

The embeddings client outputs to `node_modules/.prisma/client-embeddings`.

### Data Model Hierarchy

```
User
├── Workspace (owner)
│   ├── Project (nested projects supported via parentId)
│   │   └── Page
│   └── AIConversation
├── Quiz / QuizTemplate / QuizSequence
├── UserLimits / UserSubscription
└── UserDashboardLayout
```

RAG system (embeddings DB):

```
RAGSource (PDF, Wikipedia, Web, Workspace pages)
├── RAGChunk (with pgvector embeddings)
└── RAGSession (conversation memory)
```

## Key Patterns

### Path Alias (Frontend)

```typescript
import { Component } from "@/components/ui/Button"; // → ./src/components/ui/Button
```

### API Proxy (vite.config.ts)

Frontend proxies `/api/*` to backend with WebSocket support:

- Local: `http://localhost:3001`
- Docker: `http://backend:3001`
- Production: `VITE_API_URL` env var

### BlockNote Editor Extensions

Custom blocks in `pen-frontend/src/components/editor/blocknotes/`:

- **LaTeX**: Inline and block math rendering
- **Mermaid**: Diagram blocks
- **Page mentions**: Cross-page linking
- **Cloud integrations**: Google Drive, Dropbox, OneDrive
- **AI commands**: Slash menu integration for AI generation

BlockNote v0.45+ features:

- Toggle headings (isToggleable: true)
- Toggle list items
- Headings levels 1-6
- Email/PDF/DOCX export (@blocknote/xl-\* packages)
- AI integration (@blocknote/xl-ai with AIExtension)
- AI abort() support for cancelling requests
- Extensions import from `@blocknote/core/extensions` (filterSuggestionItems, insertOrUpdateBlockForSlashMenu)
- getExtension() API: `editor.getExtension(AIExtension)` replaces `getAIExtension(editor)`

### AI Controllers (pen-backend/src/controllers/ai/)

```
base.ts        → Connection test
content.ts     → Generate, improve, continue content
specialized.ts → Blocks, summaries, translation, correction
autocomplete.ts → Real-time WebSocket suggestions
quota.ts       → Usage tracking
```

### AI Services Architecture

- `AIService` delegates to specialized services
- `AutocompleteService` - WebSocket streaming suggestions
- `ContentGenerationService` - Text generation
- `CodeDetectionService` - Language detection
- Services in `pen-backend/src/services/ai/`

### Agent System (Vercel AI SDK v5)

The chat/assistant uses Vercel AI SDK with multi-step tool calling:

```
pen-backend/src/services/agent/
├── PennoteAgent.ts      → Main agent with streamText()
├── conversationService.ts → Persistence (save/load/list)
└── tools/
    ├── ragTools.ts       → listAvailableSources, searchRagChunks, readRagSource
    ├── workspaceTools.ts → listWorkspacePages, readWorkspacePage, listWorkspaceProjects
    ├── webTools.ts       → searchWeb (OpenAI), searchWikipedia, getWikipediaArticle
    ├── wikipediaTools.ts → indexWikipediaArticle, searchWikipediaRag, getWikipediaContent
    └── pageTools.ts      → createPage, checkPageExists
```

**Agent Modes:**
| Mode | maxSteps | Tools | Usage |
|------|----------|-------|-------|
| `ask` | 10 | RAG + Workspace | Questions simples |
| `search` | 25 | RAG + Workspace + Web | Recherche approfondie |
| `create-quick` | 10 | RAG + Workspace + Page | Génération rapide |
| `create-deep` | 30 | RAG + Workspace + Web + Page | Génération complète |

**Key routes:**

- `POST /api/agent/chat` - Main chat endpoint with SSE streaming
- `GET /api/agent/conversations` - List user conversations
- `GET /api/agent/conversations/:id` - Load conversation messages
- `DELETE /api/agent/conversations/:id` - Soft delete conversation

### Quiz System

Controllers in `pen-backend/src/controllers/quiz/`:

- `assistant/` - AI-powered quiz generation
- `sequences/` - Quiz sequence management
- `documents/` - Document-based quiz creation

### Quiz Intelligence System (NEW)

Pipeline d'intelligence pour génération de quiz optimisée:

```
src/services/quiz/
├── preprocessor/
│   └── QuizPreprocessorAgent.ts   → Détermination auto des paramètres via IA
├── intelligence/
│   ├── conceptExtractor.ts        → Extraction async des concepts (BullMQ jobs)
│   ├── thematicClustering.ts      → K-means et DBSCAN clustering
│   ├── questionScoring.ts         → Scoring et déduplication
│   └── smartContentSelector.ts    → Sélection intelligente du contenu
├── correctionEnrichment.ts        → Enrichissement avec références sources
└── titleGenerator.ts              → Génération automatique de titres
```

**Fonctionnalités:**
- Extraction automatique des concepts clés via IA (async avec BullMQ)
- Clustering thématique K-means/DBSCAN pour regrouper les questions
- Scoring et déduplication des questions
- Enrichissement des corrections avec citations des sources
- Génération automatique de titres de quiz
- Intégration avec personnalisation utilisateur (niveau, spécialités)
- Cache intelligent avec `ragContext` dans la clé

**Modèle Prisma associé:**
```prisma
model PageConcepts {
  id        String   @id @default(uuid())
  pageId    String   @unique
  concepts  Json     // Array of extracted concepts
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Scripts de test:**
```bash
npm run test:quiz:intelligence     # Tests unitaires pipeline
npm run test:quiz:benchmark        # Benchmarking performance
npm run script:seed-test-pages     # Seed pages de test éducatives
```

### Real-time Collaboration

- Yjs for CRDT document state
- WebSocket server in `pen-backend/src/index.ts`
- `lib/y-prisma.ts` for Yjs-Prisma persistence

### Billing Architecture (Paddle)

```
Clerk (Auth) ─────► Authentication, Users, Sessions
       │
       └──────────► User ID (user_xxx) passed to Paddle as customData

Paddle (Billing) ─► Plans, Subscriptions, Payments, Invoices
       │
       └──────────► Webhooks → Backend → Sync DB (UserSubscription)
```

**Key files:**

- `pen-backend/src/routes/billing.ts` - API routes (subscription, cancel, portal-url, checkout-session)
- `pen-backend/src/routes/paddleWebhooks.ts` - Webhook handler (signature verification, event processing)
- `pen-backend/src/services/billing/paddleBilling.ts` - Paddle SDK service
- `pen-backend/src/config/paddle.ts` - Price IDs and config
- `pen-frontend/src/services/paddle.ts` - Paddle.js integration (checkout, portal)
- `pen-frontend/src/pages/PricingPage.tsx` - Pricing and subscription management UI

**Webhook events handled:**

- `subscription.created` / `subscription.activated` → Activate premium
- `subscription.canceled` → Mark for cancellation (active until period end)
- `subscription.paused` / `subscription.resumed` → Pause/resume handling
- `transaction.completed` / `transaction.payment_failed` → Payment logging

## Environment Variables

### Backend Required

```
DATABASE_URL           # Main PostgreSQL
EMBEDDING_DATABASE_URL # pgvector PostgreSQL for RAG
REDIS_URL              # Cache and queues
OPENAI_API_KEY         # OpenAI API
CLERK_SECRET_KEY       # Clerk auth
CLIENT_URL             # Frontend URL for CORS

# Rate Limiting (niveau SaaS professionnel)
RATE_LIMIT_ENABLED=true
RATE_LIMIT_GLOBAL_WINDOW=900000
RATE_LIMIT_GLOBAL_MAX=3000
RATE_LIMIT_AUTH_WINDOW=900000
RATE_LIMIT_AUTH_MAX=15
RATE_LIMIT_AI_WINDOW=900000
RATE_LIMIT_AI_MAX=150
RATE_LIMIT_QUIZ_WINDOW=900000
RATE_LIMIT_QUIZ_MAX=60
RATE_LIMIT_ASSISTANT_WINDOW=900000
RATE_LIMIT_ASSISTANT_MAX=100
RATE_LIMIT_WS_CONNECTIONS=30
RATE_LIMIT_WS_MESSAGES=300
```

### Backend Billing (Paddle)

```
PADDLE_API_KEY         # Paddle API key (sandbox or production)
PADDLE_WEBHOOK_SECRET  # Webhook signature secret
PADDLE_ENVIRONMENT     # "sandbox" or "production"
```

### Backend Optional

```
GEMINI_API_KEY         # Google Gemini 3 Flash support (thinking mode)
DEEPSEEK_API_KEY       # DeepSeek provider support
TAVILY_API_KEY         # Web search for assistant
OPENAI_MODEL           # Default model (gpt-4o-mini recommended)
OPENAI_MAX_REQUESTS_PER_HOUR  # Rate limiting
```

### Frontend Required

```
VITE_API_URL                   # Backend API URL
VITE_CLERK_PUBLISHABLE_KEY     # Clerk frontend key
VITE_PADDLE_CLIENT_TOKEN       # Paddle client-side token
VITE_PADDLE_ENVIRONMENT        # "sandbox" or "production"
```

## Critical Rules

### API Paths (Frontend) - NEVER use relative paths

**TOUJOURS utiliser `VITE_API_URL` pour les appels API backend.**

En production, le frontend (Vercel) et le backend (Railway) sont sur des domaines différents.
Les chemins relatifs `/api/...` vont vers Vercel, pas vers le backend!

```typescript
// ❌ MAUVAIS - chemin relatif, va vers Vercel en prod (404 ou 405)
const API_BASE = "/api/conversations";
fetch("/api/agent/chat", { ... });

// ✅ BON - URL absolue vers le backend
const API_BASE = `${import.meta.env.VITE_API_URL}/api/agent/conversations`;
fetch(`${import.meta.env.VITE_API_URL}/api/agent/chat`, { ... });
```

**Fichiers concernés (exemples):**

- `usePennoteChat.ts` → `/api/agent/chat`
- `useConversationHistory.ts` → `/api/agent/conversations`
- `useWorkflow.ts` → `/api/agent/workflow`
- `limitsApi.ts` → `/api/limits/*`
- Tous les services et hooks qui font des appels API

### Secrets Management (Infisical) - NO fallbacks

**Les secrets sont gérés via Infisical, JAMAIS de valeurs par défaut dans le code.**

Structure Infisical:

```
/Backend/DEV   → Développement local
/Backend/PROD  → Production (Railway)
/Frontend/DEV  → Développement local
/Frontend/PROD → Production (Vercel)
```

```typescript
// ❌ MAUVAIS - fallback en dur = bug silencieux en prod
const apiKey = process.env.API_KEY || "sk-default-key";
const limit = parseInt(process.env.RATE_LIMIT || "100");

// ✅ BON - fail fast si variable manquante
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error("API_KEY manquant dans Infisical");

// ✅ BON - helper de validation
const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`❌ Variable ${name} manquante dans Infisical`);
  return value;
};
```

**Pourquoi?**

- Les fallbacks masquent les erreurs de configuration
- En prod, le code tourne avec des valeurs par défaut incorrectes
- Difficile à débugger ("pourquoi ça marche pas?")
- Toutes les configs doivent être visibles dans Infisical

## Code Structure Rules

**IMPORTANT: Toujours séparer le code de manière logique.**

Ne JAMAIS mettre tout le code dans un seul fichier. Organiser le code ainsi:

1. **Séparation par responsabilité:**

   - `types/` - Interfaces et types TypeScript
   - `utils/` ou `helpers/` - Fonctions utilitaires
   - `hooks/` - Custom React hooks (frontend)
   - `services/` - Logique métier et appels API
   - `controllers/` - Handlers de routes (backend)
   - `components/` - Composants UI (frontend)

2. **Un fichier = une responsabilité:**

   - Extraire les types dans des fichiers `types.ts` séparés
   - Extraire les constantes dans des fichiers `constants.ts`
   - Extraire les fonctions utilitaires dans des fichiers dédiés
   - Maximum ~200-300 lignes par fichier (hors types)

3. **Structure de dossiers pour les features:**

   ```
   feature/
   ├── index.ts          # Exports publics
   ├── types.ts          # Types et interfaces
   ├── constants.ts      # Constantes
   ├── utils.ts          # Fonctions helpers
   ├── FeatureComponent.tsx
   └── hooks/
       └── useFeature.ts
   ```

4. **Exemple - Ce qu'il ne faut PAS faire:**

   ```typescript
   // ❌ MAUVAIS: tout dans un seul fichier de 500+ lignes
   // MyFeature.tsx avec types, utils, hooks, et composant
   ```

5. **Exemple - Ce qu'il FAUT faire:**
   ```typescript
   // ✅ BON: séparation logique
   // types.ts - les interfaces
   // utils.ts - les fonctions helpers
   // useMyFeature.ts - le hook
   // MyFeature.tsx - le composant (imports depuis les autres fichiers)
   ```

## AI/LLM System Prompts - XML Format Standard

**ALWAYS use XML-structured prompts for AI/LLM system prompts.**

Professional AI systems use XML tags for clear structure and better model understanding.

```typescript
// ❌ BAD - Markdown/plain text prompts
const PROMPT = `Tu es un assistant. Fais ceci:
1. Analyse le contenu
2. Extrait les mots-clés
Retourne du JSON.`;

// ✅ GOOD - XML-structured prompts (English, professional)
const PROMPT = `<system>
<role>Educational content analyzer</role>
<task>Extract key concepts and return structured JSON</task>
</system>

<instructions>
<output_format>JSON only, no surrounding text</output_format>
<fields>
  <field name="keywords" type="string[]" count="5-10">Important keywords</field>
  <field name="summary" type="string" max_sentences="3">Brief summary</field>
</fields>
</instructions>

<rules>
<rule>Return ONLY valid JSON</rule>
<rule>Use empty arrays for missing data</rule>
</rules>

<example>
<input>Document about photosynthesis...</input>
<output>{"keywords": ["photosynthesis"], "summary": "..."}</output>
</example>`;
```

**Best Practices:**

- Use English for all AI prompts (better model performance)
- Structure with `<system>`, `<instructions>`, `<rules>`, `<example>` tags
- Define output format explicitly with `<fields>` or `<output_format>`
- Always include at least one `<example>` with input/output
- Use attributes for constraints: `type`, `count`, `max`, `min`
- Keep prompts in separate `types.ts` or `prompts.ts` files

**Files with AI prompts:**

- `pen-backend/src/services/quiz/intelligence/types.ts` - Concept extraction
- `pen-backend/src/services/agent/systemPrompts.ts` - Agent system prompts
- `pen-backend/src/services/quiz/assistant/generation/prompts/` - Quiz generation

## Clerk Integration - Best Practices SaaS

### Architecture des Sessions Clerk

```
┌─────────────────────────────────────────────────────────────────┐
│  CYCLE DE VIE DES TOKENS CLERK                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Token lifetime:     60 secondes                                │
│  Auto-refresh:       Toutes les 50 secondes (background)        │
│  leewayInSeconds:    10s par défaut (refresh 10s avant expiry)  │
│                                                                  │
│  Cookies:                                                        │
│  • __client (7 jours) → Session ID                              │
│  • __session (60s) → User claims, roles, permissions            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### getToken() - Options et Usage

```typescript
import { useAuth } from "@clerk/clerk-react";
const { getToken } = useAuth();

// ✅ Usage standard (cache activé, refresh auto à 50s)
const token = await getToken();

// ✅ Force refresh - UNIQUEMENT si permissions viennent de changer
const token = await getToken({ skipCache: true });

// ✅ Refresh plus agressif (5s avant expiration) - pour long API calls
const token = await getToken({ leewayInSeconds: 5 });
```

| Option            | Valeur         | Usage                                    |
| ----------------- | -------------- | ---------------------------------------- |
| `leewayInSeconds` | 10 (défaut)    | Refresh si token expire dans 10s         |
| `leewayInSeconds` | 5              | Pour requêtes AI longues (>30s)          |
| `skipCache`       | false (défaut) | Utilise le cache (performant)            |
| `skipCache`       | true           | Force refresh (après update permissions) |

### ⛔ Erreurs Courantes

```typescript
// ❌ MAUVAIS - Force refresh à chaque appel (surcharge réseau)
const token = await getToken({ skipCache: true }); // JAMAIS en boucle

// ❌ MAUVAIS - Pas de gestion d'erreur
const token = await getToken();
fetch("/api/...");

// ✅ BON - Cache par défaut + retry si 401
const makeAuthenticatedRequest = async (url: string) => {
  const { getToken } = useAuth();

  let token = await getToken();
  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Retry avec fresh token si 401
  if (response.status === 401) {
    token = await getToken({ skipCache: true });
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  return response;
};
```

### Quand utiliser skipCache

```typescript
// ✅ Après update de permissions/roles
await user.update({ publicMetadata: { role: "admin" } });
await user.reload();
const token = await getToken({ skipCache: true }); // Nouveau role dans le token

// ✅ Après changement de workspace/organization
onWorkspaceChange(async () => {
  const token = await getToken({ skipCache: true });
});

// ❌ MAUVAIS - skipCache pour chaque requête normale
const data = await fetchData(); // N'a pas besoin de skipCache
```

### Rate Limiting par User ID

```typescript
// ❌ MAUVAIS - Rate limit par IP seulement (contournable)
const key = req.ip;

// ✅ BON - Rate limit par userId Clerk (fiable)
import { getAuth } from "@clerk/express";

const { userId } = getAuth(req);
const key = userId || req.ip; // Fallback IP pour non-auth

// Limites différenciées par endpoint
const limits = {
  global: { points: 3000, duration: 900 }, // 3000 req/15min
  ai: { points: 150, duration: 900 }, // 150 req/15min (AI = coûteux)
  auth: { points: 15, duration: 900 }, // 15 req/15min (brute force protection)
};
```

### Error Handling Clerk

```typescript
import { isClerkRuntimeError } from "@clerk/clerk-react";

try {
  const token = await getToken();
} catch (error) {
  if (isClerkRuntimeError(error)) {
    switch (error.code) {
      case "network_error":
        // Retry avec backoff
        break;
      case "authentication_error":
        // Redirect vers login
        navigate("/login");
        break;
      case "user_locked":
        // Afficher temps restant
        const lockoutSeconds = error.meta?.lockout_expires_in_seconds;
        break;
    }
  }
}
```

### Retry Logic avec Exponential Backoff

```typescript
// ✅ Pattern recommandé pour requêtes critiques
const getTokenWithRetry = async (maxRetries = 3): Promise<string | null> => {
  const { getToken } = useAuth();

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await getToken();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      // Exponential backoff: 100ms, 200ms, 400ms
      const delay = Math.pow(2, i) * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return null;
};
```

### Multi-Tenant / Workspace Isolation

```typescript
// ✅ TOUJOURS vérifier l'accès workspace avant de retourner des données
async function verifyWorkspaceAccess(req, res, next) {
  const { userId } = getAuth(req);
  const { workspaceId } = req.params;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
  });

  // Vérifier que l'utilisateur est propriétaire ou membre
  if (!workspace || workspace.ownerId !== userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  req.workspace = workspace;
  next();
}

// Utilisation
app.get(
  "/api/workspaces/:workspaceId/pages",
  requireAuth,
  verifyWorkspaceAccess,
  pagesController
);
```

### SWR + Clerk Integration

```typescript
// ✅ Pattern optimisé pour Pennote
import useSWR from "swr";
import { useAuth } from "@clerk/clerk-react";

export function useAuthenticatedSWR<T>(key: string | null) {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  return useSWR<T>(
    isLoaded && isSignedIn ? key : null,
    async (url) => {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}${url}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Fetch failed");
      return res.json();
    },
    {
      revalidateOnFocus: false, // Évite refetch inutiles
      dedupingInterval: 60000, // Cache 60s
      focusThrottleInterval: 300000, // Throttle 5min
      errorRetryCount: 3, // Retry 3 fois
    }
  );
}
```

**Fichier de référence:** `pen-frontend/src/components/editor/config/customAITransport.ts`

## React/UX Best Practices

### NEVER use window.location.reload()

Pour réinitialiser un composant React sans reload de page:

```typescript
// ❌ MAUVAIS - reload complet, mauvaise UX
if (window.location.pathname === "/chat") {
  window.location.reload();
}

// ✅ BON - utiliser une key React pour forcer le remount
const [resetKey, setResetKey] = useState(0);
const handleReset = () => setResetKey((k) => k + 1);

<MyComponent key={`component-${resetKey}`} />;
```

### PersistentLayer Pattern (ChatGPT/Claude style)

Pour garder un composant monté même lors de changements de route:

```typescript
// Layout.tsx - Le composant reste monté, seule la visibilité change
<PersistentChatLayer />  // Toujours monté
<div className={isChatRoute ? "hidden" : ""}>
  {children}  // Autres routes
</div>
```

Fichier: `pen-frontend/src/components/chat/PersistentChatLayer.tsx`

### Z-index et Stacking Contexts

Les modales doivent être rendues au même niveau dans le DOM pour éviter les conflits:

```typescript
// ❌ MAUVAIS - Modal dans un composant enfant (stacking context isolé)
<ParentComponent>
  <Modal zIndex={9999} />  // Peut être masqué par un autre stacking context
</ParentComponent>

// ✅ BON - Modales au niveau Layout
<Layout>
  <Content />
  <HistorySidebar zIndex={70} />  // Même niveau
  <WikipediaModal zIndex={9999} />  // Même niveau
</Layout>
```

### SWR avec Optimistic Updates

Pattern pour les listes avec delete/rename:

```typescript
const deleteItem = async (id: string) => {
  const previousData = data;
  // Optimistic: retirer immédiatement
  mutate({ items: items.filter((i) => i.id !== id) }, false);
  try {
    await fetch(`/api/items/${id}`, { method: "DELETE" });
    mutate(); // Revalider
  } catch {
    mutate(previousData, false); // Rollback
  }
};
```

Fichier exemple: `pen-frontend/src/hooks/useConversationHistory.ts`

## UI Components - Notion Design System

**TOUJOURS utiliser les composants Notion\* pour les formulaires et l'UI.**

Ces composants garantissent une cohérence visuelle avec le design Notion-like de l'application.
Fichiers: `pen-frontend/src/components/ui/Notion*.tsx`

### Composants disponibles

| Composant           | Usage                      | Import                              |
| ------------------- | -------------------------- | ----------------------------------- |
| `NotionButton`      | Boutons d'action           | `@/components/ui/NotionButton`      |
| `NotionCard`        | Containers/cartes          | `@/components/ui/NotionCard`        |
| `NotionCheckbox`    | Cases à cocher             | `@/components/ui/NotionCheckbox`    |
| `NotionInput`       | Champs texte               | `@/components/ui/NotionInput`       |
| `NotionNumberInput` | Champs numériques avec +/- | `@/components/ui/NotionNumberInput` |
| `NotionSelect`      | Menus déroulants           | `@/components/ui/NotionSelect`      |

### NotionButton

```typescript
import { NotionButton } from "@/components/ui/NotionButton";

// Variants: 'primary' | 'secondary' | 'ghost' | 'danger'
// Sizes: 'sm' | 'md' | 'lg'
<NotionButton
  variant="primary"
  size="md"
  loading={isLoading}
  leftIcon={<Save />}
  fullWidth
>
  Sauvegarder
</NotionButton>;
```

### NotionCard

```typescript
import { NotionCard } from "@/components/ui/NotionCard";

// Variants: 'default' | 'outlined' | 'minimal'
<NotionCard variant="default" hover onClick={handleClick}>
  <div className="p-4">Contenu</div>
</NotionCard>;
```

### NotionCheckbox

```typescript
import { NotionCheckbox } from "@/components/ui/NotionCheckbox";

// Sizes: 'sm' | 'md' | 'lg'
<NotionCheckbox
  checked={isChecked}
  onChange={(e) => setIsChecked(e.target.checked)}
  label="Activer les notifications"
  description="Recevoir des alertes par email"
  size="md"
/>;
```

### NotionInput

```typescript
import { NotionInput } from "@/components/ui/NotionInput";

<NotionInput
  label="Nom du projet"
  placeholder="Mon projet..."
  value={name}
  onChange={(e) => setName(e.target.value)}
  error={errors.name}
  fullWidth
/>;
```

### NotionNumberInput

```typescript
import { NotionNumberInput } from "@/components/ui/NotionNumberInput";

<NotionNumberInput
  label="Nombre de questions"
  value={count}
  onChange={setCount}
  min={1}
  max={50}
  step={1}
  error={errors.count}
/>;
```

### NotionSelect

```typescript
import { NotionSelect } from "@/components/ui/NotionSelect";

<NotionSelect
  label="Difficulté"
  options={[
    { value: "easy", label: "Facile" },
    { value: "medium", label: "Moyen" },
    { value: "hard", label: "Difficile" },
  ]}
  value={difficulty}
  onChange={setDifficulty}
  placeholder="Choisir..."
  error={errors.difficulty}
/>;
```

### Règle d'utilisation

```typescript
// ❌ MAUVAIS - Composants HTML natifs ou autres librairies
<input type="text" className="..." />
<button className="...">Click</button>
<select>...</select>
<input type="checkbox" />

// ✅ BON - Composants Notion* cohérents
<NotionInput label="..." />
<NotionButton variant="primary">Click</NotionButton>
<NotionSelect options={...} />
<NotionCheckbox label="..." />
```

**Exceptions autorisées:**

- Composants Shadcn/Radix pour des cas spécifiques (Dialog, Tooltip, DropdownMenu)
- Composants Mantine pour des fonctionnalités avancées non couvertes
- Inputs spéciaux de BlockNote pour l'éditeur

## Chat System Architecture (Vercel AI SDK)

### Structure

```
Layout.tsx
├── PersistentChatLayer (toujours monté, survit aux changements de route)
│   ├── ChatHeader (boutons +, History)
│   └── PennoteChat (key={resetKey} pour reset)
├── HistorySidebar (z-[70], rendu au niveau Layout)
└── Autres routes (cachées quand sur /chat)
```

### Key Files

```
pen-frontend/src/
├── components/chat/
│   ├── PersistentChatLayer.tsx  → Keeps chat mounted across routes
│   ├── PennoteChat.tsx          → Main chat (useChat from @ai-sdk/react)
│   ├── PennoteChatMessages.tsx  → Message rendering with tool invocations
│   ├── PennoteChatInput.tsx     → Input with RAG sources selector
│   ├── ChatHeader.tsx           → Header with actions
│   ├── artifacts/PageArtifact.tsx → Created page display
│   └── history/                 → Conversation history sidebar
├── hooks/
│   ├── usePennoteChat.ts        → useChat wrapper with Pennote config
│   └── useConversationHistory.ts → SWR for conversation list
└── services/conversations.ts    → API client for persistence
```

### Frontend-Backend Flow

```
usePennoteChat (useChat) → POST /api/agent/chat → PennoteAgent.runAgent()
                                                         ↓
                        ← SSE stream (toUIMessageStreamResponse) ←
                                                         ↓
                                               onFinish → save to DB
```

## Context Recovery After Compacts

**IMPORTANT: When context becomes stale after conversation compacts, check Linear issues to recover context.**

After long sessions, the conversation may be summarized and context can be lost. To maintain continuity and quality:

1. **Check Linear issues** to understand current work:

   ```
   - Use mcp__linear__list_issues to see In Progress issues
   - Use mcp__linear__get_issue to get full details
   - Check the project context (Quiz Intelligence, etc.)
   ```

2. **Verify implementation standards** are maintained:

   - Security best practices (input validation, auth checks)
   - Performance optimization (caching, lazy loading, pagination)
   - Error handling (proper try/catch, user-friendly messages)
   - Type safety (strict TypeScript, no `any`)

3. **Commit regularly** between issues to avoid losing work

4. **Check test scripts** to validate implementations work correctly

This is a professional SaaS - maintain high quality standards throughout all implementations.

## Notes & Rappels Importants

### Règles de commit

- ⛔ **JAMAIS** de signature Claude Code dans les commits
- ⛔ **JAMAIS** de `--no-verify` sauf demande explicite
- Utiliser des messages de commit concis et descriptifs

### Langue et texte

- **UI/Toasts/Labels** → Français
- **Prompts AI/LLM** → Anglais + format XML
- **Code/Comments** → Anglais acceptable

### Validation

- ESLint errors may be false positives - ignore if code compiles
- Toujours `npx tsc --noEmit` après modifications

### Tests

- Frontend: Playwright (`npm run test` in pen-frontend)
- Backend: Jest + load testing (`test:load:*`, `test:scalability`)

### Modules

- Both frontend and backend use ES modules (`"type": "module"`)

### Ce que je dois TOUJOURS vérifier avant de coder

```
┌─────────────────────────────────────────────────────────┐
│  AVANT D'ÉCRIRE DU CODE, VÉRIFIE:                       │
│                                                          │
│  1. Est-ce que j'utilise VITE_API_URL pour les fetch?   │ │
│  3. Est-ce que j'utilise les composants Notion*?        │
│  4. Est-ce que mes fichiers font < 300 lignes?          │
│  5. Est-ce que je sépare types/utils/hooks/components?  │
│  6. Est-ce que le texte UI est en français?             │
│  7. Est-ce que j'évite `any` dans TypeScript?           │
└─────────────────────────────────────────────────────────┘
```

## Migration Status

The Vercel AI SDK v5 migration is **✅ COMPLETE**. See `docs/MIGRATION_VERCEL_AI_SDK.md` for:

- Detailed checklist with completed/remaining items
- Files that were deleted (old FunctionCalling system)
- New agent architecture documentation

## Recent Backend Updates (Dec 2024)

- **Quiz Preprocessor Agent** - Détermination automatique des paramètres quiz via IA
- **Quiz Intelligence Pipeline** - Extraction concepts, clustering K-means/DBSCAN, scoring
- **Wikipedia RAG Tools** - Indexation et recherche sémantique Wikipedia
- **Gemini 3 Flash** - Support thinking mode pour génération avancée
- **DeepSeek Provider** - Alternative AI provider intégrée
- **Correction Enrichment** - Références sources dans les corrections quiz
- **PageConcepts Model** - Stockage des concepts extraits par page (Prisma)
- **Target Grade** - Note cible dans statistiques avancées quiz
- **ragContext Cache Key** - Invalidation cache améliorée
- **Cascaded Personalization** - Système niveau éducatif en cascade
- **Quiz Title Generation** - Génération automatique de titres via IA
- **Higher Education Level** - Support niveau supérieur dans quiz params
