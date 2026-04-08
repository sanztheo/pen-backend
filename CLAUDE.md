# CLAUDE.md - Backend

Instructions specifiques pour pen-backend. Documentation complete dans `/docs/`.

---

## Regles Strictes Backend

| Interdit | Faire a la place |
|----------|------------------|
| `process.env.X \|\| "default"` | `if (!process.env.X) throw new Error(...)` |
| `any` dans TypeScript | Types stricts ou `unknown` |
| `console.log()` | `console.log("[PREFIX]:", data)` |
| Fichier > 300 lignes | Separer en `types.ts`, `utils.ts` |
| `db:push --force-reset` en PROD | `db:migrate deploy` uniquement |
| Prompts AI en francais/markdown | Prompts XML en anglais |

---

## Commandes Essentielles

```bash
# Developpement
npm run dev              # Demarrer avec tsx watch
npm run build            # Prisma generate + tsc
npx tsc --noEmit         # Validation TypeScript (apres chaque modif)

# Base de donnees (2 schemas Prisma)
npm run db:generate      # Generer clients Prisma
npm run db:push          # Push schema (dev seulement)
npm run db:migrate       # Migrations (prod safe)
npm run db:studio        # Ouvrir Prisma Studio

# Tests
npm run test:load:light  # Load test leger
npm run test:scalability # Tests scalabilite
```

---

## Dual Prisma Schema

```bash
# Schema principal (users, workspaces, pages, quizzes)
prisma generate

# Schema embeddings avec pgvector pour RAG
prisma generate --schema=prisma/schema-embeddings.prisma
```

Le client embeddings est dans `node_modules/.prisma/client-embeddings`.

---

## Patterns Obligatoires

### SSE Streaming (Agent)
```typescript
result.pipeUIMessageStreamToResponse(res, { sendReasoning: true, onFinish });
result.consumeStream();  // TOUJOURS appeler apres pipe!
```

### Middleware Auth + Authz
```typescript
router.post("/chat", authenticateToken, requireAICredits({ cost: 1 }), handler);
```

### Tools avec Closure Context
```typescript
export function createTools(ctx: { userId: string; workspaceId: string }) {
  return { myTool: tool({ execute: async () => { /* ctx accessible */ } }) };
}
```

### Webhook Raw Body
```typescript
// AVANT express.json() pour signature HMAC
app.post("/webhooks/paddle", express.raw({ type: "application/json" }), handler);
```

---

## Documentation

**Lire la doc AVANT de coder une feature.**

| Document | Contenu |
|----------|---------|
| [docs/backend/api-reference.md](../docs/backend/api-reference.md) | Reference API (25+ endpoints) |
| [docs/backend/job-queue-bullmq.md](../docs/backend/job-queue-bullmq.md) | Jobs BullMQ |
| [docs/backend/ai-providers.md](../docs/backend/ai-providers.md) | Multi-provider AI |
| [docs/backend/error-handling.md](../docs/backend/error-handling.md) | Gestion erreurs, logging |
| [docs/backend/caching-redis.md](../docs/backend/caching-redis.md) | Cache Redis |
| [docs/backend/realtime-websocket.md](../docs/backend/realtime-websocket.md) | WebSocket + Yjs |
| [docs/features/quiz-intelligence.md](../docs/features/quiz-intelligence.md) | Pipeline intelligence quiz |
| [docs/security/security.md](../docs/security/security.md) | Audit securite |
| **[docs/admin/index.md](../docs/admin/index.md)** | Dashboard admin (architecture, API, roadmap) |
| **[docs/guides/infisical.md](../docs/guides/infisical.md)** | Gestion secrets Infisical |

---

## Variables d'Environnement

Secrets geres via **Infisical** (`/Backend` avec `--env=dev` ou `--env=prod`).

```bash
# Lancer avec injection des secrets
infisical run --env=dev --path=/Backend -- npm run dev
```

**Obligatoires:**
```
DATABASE_URL, EMBEDDING_DATABASE_URL, REDIS_URL
OPENAI_API_KEY, CLERK_SECRET_KEY, CLIENT_URL
```

**Optionnelles:**
```
GEMINI_API_KEY, DEEPSEEK_API_KEY, TAVILY_API_KEY
PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_ENVIRONMENT
```

Voir [docs/guides/infisical.md](../docs/guides/infisical.md) pour installation et commandes.

---

## Checklist Rapide

- [ ] `npx tsc --noEmit` passe
- [ ] Pas de fallback sur env vars
- [ ] SSE: `consumeStream()` appele
- [ ] Auth middleware avant handlers sensibles
- [ ] Logs avec prefix `[SERVICE_NAME]`
- [ ] Fichiers < 300 lignes
