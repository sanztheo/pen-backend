> **Translations:** [English](README.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Português](README.pt.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [العربية](README.ar.md)

# Desplegar el backend de Pen en Railway en un repositorio separado

Esta guía explica cómo extraer la carpeta `backend/` del monorepo `pen-saas` a un repositorio Git autónomo para conectarlo a Railway, manteniendo el frontend en Vercel.

## 1. Requisitos previos

- Acceso de escritura al repositorio monorepo `pen-saas`.
- Git ≥ 2.30 (para `git subtree`) y Node.js 18+.
- Una cuenta de Railway con permisos para crear un proyecto + servicios (PostgreSQL/Redis).
- Un repositorio Git remoto vacío (GitHub, GitLab, …) destinado únicamente al backend.

## 2. Extraer el backend a un nuevo repositorio

> 🎯 Objetivo: obtener un historial de Git limpio que contenga solo la carpeta `backend/` y sus subdirectorios (`prisma/`, `src/`, `scripts/`, etc.).

### Pasos rápidos con `git subtree`

1. Desde la raíz del monorepo, crea una rama temporal que contenga solo el backend:
   ```bash
   git subtree split --prefix=backend -b backend-only
   ```
2. Inicializa un nuevo repositorio local a partir de esa rama:
   ```bash
   git clone . ../pen-backend --branch backend-only --single-branch
   cd ../pen-backend
   ```
3. Limpia las referencias innecesarias y conecta el repositorio remoto final:
   ```bash
   git remote remove origin
   git remote add origin git@github.com:TU-ORG/pen-backend.git
   git push -u origin backend-only:main
   ```
4. Elimina la rama temporal del monorepo si ya no la necesitas:
   ```bash
   cd ../pen-saas
   git branch -D backend-only
   ```

### Alternativa: copia manual (sin historial)

1. Crea una carpeta vacía e inicializa Git:
   ```bash
   mkdir ../pen-backend && cp -R backend/* ../pen-backend
   cd ../pen-backend
   git init
   ```
2. Añade los archivos esenciales ubicados en la raíz de la carpeta backend:
   - `package.json` / `package-lock.json`
   - `tsconfig.json`
   - `Dockerfile.dev`
   - `prisma/`, `scripts/`, `src/`
3. Crea un `.gitignore` mínimo:
   ```bash
   cat <<'EOT' > .gitignore
   node_modules
   dist
   .env
   .env.*
   EOT
   ```
4. Confirma y empuja al nuevo repositorio remoto:
   ```bash
   git add .
   git commit -m "Initial backend export"
   git remote add origin git@github.com:TU-ORG/pen-backend.git
   git push -u origin main
   ```

## 3. Preparar el repositorio backend para Railway

1. Verifica que `package.json` exponga correctamente los scripts de build y arranque que utiliza Railway:
   - `npm run build` → `tsc` (genera `dist/`).
   - `npm run start` → `node dist/index.js`.
2. Añade un archivo `README` (este documento) y una descripción del proyecto si es necesario.
3. Ejecuta localmente:
   ```bash
   npm install
   npx prisma generate
   npm run build
   ```
   Esto garantiza que las dependencias y el transpilador TypeScript funcionan antes del primer despliegue.

## 4. Variables de entorno indispensables

Crea un archivo `.env` local (y configura las variables en Railway). Las más importantes:

| Variable | Función |
| --- | --- |
| `DATABASE_URL` | URL principal de PostgreSQL (se recomienda Railway Postgres). |
| `EMBEDDING_DATABASE_URL` | Conexión a la base de datos vectorial / segundo Postgres (si se utiliza). |
| `REDIS_URL` | Instancia Redis para caché, limitadores y WebSocket. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Acceso a las generaciones de IA. |
| `OPENAI_DASHBOARD_MODEL` | Modelo preferido para el panel de control (opcional pero compatible en el código). |
| `OPENAI_MAX_REQUESTS_PER_HOUR`, `OPENAI_MAX_TOKENS_PER_HOUR`, `OPENAI_MAX_COST_PER_HOUR` | Límites de cuota de IA (valores por defecto en el código). |
| `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | Autenticación con Clerk. |
| `CLIENT_URL` | URL pública del frontend (Vercel) para configurar CORS. |
| `TAVILY_API_KEY` | Búsqueda externa para el asistente de IA (opcional pero recomendado). |
| `GEMINI_API_KEY` / `GEMINI_THINKING_MODEL` | Soporte para Google Gemini (opcional). |
| `ASSISTANT_ID`, `ASSISTANT_ID_DOCUMENTS`, `ASSISTANT_ID_2` | Identificadores de OpenAI Assistant si usas tus propios IDs. |
| `RAG_EMBEDDING_CONCURRENCY`, `RAG_DB_BATCH_SIZE` | Parámetros de ingesta RAG (valores por defecto incluidos). |

> ℹ️ Railway oculta automáticamente las variables sensibles. Recuerda sincronizar los mismos valores en Vercel cuando el frontend los necesite (por ejemplo, `VITE_API_URL`).

## 5. Despliegue en Railway

1. **Crear el proyecto Railway**:
   - Añade un servicio PostgreSQL y, si es necesario, un servicio Redis.
   - Anota las URLs de conexión que muestra Railway (botón «Variables»).
2. **Añadir el servicio Node.js**:
   - Elige «Deploy from GitHub» y selecciona el repositorio del backend.
   - Deja que Railway detecte el build:
     - Install command: `npm install`
     - Build command: `npm run build`
     - Start command: `npm run start`
   - Añade las variables de entorno listadas arriba.
3. **Migraciones de Prisma**:
   - En el terminal de Railway, ejecuta:
     ```bash
     railway run npx prisma migrate deploy
     ```
     o, para empujar el esquema sin migración, `railway run npm run db:push`.
4. **Pruebas de salud**:
   - Asegúrate de que el servicio responde en el puerto asignado (Railway proporciona `PORT`). El código del backend ya lee `process.env.PORT || 3001`, no hay nada que cambiar.
5. **Dominios personalizados** (opcional):
   - Añade un dominio personalizado en Railway y actualiza la variable `CLIENT_URL` del backend y `VITE_API_URL` del frontend.

## 6. Conectar el frontend de Vercel

En Vercel, configura las siguientes variables:

- `VITE_API_URL`: `https://<tu-app>.railway.app` (o tu dominio personalizado).
- `VITE_OPENAI_BASE_URL` (opcional): `https://<tu-app>.railway.app/api/ai/proxy`.

A continuación, vuelve a desplegar el frontend para propagar la nueva URL del backend.

## 7. Mantener el backend sincronizado

- Sigue desarrollando el backend en el nuevo repositorio. Si quieres traer cambios al monorepo, puedes usar `git subtree pull` o volver a copiar las modificaciones.
- Documenta claramente en cada repositorio dónde se encuentra la fuente de verdad.
- Considera implementar un flujo de CI (GitHub Actions) para ejecutar `npm run build` y `npm run test` en cada PR antes del despliegue.

---

Siguiendo estos pasos, tu backend Node.js/Express (TypeScript) queda aislado en un repositorio autónomo, listo para desplegarse en Railway, mientras que el frontend puede seguir alojado en Vercel con un `VITE_API_URL` que apunte a la API de Railway.
