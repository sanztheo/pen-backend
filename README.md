# Déployer le backend Pen sur Railway dans un dépôt séparé

Ce guide explique comment extraire le dossier `backend/` du monorepo `pen-saas` dans un dépôt Git autonome afin de le connecter à Railway, tout en gardant le frontend dans Vercel.

## 1. Prérequis

- Accès en écriture au dépôt monorepo `pen-saas`.
- Git ≥ 2.30 (pour `git subtree`) et Node.js 18+.
- Un compte Railway avec le droit de créer un projet + services (PostgreSQL/Redis).
- Un dépôt Git distant vide (GitHub, GitLab, …) destiné uniquement au backend.

## 2. Extraire le backend dans un nouveau dépôt

> 🎯 Objectif : obtenir un historique Git propre contenant seulement le dossier `backend/` et sa sous-arborescence (`prisma/`, `src/`, `scripts/`, etc.).

### Étapes rapides avec `git subtree`

1. Depuis la racine du monorepo, créez un branche temporaire contenant uniquement le backend :
   ```bash
   git subtree split --prefix=backend -b backend-only
   ```
2. Initialisez un nouveau dépôt local à partir de cette branche :
   ```bash
   git clone . ../pen-backend --branch backend-only --single-branch
   cd ../pen-backend
   ```
3. Nettoyez les références inutiles, puis connectez le dépôt distant final :
   ```bash
   git remote remove origin
   git remote add origin git@github.com:VOTRE-ORG/pen-backend.git
   git push -u origin backend-only:main
   ```
4. Supprimez la branche temporaire dans le monorepo si vous n’en avez plus besoin :
   ```bash
   cd ../pen-saas
   git branch -D backend-only
   ```

### Alternative : copie manuelle (sans historique)

1. Créez un dossier vide et initialisez Git :
   ```bash
   mkdir ../pen-backend && cp -R backend/* ../pen-backend
   cd ../pen-backend
   git init
   ```
2. Ajoutez les fichiers essentiels situés à la racine du dossier backend :
   - `package.json` / `package-lock.json`
   - `tsconfig.json`
   - `Dockerfile.dev`
   - `prisma/`, `scripts/`, `src/`
3. Créez un `.gitignore` minimal :
   ```bash
   cat <<'EOT' > .gitignore
   node_modules
   dist
   .env
   .env.*
   EOT
   ```
4. Commitez et poussez vers le nouveau dépôt distant :
   ```bash
   git add .
   git commit -m "Initial backend export"
   git remote add origin git@github.com:VOTRE-ORG/pen-backend.git
   git push -u origin main
   ```

## 3. Préparer le dépôt backend pour Railway

1. Vérifiez que `package.json` expose bien les scripts de build et de démarrage utilisés par Railway :
   - `npm run build` → `tsc` (génère `dist/`).
   - `npm run start` → `node dist/index.js`.
2. Ajoutez un fichier `README` (ce document) et une description du projet si besoin.
3. Exécutez localement :
   ```bash
   npm install
   npx prisma generate
   npm run build
   ```
   Cela garantit que les dépendances et le transpileur TypeScript fonctionnent avant le premier déploiement.

## 4. Variables d’environnement indispensables

Créez un fichier `.env` localement (et renseignez les variables sur Railway). Les plus importantes :

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | URL PostgreSQL principale (Railway Postgres recommandé). |
| `EMBEDDING_DATABASE_URL` | Connexion à la base vectorielle / second Postgres (si utilisé). |
| `REDIS_URL` | Instance Redis pour cache, limites et WebSocket. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Accès aux générations IA. |
| `OPENAI_DASHBOARD_MODEL` | Modèle privilégié pour le tableau de bord (optionnel mais pris en charge dans le code). |
| `OPENAI_MAX_REQUESTS_PER_HOUR`, `OPENAI_MAX_TOKENS_PER_HOUR`, `OPENAI_MAX_COST_PER_HOUR` | Limites de quota IA (défaut présent dans le code). |
| `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | Authentification Clerk. |
| `CLIENT_URL` | URL publique du frontend (Vercel) pour configurer CORS. |
| `TAVILY_API_KEY` | Recherche externe pour l’assistant IA (facultatif mais recommandé). |
| `GEMINI_API_KEY` / `GEMINI_THINKING_MODEL` | Support Google Gemini (optionnel). |
| `ASSISTANT_ID`, `ASSISTANT_ID_DOCUMENTS`, `ASSISTANT_ID_2` | Identifiants OpenAI Assistant si vous utilisez vos propres IDs. |
| `RAG_EMBEDDING_CONCURRENCY`, `RAG_DB_BATCH_SIZE` | Paramètres d’ingestion RAG (valeurs par défaut fournies). |

> ℹ️ Railway masque automatiquement les variables sensibles. Pensez à synchroniser les mêmes valeurs dans Vercel lorsque le frontend en a besoin (ex. `VITE_API_URL`).

## 5. Déploiement sur Railway

1. **Créer le projet Railway** :
   - Ajoutez un service PostgreSQL et, si nécessaire, un service Redis.
   - Notez les URLs de connexion exposées par Railway (bouton « Variables »).
2. **Ajouter le service Node.js** :
   - Choisissez « Deploy from GitHub » et sélectionnez le dépôt backend.
   - Laissez Railway détecter le build :
     - Install command : `npm install`
     - Build command : `npm run build`
     - Start command : `npm run start`
   - Ajoutez les variables d’environnement listées ci-dessus.
3. **Migrations Prisma** :
   - Dans le terminal Railway, exécutez :
     ```bash
     railway run npx prisma migrate deploy
     ```
     ou, pour pousser le schéma sans migration, `railway run npm run db:push`.
4. **Tests de santé** :
   - Assurez-vous que le service répond sur le port assigné (Railway fournit `PORT`). Le code backend lit déjà `process.env.PORT || 3001`, vous n’avez rien à changer.
5. **Domaines personnalisés** (facultatif) :
   - Ajoutez un custom domain dans Railway et mettez à jour la variable `CLIENT_URL` côté backend + `VITE_API_URL` côté frontend.

## 6. Brancher le frontend Vercel

Dans Vercel, configurez les variables suivantes :

- `VITE_API_URL` : `https://<votre-app>.railway.app` (ou votre domaine custom).
- `VITE_OPENAI_BASE_URL` (facultatif) : `https://<votre-app>.railway.app/api/ai/proxy`.

Redéployez ensuite le frontend pour propager la nouvelle URL du backend.

## 7. Maintenir le backend synchronisé

- Continuez à développer le backend dans le nouveau dépôt. Si vous souhaitez rapatrier des changements vers le monorepo, vous pouvez utiliser `git subtree pull` ou re-copier les modifications.
- Documentez clairement dans chaque dépôt où se trouve la source de vérité.
- Pensez à mettre en place un workflow CI (GitHub Actions) pour lancer `npm run build` et `npm run test` sur chaque PR avant déploiement.

---

En suivant ces étapes, votre backend Node.js/Express (TypeScript) est isolé dans un dépôt autonome, prêt à être déployé sur Railway, tandis que le frontend peut continuer à vivre dans Vercel avec un `VITE_API_URL` pointant vers l’API Railway.
