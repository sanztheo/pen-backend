# Rapport d'audit sécurité

**Date :** 2025-11-09
**Projet :** pen-backend
**Auditeur :** Claude (AI Security Audit)
**Branche :** claude/security-audit-report-011CUx49ZUqu4p7ZURaNZDRU

---

## Résumé exécutif

- **Niveau global de risque** : **Moyen**
- **Points critiques à traiter en priorité** :
  1. **IDOR (Insecure Direct Object References)** dans les routes de recherche de pages permettant l'accès non autorisé aux données d'autres utilisateurs
  2. **Exposition d'informations sensibles** via les logs et messages d'erreur contenant des stack traces complètes
  3. **Contrôles d'accès incomplets** sur certaines routes API critiques
  4. **Absence de RBAC fonctionnel** malgré la présence du code de base
  5. **Validation des entrées utilisateur insuffisante** sur plusieurs endpoints

---

## Détails des vulnérabilités potentielles

### 1. IDOR - Accès non autorisé aux pages (routes de recherche)

- **Localisation** : `src/routes/page.ts:27-46` et `src/routes/page.ts:50-126`
- **Description** : Les routes `/pages/search` et `/pages/search-content` ne filtrent pas les résultats en fonction des workspaces accessibles par l'utilisateur authentifié. Un attaquant peut :
  - Rechercher des pages par titre sans restriction de workspace
  - Accéder au contenu de pages appartenant à d'autres utilisateurs
  - Énumérer les pages existantes dans toute la base de données

  ```typescript
  // Route vulnérable ligne 34-41
  const pages = await prisma.page.findMany({
    where: {
      isArchived: false,
      title: { contains: query, mode: 'insensitive' }
      // ❌ Manque: filtrage par workspace accessible
    },
    select: { id: true, title: true, projectId: true, workspaceId: true },
    take: 20
  });
  ```

- **Impact potentiel** :
  - Fuite de données confidentielles (titres et contenus de pages d'autres utilisateurs)
  - Violation de la confidentialité des données
  - Non-conformité RGPD (accès non autorisé à des données personnelles)

- **Probabilité estimée** : **Élevé** (facilement exploitable avec de simples requêtes API)

- **Gravité** : **Élevé**

- **Recommandation synthétique** : Ajouter systématiquement un filtre sur les workspaces accessibles :
  ```typescript
  where: {
    isArchived: false,
    title: { contains: query, mode: 'insensitive' },
    workspace: {
      OR: [
        { ownerId: req.user.id },
        { members: { some: { userId: req.user.id, isActive: true } } }
      ]
    }
  }
  ```

---

### 2. Absence de vérification des "magic bytes" pour l'upload de fichiers

- **Localisation** : `src/routes/upload.ts:22-29` et `src/services/upload/cloudinary.ts:40-61`
- **Description** : La validation des fichiers uploadés se base uniquement sur le type MIME déclaré dans la requête HTTP, sans vérifier les "magic bytes" (signature réelle du fichier). Un attaquant peut contourner cette protection en modifiant l'en-tête `Content-Type` et uploader des fichiers malveillants (scripts, exécutables) déguisés en images.

  ```typescript
  // Validation actuelle ligne 22-29 de upload.ts
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    // ❌ Validation basée uniquement sur file.mimetype (non fiable)
    if (UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES.includes(file.mimetype as any)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non supporté: ${file.mimetype}`));
    }
  }
  ```

- **Impact potentiel** :
  - Upload de fichiers malveillants (webshells, scripts XSS)
  - Stockage de malware sur Cloudinary
  - Potentielle exécution de code si les fichiers sont mal servis

- **Probabilité estimée** : **Moyen**

- **Gravité** : **Moyen**

- **Recommandation synthétique** : Implémenter une vérification des magic bytes avec une bibliothèque comme `file-type` avant d'accepter l'upload. Valider la signature réelle du fichier en plus du MIME type.

---

### 3. Exposition de stack traces et informations sensibles dans les logs

- **Localisation** : Multiples fichiers (ex: `src/index.ts:125-126`, `src/routes/page.ts:204-205`, etc.)
- **Description** : Les messages d'erreur incluent des stack traces complètes qui peuvent révéler :
  - La structure interne de l'application
  - Les chemins de fichiers du serveur
  - Les versions des dépendances
  - La logique métier sensible

  De plus, les logs console contiennent des informations qui pourraient aider un attaquant :
  ```typescript
  // Exemple ligne 125 de index.ts
  console.error('❌ Erreur non gérée:', error);
  // ❌ Affiche potentiellement des détails sensibles
  ```

- **Impact potentiel** :
  - Aide à la reconnaissance pour une attaque ciblée
  - Exposition de la structure interne
  - Violation des bonnes pratiques de sécurité

- **Probabilité estimée** : **Élevé**

- **Gravité** : **Faible à Moyen**

- **Recommandation synthétique** :
  - Implémenter un système de logging structuré (Winston, Pino)
  - Ne jamais exposer les stack traces aux clients en production
  - Utiliser des messages d'erreur génériques côté client
  - Logger les détails uniquement côté serveur de manière sécurisée

---

### 4. RBAC (Role-Based Access Control) non implémenté

- **Localisation** : `src/middlewares/auth.ts:101-109`
- **Description** : Le middleware `requireRole` existe mais n'est pas fonctionnel. Le TODO indique que la vérification des rôles n'est pas implémentée, ce qui signifie qu'il n'y a pas de contrôle granulaire des permissions selon les rôles utilisateur.

  ```typescript
  // Ligne 101-109
  export const requireRole = (roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
      }
      // TODO: Implémenter la vérification des rôles
      next(); // ❌ Bypass complet de la vérification des rôles
    };
  };
  ```

- **Impact potentiel** :
  - Élévation de privilèges potentielle
  - Accès à des fonctionnalités réservées à certains rôles
  - Manque de séparation des responsabilités

- **Probabilité estimée** : **Moyen** (dépend de l'utilisation effective du middleware)

- **Gravité** : **Moyen**

- **Recommandation synthétique** : Implémenter la logique de vérification des rôles en récupérant les métadonnées utilisateur depuis Clerk ou la base de données, et rejeter les requêtes si le rôle requis ne correspond pas.

---

### 5. Validation des entrées insuffisante sur certaines routes

- **Localisation** : Multiple (ex: `src/controllers/page.ts:325-326`, `src/routes/page.ts:29-30`)
- **Description** : Certaines routes utilisent `parseInt()` ou des conversions de types sans validation préalable via Zod ou autre schéma de validation strict. Cela peut mener à des comportements inattendus ou des injections de paramètres malveillants.

  ```typescript
  // Exemple ligne 29-30 de routes/page.ts
  const { q } = req.query as { q?: string };
  const query = (q || '').toString();
  // ❌ Pas de validation stricte de la longueur, caractères spéciaux, etc.
  ```

- **Impact potentiel** :
  - Injection de paramètres malveillants
  - DoS via requêtes coûteuses
  - Comportements inattendus de l'application

- **Probabilité estimée** : **Moyen**

- **Gravité** : **Faible à Moyen**

- **Recommandation synthétique** : Utiliser systématiquement Zod pour valider toutes les entrées utilisateur (query params, body, params) avec des contraintes strictes (longueur min/max, format, regex).

---

### 6. Absence de protection CSRF explicite

- **Localisation** : Configuration globale (absence dans `src/index.ts`)
- **Description** : L'application n'implémente pas de protection CSRF (Cross-Site Request Forgery) explicite via tokens ou double-submit cookies. Bien que l'utilisation de tokens Bearer limite ce risque pour les API, certains endpoints pourraient être vulnérables si des cookies de session sont utilisés ailleurs.

- **Impact potentiel** :
  - Exécution d'actions non autorisées au nom d'un utilisateur authentifié
  - Modification/suppression de données via requêtes forgées

- **Probabilité estimée** : **Faible à Moyen** (dépend de l'utilisation de cookies)

- **Gravité** : **Moyen**

- **Recommandation synthétique** : Implémenter une protection CSRF via `csurf` ou équivalent, surtout si l'application utilise des cookies pour l'authentification. Vérifier que tous les endpoints sensibles (POST/PUT/DELETE) valident un token CSRF.

---

### 7. Configuration CORS potentiellement permissive en développement

- **Localisation** : `src/utils/config.ts:36` et `src/index.ts:73-76`
- **Description** : En mode développement, la configuration CORS autorise plusieurs origines incluant `localhost` sur différents ports. Bien que pratique pour le développement, cela peut créer un risque si la configuration de production n'est pas correctement appliquée.

  ```typescript
  // Ligne 36 de config.ts
  clientUrl = 'http://localhost:5173,http://localhost:3000,http://localhost:4173,https://pen-frontend-ashy.vercel.app';
  // ⚠️ Multiple localhost + production domain mélangés
  ```

- **Impact potentiel** :
  - Attaques CORS si mauvaise configuration en production
  - Accès non autorisé depuis des origines malveillantes

- **Probabilité estimée** : **Faible** (nécessite une mauvaise configuration en prod)

- **Gravité** : **Faible à Moyen**

- **Recommandation synthétique** : Séparer clairement les configurations dev/prod. En production, autoriser uniquement les domaines strictement nécessaires. Utiliser des variables d'environnement distinctes pour chaque environnement.

---

### 8. Rate limiting WebSocket potentiellement contournable

- **Localisation** : `src/middlewares/websocketRateLimit.ts` et `src/index.ts:187-194, 343-348`
- **Description** : Le rate limiting WebSocket est basé sur l'IP et le comptage de messages. Cependant :
  - Les limites sont stockées en mémoire (Map), ce qui peut être contourné en redémarrant le serveur
  - Un attaquant peut ouvrir plusieurs connexions depuis différentes IPs (via proxy/VPN)
  - Pas de limite sur la taille totale des payloads cumulés

- **Impact potentiel** :
  - DoS via flood de connexions WebSocket
  - Épuisement des ressources serveur
  - Contournement des limites via rotation d'IP

- **Probabilité estimée** : **Moyen**

- **Gravité** : **Moyen**

- **Recommandation synthétique** : Migrer le stockage des limites WebSocket vers Redis pour persistance entre redémarrages. Implémenter une limite sur la taille cumulée des messages par période. Combiner IP + userId pour un rate limiting plus robuste.

---

### 9. Exposition de la configuration via endpoint public

- **Localisation** : `src/routes/upload.ts:206-217`
- **Description** : L'endpoint `/api/upload/config` expose publiquement la configuration d'upload (limites de taille, types autorisés, etc.) sans authentification. Bien que ces informations ne soient pas directement sensibles, elles aident un attaquant à comprendre les limites du système.

  ```typescript
  // Ligne 206-217
  router.get('/config', (_req: Request, res: Response) => {
    // ❌ Pas d'authentification requise
    return res.status(200).json({
      maxFileSize: UPLOAD_CONFIG.MAX_FILE_SIZE,
      maxFileSizeMB: UPLOAD_CONFIG.MAX_FILE_SIZE / 1024 / 1024,
      allowedTypes: UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES,
      // ...
    });
  });
  ```

- **Impact potentiel** :
  - Information disclosure facilitant la reconnaissance
  - Aide à calibrer des attaques (connaissance des limites exactes)

- **Probabilité estimée** : **Élevé**

- **Gravité** : **Faible**

- **Recommandation synthétique** : Protéger cet endpoint avec `authenticateToken` ou le supprimer en production si non nécessaire.

---

### 10. Validation UUID insuffisante sur certaines routes

- **Localisation** : `src/routes/page.ts:137-139` (route POST blocknote-content)
- **Description** : Certaines routes acceptent des `pageId` via params mais ne valident pas systématiquement le format UUID avant d'effectuer des requêtes en base. Bien que Prisma puisse rejeter les UUIDs invalides, cela peut créer des erreurs non gérées ou des logs pollués.

  ```typescript
  // Ligne 137-139
  const { pageId } = req.params;
  // ❌ Pas de validation UUID avant utilisation
  const updatedPage = await prisma.page.update({
    where: { id: pageId }, // Prisma rejettera si invalide, mais pas propre
  ```

- **Impact potentiel** :
  - Pollution des logs avec des erreurs Prisma
  - Comportements inattendus
  - Potentielles exceptions non gérées

- **Probabilité estimée** : **Faible**

- **Gravité** : **Faible**

- **Recommandation synthétique** : Valider systématiquement tous les UUIDs avec une regex ou Zod avant les requêtes Prisma (comme fait ligne 223 de `src/routes/page.ts`).

---

### 11. Gestion des secrets Clerk potentiellement améliorable

- **Localisation** : `src/services/auth.ts:23-26`
- **Description** : Le code fait un `process.exit(1)` si `CLERK_SECRET_KEY` est manquante, ce qui est bien. Cependant, la clé est utilisée directement partout sans rotation ni gestion centralisée sécurisée.

- **Impact potentiel** :
  - Difficulté de rotation des secrets
  - Risque si la clé est compromise (pas de mécanisme de révocation automatique)

- **Probabilité estimée** : **Faible**

- **Gravité** : **Faible**

- **Recommandation synthétique** : Implémenter un gestionnaire de secrets centralisé (AWS Secrets Manager, HashiCorp Vault) pour faciliter la rotation. Mettre en place un monitoring des usages suspects de la clé API.

---

### 12. Pas de limite sur la profondeur des requêtes JSON

- **Localisation** : `src/index.ts:84`
- **Description** : L'application accepte des payloads JSON jusqu'à 10MB sans limite de profondeur d'imbrication. Un attaquant peut envoyer des JSON profondément imbriqués pour causer un déni de service.

  ```typescript
  // Ligne 84
  app.use(express.json({ limit: '10mb' }));
  // ❌ Pas de protection contre la profondeur excessive
  ```

- **Impact potentiel** :
  - DoS via JSON profondément imbriqué
  - Épuisement de la stack
  - Ralentissement du serveur

- **Probabilité estimée** : **Faible**

- **Gravité** : **Faible à Moyen**

- **Recommandation synthétique** : Ajouter une option de limite de profondeur avec un middleware personnalisé ou utiliser une bibliothèque comme `express-json-validator-middleware` avec limite de profondeur.

---

## Bonnes pratiques déjà présentes

L'audit a également révélé plusieurs bonnes pratiques de sécurité déjà en place :

- ✅ **Rate limiting multicouche** robuste avec Redis (global, auth, AI, quiz, assistant) bien configuré
- ✅ **Authentification via Clerk** avec vérification de tokens JWT et double vérification d'expiration
- ✅ **Validation de signature** des webhooks Clerk avec `svix` pour éviter la forge de requêtes
- ✅ **Idempotence des webhooks** via table `WebhookEvent` évitant les traitements dupliqués
- ✅ **Helmet.js** activé pour les headers de sécurité HTTP
- ✅ **CORS** configuré avec liste blanche d'origines
- ✅ **Compression** activée pour optimiser les performances
- ✅ **Validation Zod** sur plusieurs routes critiques (création de pages, proxy OpenAI)
- ✅ **Upload de fichiers** avec validation de taille, compression Sharp et stockage sécurisé sur Cloudinary
- ✅ **Contrôle d'ownership** sur la suppression d'images Cloudinary (vérification userId dans publicId)
- ✅ **Prisma ORM** protégeant naturellement contre les injections SQL
- ✅ **WebSocket avec authentification** obligatoire via token et vérification d'accès aux pages
- ✅ **Limite de payload WebSocket** (1MB) pour prévenir les abus
- ✅ **Validation UUID** sur plusieurs routes sensibles
- ✅ **Cache Redis** avec TTL pour optimiser les performances
- ✅ **Keep-alive database** pour éviter les timeouts de connexion
- ✅ **Gestion des erreurs Prisma** spécifiques (P2025 pour ressources introuvables)
- ✅ **Middleware de log sécurisé** (`SecureLogger`) présent dans le projet
- ✅ **Vérification des limites utilisateur** avant création de ressources (pages, quiz, etc.)
- ✅ **Synchronisation utilisateur** avec cache pour éviter les requêtes excessives
- ✅ **Séparation des environnements** dev/prod avec configuration adaptée

---

## Conclusion

L'application présente un **niveau de sécurité globalement correct** avec de nombreuses bonnes pratiques en place (rate limiting, authentification Clerk, validation Zod, Prisma ORM). Les vulnérabilités identifiées sont principalement de niveau **moyen** et concernent :

1. Des **contrôles d'accès incomplets** sur certaines routes de recherche (IDOR)
2. Une **validation des entrées insuffisante** sur quelques endpoints
3. L'**exposition d'informations sensibles** via les logs
4. Des **fonctionnalités de sécurité non finalisées** (RBAC)

**Recommandation prioritaire** : Corriger immédiatement les vulnérabilités IDOR sur les routes de recherche de pages pour éviter toute fuite de données. Les autres vulnérabilités peuvent être traitées progressivement selon leur gravité.

---

## Plan d'action recommandé

### 🔴 **Priorité CRITIQUE** (à corriger immédiatement)

1. **IDOR sur les routes de recherche** (`src/routes/page.ts`)
   - Ajouter filtrage par workspace accessible dans `/pages/search` et `/pages/search-content`
   - Tester l'accès avec plusieurs utilisateurs différents

### 🟠 **Priorité HAUTE** (dans les 2 semaines)

2. **Validation des fichiers uploadés**
   - Implémenter vérification des magic bytes avec `file-type`
   - Tester l'upload avec des fichiers malveillants déguisés

3. **RBAC**
   - Implémenter la vérification des rôles dans `requireRole` middleware
   - Définir les rôles et permissions dans le système

4. **Logs et stack traces**
   - Migrer vers Winston ou Pino
   - Ne jamais exposer les stack traces en production
   - Sanitiser tous les messages d'erreur côté client

### 🟡 **Priorité MOYENNE** (dans le mois)

5. **Validation des entrées**
   - Ajouter validation Zod sur toutes les query params
   - Valider systématiquement les UUIDs

6. **Rate limiting WebSocket**
   - Migrer vers Redis pour persistance
   - Ajouter limite sur taille cumulée des messages

7. **Endpoint de configuration**
   - Protéger `/api/upload/config` avec authentification
   - Ou supprimer en production

### 🟢 **Priorité BASSE** (amélioration continue)

8. **Protection CSRF**
   - Évaluer la nécessité selon l'usage de cookies
   - Implémenter si nécessaire

9. **Configuration CORS**
   - Séparer strictement dev/prod
   - Nettoyer les domaines localhost en prod

10. **Gestion des secrets**
    - Évaluer migration vers AWS Secrets Manager ou Vault
    - Planifier rotation régulière des clés API

11. **Limite profondeur JSON**
    - Ajouter middleware de validation de profondeur
    - Tester avec payloads profondément imbriqués

12. **Validation UUID systématique**
    - Créer un middleware de validation UUID réutilisable
    - Appliquer sur toutes les routes concernées

---

**Fin du rapport**
