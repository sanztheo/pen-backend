# Quiz Pipeline Intelligence - Métriques & Benchmarks

## PEN-24: Documentation des métriques de performance

Ce document décrit les métriques collectées par le pipeline Quiz Intelligence et comment les interpréter.

---

## Architecture du Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    Quiz Intelligence Pipeline                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. EXTRACTION (ConceptExtractor)                               │
│     └─ Entrée: Pages BlockNote                                  │
│     └─ Sortie: Keywords, Definitions, KeyPoints, Embeddings     │
│     └─ Métriques: extractionTimeMs, conceptCount, wordCount     │
│                                                                  │
│  2. CLUSTERING (ThematicClusterer)                              │
│     └─ Entrée: Page embeddings                                  │
│     └─ Sortie: Clusters thématiques                             │
│     └─ Métriques: clusteringTimeMs, silhouetteScore             │
│                                                                  │
│  3. SÉLECTION (SmartContentSelector)                            │
│     └─ Entrée: Clusters + Pages                                 │
│     └─ Sortie: Contenu priorisé (definitions > formulas > ...)  │
│     └─ Métriques: selectionTimeMs, coverage, tokenCount         │
│                                                                  │
│  4. SCORING (QuestionScorer)                                    │
│     └─ Entrée: Questions générées                               │
│     └─ Sortie: Scores qualité + détection duplicats             │
│     └─ Métriques: scoringTimeMs, avgScore, duplicateRate        │
│                                                                  │
│  5. CACHE (ContextCache)                                        │
│     └─ Entrée: Contexte préparé                                 │
│     └─ Sortie: Cache Redis (TTL 24h)                            │
│     └─ Métriques: cacheHitRate, cacheSizeBytes                  │
│                                                                  │
│  6. ENRICHISSEMENT (CorrectionEnricher)                         │
│     └─ Entrée: Corrections + RAG                                │
│     └─ Sortie: Corrections avec références sources              │
│     └─ Métriques: enrichmentTimeMs, referencesFound             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Métriques Principales

### 1. Métriques de Temps (Performance)

| Métrique | Description | Cible | Alerte |
|----------|-------------|-------|--------|
| `extractionTimeMs` | Temps d'extraction des concepts par page | < 500ms | > 2000ms |
| `clusteringTimeMs` | Temps de clustering K-means/DBSCAN | < 200ms pour 50 pages | > 1000ms |
| `selectionTimeMs` | Temps de sélection du contenu | < 100ms par cluster | > 500ms |
| `scoringTimeMs` | Temps de scoring par question | < 5ms | > 20ms |
| `cacheRetrievalMs` | Temps de récupération cache | < 10ms | > 50ms |
| `enrichmentTimeMs` | Temps d'enrichissement correction | < 100ms | > 500ms |
| `totalPipelineMs` | Temps total du pipeline | < 3000ms | > 10000ms |

### 2. Métriques de Qualité

| Métrique | Description | Valeur Optimale | Seuil Minimum |
|----------|-------------|-----------------|---------------|
| `silhouetteScore` | Qualité du clustering (-1 à 1) | > 0.7 | > 0.3 |
| `avgQuestionScore` | Score moyen des questions (0-1) | > 0.75 | > 0.5 |
| `duplicateDetectionRate` | Taux de détection duplicats | > 95% | > 80% |
| `contentCoverage` | Couverture du contenu sélectionné | > 50% | > 30% |

### 3. Métriques de Volume

| Métrique | Description | Formule |
|----------|-------------|---------|
| `vectorsPerSecond` | Débit de clustering | vectors / clusteringTimeMs * 1000 |
| `questionsPerSecond` | Débit de scoring | questions / scoringTimeMs * 1000 |
| `tokensSelected` | Tokens sélectionnés | Somme des tokens des chunks |
| `conceptsExtracted` | Concepts extraits par page | keywords + definitions + keyPoints |

### 4. Métriques de Cache

| Métrique | Description | Cible |
|----------|-------------|-------|
| `cacheHitRate` | Ratio de hits cache | > 40% |
| `cacheMissRate` | Ratio de miss cache | < 60% |
| `cacheInvalidations` | Invalidations (pages modifiées) | Monitoring |
| `cacheSize` | Nombre d'entrées cache | Monitoring |

---

## Scénarios de Benchmark

### Small (5 pages, 10 questions)
- **Utilisation**: Tests rapides, développement
- **Temps attendu**: < 500ms total
- **Clusters attendus**: 2

### Medium (20 pages, 20 questions)
- **Utilisation**: Usage typique étudiant
- **Temps attendu**: < 2000ms total
- **Clusters attendus**: 4-5

### Large (50 pages, 30 questions)
- **Utilisation**: Révisions intensives
- **Temps attendu**: < 5000ms total
- **Clusters attendus**: 8-10

### XLarge (100 pages, 50 questions)
- **Utilisation**: Préparation examen complet
- **Temps attendu**: < 15000ms total
- **Clusters attendus**: 10-15

---

## Exécution des Benchmarks

```bash
# Tous les scénarios
npx tsx scripts/quiz/benchmark-pipeline.ts

# Scénario spécifique
npx tsx scripts/quiz/benchmark-pipeline.ts --scenario=medium

# Export JSON
npx tsx scripts/quiz/benchmark-pipeline.ts --json
```

---

## Interprétation des Résultats

### Silhouette Score
- **> 0.7**: Excellent clustering, thèmes bien séparés
- **0.5 - 0.7**: Bon clustering, quelques chevauchements
- **0.3 - 0.5**: Clustering acceptable, chevauchements significatifs
- **< 0.3**: Mauvais clustering, considérer moins de clusters

### Question Score
- **> 0.8**: Question haute qualité
- **0.6 - 0.8**: Question acceptable
- **0.5 - 0.6**: Question limite, amélioration recommandée
- **< 0.5**: Question rejetée

### Cache Hit Rate
- **> 60%**: Excellent, économies significatives
- **40% - 60%**: Bon, cache efficace
- **20% - 40%**: Acceptable, contenu souvent modifié
- **< 20%**: Faible, vérifier stratégie cache

---

## Alertes et Monitoring

### Alertes Critiques
1. `totalPipelineMs > 30000` - Pipeline trop lent, investigation requise
2. `silhouetteScore < 0.1` - Clustering inefficace
3. `avgQuestionScore < 0.4` - Qualité questions insuffisante
4. `cacheHitRate < 10%` - Cache potentiellement cassé

### Métriques à Surveiller
- Tendance du temps de réponse (dégradation progressive)
- Taux d'erreur OpenAI (quota, rate limiting)
- Taille du cache Redis (croissance)
- Distribution des types de contenu

---

## Optimisations Recommandées

### Performance
1. **Batch extraction**: Extraire concepts en parallèle (max 5 concurrent)
2. **Early termination**: Arrêter clustering si silhouette < 0.3
3. **Token budgeting**: Limiter tokens par cluster proportionnellement

### Qualité
1. **Duplicate threshold**: Ajuster selon le cas d'usage (0.85 par défaut)
2. **Min question length**: 20 caractères minimum
3. **Content priority**: definitions > formulas > keypoints > paragraphs

### Cache
1. **TTL adaptatif**: 24h par défaut, réduire si contenu volatil
2. **Invalidation ciblée**: Invalider uniquement les pages modifiées
3. **Warm-up**: Pré-calculer contexte pour workspaces fréquents

---

## Historique des Benchmarks

| Date | Scénario | Total (ms) | Silhouette | Notes |
|------|----------|------------|------------|-------|
| 2024-XX-XX | Medium | XXXX | 0.XX | Baseline |

---

## Annexe: Structure des Données

### ExtractionResult
```typescript
{
  success: boolean;
  pageId: string;
  concepts: {
    keywords: string[];
    definitions: Record<string, string>;
    keyPoints: string[];
    formulas: string[];
    topic: string;
    summary: string;
  };
  embedding: number[];
  difficulty: "easy" | "medium" | "hard";
  stats: {
    wordCount: number;
    conceptCount: number;
    hasFormulas: boolean;
    hasDefinitions: boolean;
  };
  processingTimeMs: number;
}
```

### ClusterResult
```typescript
{
  clusters: ThematicCluster[];
  totalPages: number;
  algorithm: string;
  silhouetteScore: number;
  processingTimeMs: number;
}
```

### QuestionScore
```typescript
{
  overall: number;      // 0-1
  clarity: number;      // 0-1
  relevance: number;    // 0-1
  optionVariety: number; // 0-1
  difficultyCoherence: number; // 0-1
  reasons: string[];
}
```
