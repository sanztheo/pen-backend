> **Translations:** [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

# Pen-Backend in einem separaten Repository auf Railway deployen

Dieser Leitfaden beschreibt, wie der Ordner `backend/` aus dem Monorepo `pen-saas` in ein eigenständiges Git-Repository extrahiert wird, um es mit Railway zu verbinden, während das Frontend in Vercel verbleibt.

## 1. Voraussetzungen

- Schreibzugriff auf das Monorepo-Repository `pen-saas`.
- Git ≥ 2.30 (für `git subtree`) und Node.js 18+.
- Ein Railway-Konto mit Berechtigung zum Anlegen von Projekt + Services (PostgreSQL/Redis).
- Ein leeres Remote-Git-Repository (GitHub, GitLab, …) ausschließlich für das Backend.

## 2. Backend in ein neues Repository extrahieren

> 🎯 Ziel: ein sauberer Git-Verlauf, der nur den Ordner `backend/` und seine Unterstruktur (`prisma/`, `src/`, `scripts/`, etc.) enthält.

### Schnelle Schritte mit `git subtree`

1. Erstelle aus dem Monorepo-Stammverzeichnis einen temporären Branch, der nur das Backend enthält:
   ```bash
   git subtree split --prefix=backend -b backend-only
   ```
2. Initialisiere ein neues lokales Repository aus diesem Branch:
   ```bash
   git clone . ../pen-backend --branch backend-only --single-branch
   cd ../pen-backend
   ```
3. Bereinige nicht benötigte Referenzen und verbinde das endgültige Remote-Repository:
   ```bash
   git remote remove origin
   git remote add origin git@github.com:DEINE-ORG/pen-backend.git
   git push -u origin backend-only:main
   ```
4. Lösche den temporären Branch im Monorepo, falls nicht mehr benötigt:
   ```bash
   cd ../pen-saas
   git branch -D backend-only
   ```

### Alternative: manuelles Kopieren (ohne Verlauf)

1. Erstelle einen leeren Ordner und initialisiere Git:
   ```bash
   mkdir ../pen-backend && cp -R backend/* ../pen-backend
   cd ../pen-backend
   git init
   ```
2. Füge die wichtigsten Dateien aus dem Stammverzeichnis des Backend-Ordners hinzu:
   - `package.json` / `package-lock.json`
   - `tsconfig.json`
   - `Dockerfile.dev`
   - `prisma/`, `scripts/`, `src/`
3. Lege eine minimale `.gitignore` an:
   ```bash
   cat <<'EOT' > .gitignore
   node_modules
   dist
   .env
   .env.*
   EOT
   ```
4. Committe und pushe in das neue Remote-Repository:
   ```bash
   git add .
   git commit -m "Initial backend export"
   git remote add origin git@github.com:DEINE-ORG/pen-backend.git
   git push -u origin main
   ```

## 3. Backend-Repository für Railway vorbereiten

1. Stelle sicher, dass `package.json` die von Railway verwendeten Build- und Start-Skripte exponiert:
   - `npm run build` → `tsc` (erzeugt `dist/`).
   - `npm run start` → `node dist/index.js`.
2. Füge bei Bedarf eine `README`-Datei (dieses Dokument) und eine Projektbeschreibung hinzu.
3. Lokal ausführen:
   ```bash
   npm install
   npx prisma generate
   npm run build
   ```
   So stellst du sicher, dass Abhängigkeiten und der TypeScript-Transpiler vor dem ersten Deployment funktionieren.

## 4. Unverzichtbare Umgebungsvariablen

Erstelle lokal eine `.env`-Datei (und trage die Variablen in Railway ein). Die wichtigsten:

| Variable | Zweck |
| --- | --- |
| `DATABASE_URL` | Haupt-PostgreSQL-URL (Railway Postgres empfohlen). |
| `EMBEDDING_DATABASE_URL` | Verbindung zur Vektor-Datenbank / zweiten Postgres-Instanz (falls genutzt). |
| `REDIS_URL` | Redis-Instanz für Cache, Limits und WebSocket. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Zugriff auf KI-Generierungen. |
| `OPENAI_DASHBOARD_MODEL` | Bevorzugtes Modell für das Dashboard (optional, im Code unterstützt). |
| `OPENAI_MAX_REQUESTS_PER_HOUR`, `OPENAI_MAX_TOKENS_PER_HOUR`, `OPENAI_MAX_COST_PER_HOUR` | KI-Quotenlimits (Standardwerte im Code vorhanden). |
| `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | Authentifizierung mit Clerk. |
| `CLIENT_URL` | Öffentliche Frontend-URL (Vercel) zur CORS-Konfiguration. |
| `TAVILY_API_KEY` | Externe Suche für den KI-Assistenten (optional, aber empfohlen). |
| `GEMINI_API_KEY` / `GEMINI_THINKING_MODEL` | Unterstützung für Google Gemini (optional). |
| `ASSISTANT_ID`, `ASSISTANT_ID_DOCUMENTS`, `ASSISTANT_ID_2` | OpenAI-Assistant-IDs, falls eigene IDs verwendet werden. |
| `RAG_EMBEDDING_CONCURRENCY`, `RAG_DB_BATCH_SIZE` | RAG-Ingestion-Parameter (Standardwerte vorgegeben). |

> ℹ️ Railway maskiert sensible Variablen automatisch. Denke daran, dieselben Werte in Vercel zu synchronisieren, wenn das Frontend sie benötigt (z. B. `VITE_API_URL`).

## 5. Deployment auf Railway

1. **Railway-Projekt erstellen**:
   - Füge einen PostgreSQL-Service und ggf. einen Redis-Service hinzu.
   - Notiere die von Railway bereitgestellten Verbindungs-URLs (Button „Variables").
2. **Node.js-Service hinzufügen**:
   - Wähle „Deploy from GitHub" und das Backend-Repository.
   - Lass Railway den Build erkennen:
     - Install command: `npm install`
     - Build command: `npm run build`
     - Start command: `npm run start`
   - Füge die oben aufgeführten Umgebungsvariablen hinzu.
3. **Prisma-Migrationen**:
   - Führe im Railway-Terminal aus:
     ```bash
     railway run npx prisma migrate deploy
     ```
     Oder, um das Schema ohne Migration zu pushen, `railway run npm run db:push`.
4. **Health-Checks**:
   - Stelle sicher, dass der Service auf dem zugewiesenen Port antwortet (Railway stellt `PORT` bereit). Der Backend-Code liest bereits `process.env.PORT || 3001`, du musst nichts ändern.
5. **Eigene Domains** (optional):
   - Füge in Railway eine Custom Domain hinzu und aktualisiere `CLIENT_URL` im Backend und `VITE_API_URL` im Frontend.

## 6. Vercel-Frontend anbinden

Konfiguriere in Vercel folgende Variablen:

- `VITE_API_URL`: `https://<deine-app>.railway.app` (oder deine eigene Domain).
- `VITE_OPENAI_BASE_URL` (optional): `https://<deine-app>.railway.app/api/ai/proxy`.

Anschließend das Frontend neu deployen, um die neue Backend-URL zu propagieren.

## 7. Backend synchron halten

- Entwickle das Backend weiter im neuen Repository. Falls Änderungen ins Monorepo zurückfließen sollen, kannst du `git subtree pull` verwenden oder die Änderungen erneut kopieren.
- Dokumentiere in jedem Repository deutlich, wo die Source of Truth liegt.
- Erwäge einen CI-Workflow (GitHub Actions), der bei jedem PR vor dem Deployment `npm run build` und `npm run test` ausführt.

---

Nach diesen Schritten ist dein Node.js/Express-Backend (TypeScript) in einem eigenständigen Repository isoliert, bereit für das Deployment auf Railway, während das Frontend weiterhin in Vercel mit einem `VITE_API_URL`, der auf die Railway-API zeigt, betrieben werden kann.
