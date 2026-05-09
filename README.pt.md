> **Translations:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

# Implantar o backend Pen no Railway num repositório separado

Este guia explica como extrair a pasta `backend/` do monorepo `pen-saas` para um repositório Git autónomo, de forma a ligá-lo ao Railway, mantendo o frontend no Vercel.

## 1. Pré-requisitos

- Acesso de escrita ao repositório monorepo `pen-saas`.
- Git ≥ 2.30 (para `git subtree`) e Node.js 18+.
- Uma conta Railway com permissão para criar um projeto + serviços (PostgreSQL/Redis).
- Um repositório Git remoto vazio (GitHub, GitLab, …) destinado apenas ao backend.

## 2. Extrair o backend para um novo repositório

> 🎯 Objetivo: obter um histórico Git limpo contendo apenas a pasta `backend/` e a sua sub-árvore (`prisma/`, `src/`, `scripts/`, etc.).

### Passos rápidos com `git subtree`

1. A partir da raiz do monorepo, crie um branch temporário contendo apenas o backend:
   ```bash
   git subtree split --prefix=backend -b backend-only
   ```
2. Inicialize um novo repositório local a partir desse branch:
   ```bash
   git clone . ../pen-backend --branch backend-only --single-branch
   cd ../pen-backend
   ```
3. Limpe as referências desnecessárias e, em seguida, ligue o repositório remoto final:
   ```bash
   git remote remove origin
   git remote add origin git@github.com:SUA-ORG/pen-backend.git
   git push -u origin backend-only:main
   ```
4. Apague o branch temporário no monorepo se já não precisar dele:
   ```bash
   cd ../pen-saas
   git branch -D backend-only
   ```

### Alternativa: cópia manual (sem histórico)

1. Crie uma pasta vazia e inicialize o Git:
   ```bash
   mkdir ../pen-backend && cp -R backend/* ../pen-backend
   cd ../pen-backend
   git init
   ```
2. Adicione os ficheiros essenciais localizados na raiz da pasta backend:
   - `package.json` / `package-lock.json`
   - `tsconfig.json`
   - `Dockerfile.dev`
   - `prisma/`, `scripts/`, `src/`
3. Crie um `.gitignore` mínimo:
   ```bash
   cat <<'EOT' > .gitignore
   node_modules
   dist
   .env
   .env.*
   EOT
   ```
4. Faça commit e push para o novo repositório remoto:
   ```bash
   git add .
   git commit -m "Initial backend export"
   git remote add origin git@github.com:SUA-ORG/pen-backend.git
   git push -u origin main
   ```

## 3. Preparar o repositório backend para o Railway

1. Verifique se o `package.json` expõe corretamente os scripts de build e arranque utilizados pelo Railway:
   - `npm run build` → `tsc` (gera `dist/`).
   - `npm run start` → `node dist/index.js`.
2. Adicione um ficheiro `README` (este documento) e uma descrição do projeto, se necessário.
3. Execute localmente:
   ```bash
   npm install
   npx prisma generate
   npm run build
   ```
   Isto garante que as dependências e o transpilador TypeScript funcionam antes do primeiro deploy.

## 4. Variáveis de ambiente indispensáveis

Crie um ficheiro `.env` localmente (e preencha as variáveis no Railway). As mais importantes:

| Variável | Função |
| --- | --- |
| `DATABASE_URL` | URL principal de PostgreSQL (Railway Postgres recomendado). |
| `EMBEDDING_DATABASE_URL` | Ligação à base de dados vetorial / segundo Postgres (se utilizado). |
| `REDIS_URL` | Instância Redis para cache, limitadores e WebSocket. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Acesso às gerações de IA. |
| `OPENAI_DASHBOARD_MODEL` | Modelo preferencial para o dashboard (opcional mas suportado no código). |
| `OPENAI_MAX_REQUESTS_PER_HOUR`, `OPENAI_MAX_TOKENS_PER_HOUR`, `OPENAI_MAX_COST_PER_HOUR` | Limites de quota de IA (valores por defeito presentes no código). |
| `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | Autenticação Clerk. |
| `CLIENT_URL` | URL pública do frontend (Vercel) para configurar o CORS. |
| `TAVILY_API_KEY` | Pesquisa externa para o assistente de IA (opcional mas recomendado). |
| `GEMINI_API_KEY` / `GEMINI_THINKING_MODEL` | Suporte para Google Gemini (opcional). |
| `ASSISTANT_ID`, `ASSISTANT_ID_DOCUMENTS`, `ASSISTANT_ID_2` | Identificadores OpenAI Assistant se usar os seus próprios IDs. |
| `RAG_EMBEDDING_CONCURRENCY`, `RAG_DB_BATCH_SIZE` | Parâmetros de ingestão RAG (valores por defeito incluídos). |

> ℹ️ O Railway oculta automaticamente as variáveis sensíveis. Lembre-se de sincronizar os mesmos valores no Vercel quando o frontend deles necessite (por exemplo, `VITE_API_URL`).

## 5. Deploy no Railway

1. **Criar o projeto Railway**:
   - Adicione um serviço PostgreSQL e, se necessário, um serviço Redis.
   - Anote as URLs de ligação expostas pelo Railway (botão «Variables»).
2. **Adicionar o serviço Node.js**:
   - Escolha «Deploy from GitHub» e selecione o repositório do backend.
   - Deixe o Railway detetar a build:
     - Install command: `npm install`
     - Build command: `npm run build`
     - Start command: `npm run start`
   - Adicione as variáveis de ambiente listadas acima.
3. **Migrações do Prisma**:
   - No terminal Railway, execute:
     ```bash
     railway run npx prisma migrate deploy
     ```
     ou, para fazer push do esquema sem migração, `railway run npm run db:push`.
4. **Testes de saúde**:
   - Certifique-se de que o serviço responde na porta atribuída (o Railway fornece `PORT`). O código do backend já lê `process.env.PORT || 3001`, não há nada para alterar.
5. **Domínios personalizados** (opcional):
   - Adicione um custom domain no Railway e atualize a variável `CLIENT_URL` no backend e `VITE_API_URL` no frontend.

## 6. Ligar o frontend Vercel

No Vercel, configure as seguintes variáveis:

- `VITE_API_URL`: `https://<a-sua-app>.railway.app` (ou o seu domínio personalizado).
- `VITE_OPENAI_BASE_URL` (opcional): `https://<a-sua-app>.railway.app/api/ai/proxy`.

Em seguida, faça novo deploy do frontend para propagar o novo URL do backend.

## 7. Manter o backend sincronizado

- Continue a desenvolver o backend no novo repositório. Se quiser trazer alterações de volta para o monorepo, pode usar `git subtree pull` ou copiar novamente as modificações.
- Documente claramente em cada repositório onde se encontra a fonte da verdade.
- Considere implementar um workflow CI (GitHub Actions) para executar `npm run build` e `npm run test` em cada PR antes do deploy.

---

Seguindo estes passos, o seu backend Node.js/Express (TypeScript) fica isolado num repositório autónomo, pronto a ser implantado no Railway, enquanto o frontend pode continuar a viver no Vercel com um `VITE_API_URL` apontando para a API Railway.
