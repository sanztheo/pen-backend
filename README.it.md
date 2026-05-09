> **Translations:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

# Distribuire il backend Pen su Railway in un repository separato

Questa guida spiega come estrarre la cartella `backend/` dal monorepo `pen-saas` in un repository Git autonomo per collegarlo a Railway, mantenendo il frontend su Vercel.

## 1. Prerequisiti

- Accesso in scrittura al repository monorepo `pen-saas`.
- Git ≥ 2.30 (per `git subtree`) e Node.js 18+.
- Un account Railway con i permessi per creare un progetto + servizi (PostgreSQL/Redis).
- Un repository Git remoto vuoto (GitHub, GitLab, …) destinato esclusivamente al backend.

## 2. Estrarre il backend in un nuovo repository

> 🎯 Obiettivo: ottenere una cronologia Git pulita contenente solo la cartella `backend/` e la sua sotto-struttura (`prisma/`, `src/`, `scripts/`, ecc.).

### Passi rapidi con `git subtree`

1. Dalla radice del monorepo, crea un branch temporaneo che contenga solo il backend:
   ```bash
   git subtree split --prefix=backend -b backend-only
   ```
2. Inizializza un nuovo repository locale a partire da questo branch:
   ```bash
   git clone . ../pen-backend --branch backend-only --single-branch
   cd ../pen-backend
   ```
3. Pulisci i riferimenti non necessari, poi collega il repository remoto definitivo:
   ```bash
   git remote remove origin
   git remote add origin git@github.com:LA-TUA-ORG/pen-backend.git
   git push -u origin backend-only:main
   ```
4. Elimina il branch temporaneo nel monorepo se non serve più:
   ```bash
   cd ../pen-saas
   git branch -D backend-only
   ```

### Alternativa: copia manuale (senza cronologia)

1. Crea una cartella vuota e inizializza Git:
   ```bash
   mkdir ../pen-backend && cp -R backend/* ../pen-backend
   cd ../pen-backend
   git init
   ```
2. Aggiungi i file essenziali presenti nella radice della cartella backend:
   - `package.json` / `package-lock.json`
   - `tsconfig.json`
   - `Dockerfile.dev`
   - `prisma/`, `scripts/`, `src/`
3. Crea un `.gitignore` minimale:
   ```bash
   cat <<'EOT' > .gitignore
   node_modules
   dist
   .env
   .env.*
   EOT
   ```
4. Esegui il commit e fai il push verso il nuovo repository remoto:
   ```bash
   git add .
   git commit -m "Initial backend export"
   git remote add origin git@github.com:LA-TUA-ORG/pen-backend.git
   git push -u origin main
   ```

## 3. Preparare il repository backend per Railway

1. Verifica che `package.json` esponga correttamente gli script di build e di avvio usati da Railway:
   - `npm run build` → `tsc` (genera `dist/`).
   - `npm run start` → `node dist/index.js`.
2. Aggiungi un file `README` (questo documento) e una descrizione del progetto se necessario.
3. Esegui in locale:
   ```bash
   npm install
   npx prisma generate
   npm run build
   ```
   Questo garantisce che le dipendenze e il transpiler TypeScript funzionino prima del primo deploy.

## 4. Variabili d’ambiente indispensabili

Crea un file `.env` localmente (e popola le variabili su Railway). Le più importanti:

| Variabile | Ruolo |
| --- | --- |
| `DATABASE_URL` | URL principale di PostgreSQL (Railway Postgres consigliato). |
| `EMBEDDING_DATABASE_URL` | Connessione al database vettoriale / secondo Postgres (se utilizzato). |
| `REDIS_URL` | Istanza Redis per cache, rate limiting e WebSocket. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Accesso alle generazioni AI. |
| `OPENAI_DASHBOARD_MODEL` | Modello preferito per la dashboard (opzionale ma supportato nel codice). |
| `OPENAI_MAX_REQUESTS_PER_HOUR`, `OPENAI_MAX_TOKENS_PER_HOUR`, `OPENAI_MAX_COST_PER_HOUR` | Limiti di quota AI (valori predefiniti nel codice). |
| `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | Autenticazione Clerk. |
| `CLIENT_URL` | URL pubblica del frontend (Vercel) per configurare CORS. |
| `TAVILY_API_KEY` | Ricerca esterna per l’assistente AI (opzionale ma consigliato). |
| `GEMINI_API_KEY` / `GEMINI_THINKING_MODEL` | Supporto Google Gemini (opzionale). |
| `ASSISTANT_ID`, `ASSISTANT_ID_DOCUMENTS`, `ASSISTANT_ID_2` | Identificatori OpenAI Assistant se usi i tuoi ID. |
| `RAG_EMBEDDING_CONCURRENCY`, `RAG_DB_BATCH_SIZE` | Parametri di ingestione RAG (valori predefiniti forniti). |

> ℹ️ Railway maschera automaticamente le variabili sensibili. Ricordati di sincronizzare gli stessi valori in Vercel quando il frontend ne ha bisogno (es. `VITE_API_URL`).

## 5. Deploy su Railway

1. **Creare il progetto Railway**:
   - Aggiungi un servizio PostgreSQL e, se necessario, un servizio Redis.
   - Annota le URL di connessione esposte da Railway (pulsante «Variables»).
2. **Aggiungere il servizio Node.js**:
   - Scegli «Deploy from GitHub» e seleziona il repository del backend.
   - Lascia che Railway rilevi la build:
     - Install command: `npm install`
     - Build command: `npm run build`
     - Start command: `npm run start`
   - Aggiungi le variabili d’ambiente elencate sopra.
3. **Migrazioni Prisma**:
   - Nel terminale Railway, esegui:
     ```bash
     railway run npx prisma migrate deploy
     ```
     oppure, per fare il push dello schema senza migrazione, `railway run npm run db:push`.
4. **Test di salute**:
   - Assicurati che il servizio risponda sulla porta assegnata (Railway fornisce `PORT`). Il codice del backend legge già `process.env.PORT || 3001`, non devi cambiare nulla.
5. **Domini personalizzati** (facoltativo):
   - Aggiungi un custom domain in Railway e aggiorna la variabile `CLIENT_URL` lato backend e `VITE_API_URL` lato frontend.

## 6. Collegare il frontend Vercel

In Vercel, configura le seguenti variabili:

- `VITE_API_URL`: `https://<la-tua-app>.railway.app` (o il tuo dominio personalizzato).
- `VITE_OPENAI_BASE_URL` (facoltativo): `https://<la-tua-app>.railway.app/api/ai/proxy`.

Quindi rifai il deploy del frontend per propagare la nuova URL del backend.

## 7. Mantenere il backend sincronizzato

- Continua a sviluppare il backend nel nuovo repository. Se vuoi riportare modifiche nel monorepo, puoi usare `git subtree pull` o ricopiare le modifiche.
- Documenta chiaramente in ciascun repository dove si trova la fonte di verità.
- Considera di mettere in piedi un workflow CI (GitHub Actions) per lanciare `npm run build` e `npm run test` su ogni PR prima del deploy.

---

Seguendo questi passi, il tuo backend Node.js/Express (TypeScript) è isolato in un repository autonomo, pronto a essere distribuito su Railway, mentre il frontend può continuare a vivere su Vercel con un `VITE_API_URL` che punta all’API Railway.
