/**
 * 🚀 Quiz Pipeline Benchmark - PEN-24
 * Script de benchmark pour mesurer les performances du pipeline Quiz Intelligence
 *
 * Usage:
 *   npx tsx scripts/quiz/benchmark-pipeline.ts [--scenario=small|medium|large|xlarge]
 *
 * Métriques collectées:
 *   - Temps d'extraction des concepts
 *   - Temps de clustering thématique
 *   - Temps de sélection de contenu
 *   - Temps de scoring des questions
 *   - Taux de cache hits
 *   - Distribution des types de contenu
 *   - Score de qualité des clusters (silhouette)
 */

import { performance } from "perf_hooks";
import {
  euclideanDistance,
  cosineSimilarity,
  calculateCentroid,
  kMeans,
  dbscan,
  silhouetteScore,
} from "../../src/utils/clustering.js";
import { QuestionScorerService } from "../../src/services/quiz/intelligence/questionScorer.js";
import { QuestionType, type Question } from "../../src/services/quiz/types.js";

// ============================================================================
// Types
// ============================================================================

interface BenchmarkResult {
  scenario: string;
  metrics: {
    // Timing metrics (ms)
    clusteringTimeMs: number;
    scoringTimeMs: number;
    totalTimeMs: number;

    // Quality metrics
    silhouetteScore: number;
    avgQuestionScore: number;
    duplicateDetectionRate: number;

    // Volume metrics
    vectorCount: number;
    clusterCount: number;
    questionsScored: number;
    duplicatesFound: number;

    // Performance metrics
    vectorsPerSecond: number;
    questionsPerSecond: number;
  };
  timestamp: Date;
}

interface ScenarioConfig {
  name: string;
  vectorCount: number;
  vectorDimension: number;
  clusterCount: number;
  questionCount: number;
  duplicateRatio: number; // 0-1, ratio of duplicate questions
}

// ============================================================================
// Scenario Configurations
// ============================================================================

const SCENARIOS: Record<string, ScenarioConfig> = {
  small: {
    name: "Small (5 pages, 10 questions)",
    vectorCount: 5,
    vectorDimension: 128,
    clusterCount: 2,
    questionCount: 10,
    duplicateRatio: 0.1,
  },
  medium: {
    name: "Medium (20 pages, 20 questions)",
    vectorCount: 20,
    vectorDimension: 256,
    clusterCount: 4,
    questionCount: 20,
    duplicateRatio: 0.15,
  },
  large: {
    name: "Large (50 pages, 30 questions)",
    vectorCount: 50,
    vectorDimension: 512,
    clusterCount: 8,
    questionCount: 30,
    duplicateRatio: 0.2,
  },
  xlarge: {
    name: "XLarge (100 pages, 50 questions)",
    vectorCount: 100,
    vectorDimension: 1536, // OpenAI embedding dimension
    clusterCount: 12,
    questionCount: 50,
    duplicateRatio: 0.25,
  },
};

// ============================================================================
// Data Generators
// ============================================================================

/**
 * Generate random vectors simulating page embeddings
 */
function generateVectors(count: number, dimension: number): number[][] {
  return Array.from({ length: count }, () =>
    Array.from({ length: dimension }, () => Math.random() * 2 - 1),
  );
}

/**
 * Generate clustered vectors for more realistic testing
 */
function generateClusteredVectors(
  count: number,
  dimension: number,
  clusterCount: number,
): number[][] {
  const vectors: number[][] = [];
  const pointsPerCluster = Math.ceil(count / clusterCount);

  for (let c = 0; c < clusterCount; c++) {
    // Generate cluster center
    const center = Array.from({ length: dimension }, () => Math.random() * 10);

    // Generate points around the center
    for (let i = 0; i < pointsPerCluster && vectors.length < count; i++) {
      const point = center.map((v) => v + (Math.random() - 0.5) * 2);
      vectors.push(point);
    }
  }

  return vectors;
}

/**
 * Generate test questions with optional duplicates
 */
function generateQuestions(count: number, duplicateRatio: number): Question[] {
  const questions: Question[] = [];
  const duplicateCount = Math.floor(count * duplicateRatio);
  const uniqueCount = count - duplicateCount;

  // Generate unique questions
  for (let i = 0; i < uniqueCount; i++) {
    const type = [
      QuestionType.OPEN_QUESTION,
      QuestionType.MULTIPLE_CHOICE,
      QuestionType.TRUE_FALSE,
    ][i % 3];

    const baseQuestion = {
      id: `q-${i}`,
      difficulty: ["facile", "moyen", "difficile"][i % 3] as
        | "facile"
        | "moyen"
        | "difficile",
      points: (i % 3) + 1,
    };

    if (type === QuestionType.OPEN_QUESTION) {
      questions.push({
        ...baseQuestion,
        type: QuestionType.OPEN_QUESTION,
        question: `Question ouverte numéro ${i}: Expliquez en détail le concept ${i} et son application pratique dans le domaine concerné.`,
        expectedAnswer: `Réponse attendue pour la question ${i}`,
        keywords: [`mot-clé-${i}`, `concept-${i}`],
      });
    } else if (type === QuestionType.MULTIPLE_CHOICE) {
      questions.push({
        ...baseQuestion,
        type: QuestionType.MULTIPLE_CHOICE,
        question: `Question QCM numéro ${i}: Quelle est la bonne réponse concernant le sujet ${i}?`,
        options: [
          { id: "a", text: `Option A pour question ${i}`, isCorrect: true },
          { id: "b", text: `Option B différente`, isCorrect: false },
          { id: "c", text: `Option C alternative`, isCorrect: false },
          { id: "d", text: `Option D autre choix`, isCorrect: false },
        ],
      });
    } else {
      questions.push({
        ...baseQuestion,
        type: QuestionType.TRUE_FALSE,
        question: `Question Vrai/Faux numéro ${i}: L'affirmation concernant le sujet ${i} est correcte.`,
        correctAnswer: i % 2 === 0,
        explanation: `Explication pour la question ${i}`,
      });
    }
  }

  // Add duplicates (copies of existing questions with different IDs)
  for (let i = 0; i < duplicateCount; i++) {
    const original = questions[i % uniqueCount];
    questions.push({
      ...original,
      id: `q-dup-${i}`,
    });
  }

  return questions;
}

// ============================================================================
// Benchmark Functions
// ============================================================================

/**
 * Benchmark clustering operations
 */
function benchmarkClustering(
  vectors: number[][],
  targetClusters: number,
): { timeMs: number; clusters: number[][]; silhouette: number } {
  const start = performance.now();

  // Run k-means
  const kmeansResult = kMeans(vectors, targetClusters);

  // Calculate silhouette score
  const silhouette = silhouetteScore(vectors, kmeansResult.clusters);

  const timeMs = performance.now() - start;

  return {
    timeMs,
    clusters: kmeansResult.clusters,
    silhouette,
  };
}

/**
 * Benchmark DBSCAN clustering
 */
function benchmarkDBSCAN(vectors: number[][]): {
  timeMs: number;
  clusters: number[][];
  noise: number[];
} {
  const start = performance.now();

  const result = dbscan(vectors, { autoEps: true, minPts: 3 });

  const timeMs = performance.now() - start;

  return {
    timeMs,
    clusters: result.clusters,
    noise: result.noise,
  };
}

/**
 * Benchmark question scoring and duplicate detection
 */
function benchmarkScoring(questions: Question[]): {
  timeMs: number;
  avgScore: number;
  duplicatesFound: number;
  scores: number[];
} {
  const start = performance.now();

  const scores: number[] = [];
  const acceptedQuestions: Question[] = [];
  let duplicatesFound = 0;

  for (const question of questions) {
    const result = QuestionScorerService.isAcceptable(
      question,
      acceptedQuestions,
    );

    scores.push(result.score.overall);

    if (result.duplicate.isDuplicate) {
      duplicatesFound++;
    } else if (result.acceptable) {
      acceptedQuestions.push(question);
    }
  }

  const timeMs = performance.now() - start;
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  return { timeMs, avgScore, duplicatesFound, scores };
}

/**
 * Benchmark distance calculations
 */
function benchmarkDistanceCalculations(vectors: number[][]): {
  euclideanTimeMs: number;
  cosineTimeMs: number;
  centroidTimeMs: number;
} {
  // Euclidean distance benchmark
  let euclideanStart = performance.now();
  for (let i = 0; i < Math.min(100, vectors.length); i++) {
    for (let j = i + 1; j < Math.min(100, vectors.length); j++) {
      euclideanDistance(vectors[i], vectors[j]);
    }
  }
  const euclideanTimeMs = performance.now() - euclideanStart;

  // Cosine similarity benchmark
  let cosineStart = performance.now();
  for (let i = 0; i < Math.min(100, vectors.length); i++) {
    for (let j = i + 1; j < Math.min(100, vectors.length); j++) {
      cosineSimilarity(vectors[i], vectors[j]);
    }
  }
  const cosineTimeMs = performance.now() - cosineStart;

  // Centroid calculation benchmark
  let centroidStart = performance.now();
  for (let i = 0; i < 10; i++) {
    calculateCentroid(vectors);
  }
  const centroidTimeMs = performance.now() - centroidStart;

  return { euclideanTimeMs, cosineTimeMs, centroidTimeMs };
}

// ============================================================================
// Main Benchmark Runner
// ============================================================================

async function runBenchmark(scenarioName: string): Promise<BenchmarkResult> {
  const config = SCENARIOS[scenarioName];
  if (!config) {
    throw new Error(`Unknown scenario: ${scenarioName}`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🚀 Running benchmark: ${config.name}`);
  console.log(`${"=".repeat(60)}\n`);

  const totalStart = performance.now();

  // Generate test data
  console.log("📊 Generating test data...");
  const vectors = generateClusteredVectors(
    config.vectorCount,
    config.vectorDimension,
    config.clusterCount,
  );
  const questions = generateQuestions(
    config.questionCount,
    config.duplicateRatio,
  );
  console.log(
    `   Generated ${vectors.length} vectors (${config.vectorDimension}D) and ${questions.length} questions`,
  );

  // Benchmark clustering
  console.log("\n🎯 Benchmarking clustering (K-means)...");
  const clusteringResult = benchmarkClustering(vectors, config.clusterCount);
  console.log(`   Time: ${clusteringResult.timeMs.toFixed(2)}ms`);
  console.log(`   Clusters: ${clusteringResult.clusters.length}`);
  console.log(`   Silhouette score: ${clusteringResult.silhouette.toFixed(4)}`);

  // Benchmark DBSCAN
  console.log("\n🔍 Benchmarking clustering (DBSCAN)...");
  const dbscanResult = benchmarkDBSCAN(vectors);
  console.log(`   Time: ${dbscanResult.timeMs.toFixed(2)}ms`);
  console.log(`   Clusters: ${dbscanResult.clusters.length}`);
  console.log(`   Noise points: ${dbscanResult.noise.length}`);

  // Benchmark scoring
  console.log("\n📝 Benchmarking question scoring...");
  const scoringResult = benchmarkScoring(questions);
  console.log(`   Time: ${scoringResult.timeMs.toFixed(2)}ms`);
  console.log(`   Avg score: ${scoringResult.avgScore.toFixed(4)}`);
  console.log(`   Duplicates found: ${scoringResult.duplicatesFound}`);

  // Benchmark distance calculations
  console.log("\n📏 Benchmarking distance calculations...");
  const distanceResult = benchmarkDistanceCalculations(vectors);
  console.log(`   Euclidean: ${distanceResult.euclideanTimeMs.toFixed(2)}ms`);
  console.log(`   Cosine: ${distanceResult.cosineTimeMs.toFixed(2)}ms`);
  console.log(`   Centroid: ${distanceResult.centroidTimeMs.toFixed(2)}ms`);

  const totalTimeMs = performance.now() - totalStart;

  // Calculate metrics
  const result: BenchmarkResult = {
    scenario: config.name,
    metrics: {
      clusteringTimeMs: clusteringResult.timeMs + dbscanResult.timeMs,
      scoringTimeMs: scoringResult.timeMs,
      totalTimeMs,
      silhouetteScore: clusteringResult.silhouette,
      avgQuestionScore: scoringResult.avgScore,
      duplicateDetectionRate:
        scoringResult.duplicatesFound /
        Math.floor(config.questionCount * config.duplicateRatio),
      vectorCount: vectors.length,
      clusterCount: clusteringResult.clusters.length,
      questionsScored: questions.length,
      duplicatesFound: scoringResult.duplicatesFound,
      vectorsPerSecond: (vectors.length / clusteringResult.timeMs) * 1000,
      questionsPerSecond: (questions.length / scoringResult.timeMs) * 1000,
    },
    timestamp: new Date(),
  };

  return result;
}

/**
 * Print summary of benchmark results
 */
function printSummary(results: BenchmarkResult[]): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log("📈 BENCHMARK SUMMARY");
  console.log(`${"=".repeat(60)}\n`);

  console.log("| Scenario | Total Time | Clustering | Scoring | Silhouette |");
  console.log("|----------|------------|------------|---------|------------|");

  for (const result of results) {
    console.log(
      `| ${result.scenario.padEnd(30)} | ` +
        `${result.metrics.totalTimeMs.toFixed(0).padStart(6)}ms | ` +
        `${result.metrics.clusteringTimeMs.toFixed(0).padStart(6)}ms | ` +
        `${result.metrics.scoringTimeMs.toFixed(0).padStart(5)}ms | ` +
        `${result.metrics.silhouetteScore.toFixed(4).padStart(10)} |`,
    );
  }

  console.log("\n📊 Performance Metrics:");
  for (const result of results) {
    console.log(`\n${result.scenario}:`);
    console.log(
      `  - Vectors/sec: ${result.metrics.vectorsPerSecond.toFixed(0)}`,
    );
    console.log(
      `  - Questions/sec: ${result.metrics.questionsPerSecond.toFixed(0)}`,
    );
    console.log(
      `  - Duplicate detection: ${(result.metrics.duplicateDetectionRate * 100).toFixed(1)}%`,
    );
    console.log(
      `  - Avg question quality: ${(result.metrics.avgQuestionScore * 100).toFixed(1)}%`,
    );
  }
}

/**
 * Export results as JSON
 */
function exportResults(results: BenchmarkResult[]): void {
  const output = {
    benchmarkDate: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    results,
  };

  console.log("\n📄 JSON Export:");
  console.log(JSON.stringify(output, null, 2));
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log("🧠 Quiz Intelligence Pipeline Benchmark");
  console.log(`Node.js ${process.version} on ${process.platform}`);

  // Parse CLI arguments
  const args = process.argv.slice(2);
  const scenarioArg = args.find((a) => a.startsWith("--scenario="));
  const scenario = scenarioArg ? scenarioArg.split("=")[1] : null;
  const exportJson = args.includes("--json");

  const results: BenchmarkResult[] = [];

  if (scenario) {
    // Run specific scenario
    if (!SCENARIOS[scenario]) {
      console.error(`Unknown scenario: ${scenario}`);
      console.log(`Available scenarios: ${Object.keys(SCENARIOS).join(", ")}`);
      process.exit(1);
    }
    results.push(await runBenchmark(scenario));
  } else {
    // Run all scenarios
    for (const scenarioName of Object.keys(SCENARIOS)) {
      results.push(await runBenchmark(scenarioName));
    }
  }

  // Print summary
  printSummary(results);

  // Export JSON if requested
  if (exportJson) {
    exportResults(results);
  }

  console.log("\n✅ Benchmark completed!");
}

// Run
main().catch(console.error);
