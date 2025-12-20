/**
 * 🧮 Clustering Utilities for Quiz Intelligence
 * PEN-16: K-means and DBSCAN algorithms for thematic clustering
 */

/**
 * Calculate Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same dimension");
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same dimension");
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Calculate centroid of a set of vectors
 */
export function calculateCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dimension = vectors[0].length;
  const centroid = new Array(dimension).fill(0);

  for (const vector of vectors) {
    for (let i = 0; i < dimension; i++) {
      centroid[i] += vector[i];
    }
  }

  for (let i = 0; i < dimension; i++) {
    centroid[i] /= vectors.length;
  }

  return centroid;
}

/**
 * K-means clustering result
 */
export interface KMeansResult {
  clusters: number[][]; // Array of point indices for each cluster
  centroids: number[][]; // Centroid for each cluster
  iterations: number;
}

/**
 * K-means++ initialization for better centroid selection
 */
function kMeansPlusPlusInit(vectors: number[][], k: number): number[][] {
  const centroids: number[][] = [];
  const n = vectors.length;

  // Choose first centroid randomly
  const firstIdx = Math.floor(Math.random() * n);
  centroids.push([...vectors[firstIdx]]);

  // Choose remaining centroids
  for (let c = 1; c < k; c++) {
    // Calculate distances to nearest centroid
    const distances: number[] = vectors.map((v) => {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dist = euclideanDistance(v, centroid);
        if (dist < minDist) minDist = dist;
      }
      return minDist ** 2; // Square for probability weighting
    });

    // Calculate cumulative probabilities
    const totalDist = distances.reduce((a, b) => a + b, 0);
    const probabilities = distances.map((d) => d / totalDist);
    const cumulative: number[] = [];
    let sum = 0;
    for (const p of probabilities) {
      sum += p;
      cumulative.push(sum);
    }

    // Choose next centroid
    const r = Math.random();
    let nextIdx = 0;
    for (let i = 0; i < cumulative.length; i++) {
      if (r <= cumulative[i]) {
        nextIdx = i;
        break;
      }
    }
    centroids.push([...vectors[nextIdx]]);
  }

  return centroids;
}

/**
 * K-means clustering algorithm
 */
export function kMeans(
  vectors: number[][],
  k: number,
  options: {
    maxIterations?: number;
    tolerance?: number;
  } = {},
): KMeansResult {
  const { maxIterations = 100, tolerance = 1e-6 } = options;

  if (vectors.length === 0) {
    return { clusters: [], centroids: [], iterations: 0 };
  }

  if (k >= vectors.length) {
    // Each point is its own cluster
    return {
      clusters: vectors.map((_, i) => [i]),
      centroids: vectors.map((v) => [...v]),
      iterations: 0,
    };
  }

  // Initialize centroids using k-means++
  let centroids = kMeansPlusPlusInit(vectors, k);
  let clusters: number[][] = [];
  let iterations = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;

    // Assign points to nearest centroid
    const newClusters: number[][] = Array.from({ length: k }, () => []);

    for (let i = 0; i < vectors.length; i++) {
      let nearestCluster = 0;
      let nearestDist = Infinity;

      for (let c = 0; c < k; c++) {
        const dist = euclideanDistance(vectors[i], centroids[c]);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestCluster = c;
        }
      }

      newClusters[nearestCluster].push(i);
    }

    // Handle empty clusters by reinitializing
    for (let c = 0; c < k; c++) {
      if (newClusters[c].length === 0) {
        // Find the cluster with most points and split
        let maxCluster = 0;
        let maxSize = 0;
        for (let j = 0; j < k; j++) {
          if (newClusters[j].length > maxSize) {
            maxSize = newClusters[j].length;
            maxCluster = j;
          }
        }
        // Move one point to empty cluster
        if (newClusters[maxCluster].length > 1) {
          const point = newClusters[maxCluster].pop()!;
          newClusters[c].push(point);
        }
      }
    }

    clusters = newClusters;

    // Calculate new centroids
    const newCentroids: number[][] = [];
    for (let c = 0; c < k; c++) {
      if (clusters[c].length > 0) {
        const clusterVectors = clusters[c].map((i) => vectors[i]);
        newCentroids.push(calculateCentroid(clusterVectors));
      } else {
        newCentroids.push(centroids[c]);
      }
    }

    // Check convergence
    let totalMovement = 0;
    for (let c = 0; c < k; c++) {
      totalMovement += euclideanDistance(centroids[c], newCentroids[c]);
    }

    centroids = newCentroids;

    if (totalMovement < tolerance) {
      break;
    }
  }

  return { clusters, centroids, iterations };
}

/**
 * DBSCAN clustering result
 */
export interface DBSCANResult {
  clusters: number[][]; // Array of point indices for each cluster
  noise: number[]; // Indices of noise points
}

/**
 * DBSCAN clustering algorithm
 * Automatically detects number of clusters based on density
 */
export function dbscan(
  vectors: number[][],
  options: {
    eps?: number; // Maximum distance between neighbors
    minPts?: number; // Minimum points to form a cluster
    autoEps?: boolean; // Auto-calculate eps using k-distance
  } = {},
): DBSCANResult {
  const n = vectors.length;

  if (n === 0) {
    return { clusters: [], noise: [] };
  }

  // Auto-calculate eps if needed
  let eps = options.eps;
  if (options.autoEps || eps === undefined) {
    eps = estimateEps(vectors, options.minPts || 4);
  }

  const minPts = options.minPts || 4;

  const labels = new Array(n).fill(-1); // -1 = unvisited
  const visited = new Array(n).fill(false);
  let currentCluster = 0;

  // Find neighbors within eps distance
  const getNeighbors = (pointIdx: number): number[] => {
    const neighbors: number[] = [];
    for (let i = 0; i < n; i++) {
      if (euclideanDistance(vectors[pointIdx], vectors[i]) <= eps) {
        neighbors.push(i);
      }
    }
    return neighbors;
  };

  // Expand cluster
  const expandCluster = (
    pointIdx: number,
    neighbors: number[],
    cluster: number,
  ): void => {
    labels[pointIdx] = cluster;

    const queue = [...neighbors];
    while (queue.length > 0) {
      const current = queue.shift()!;

      if (!visited[current]) {
        visited[current] = true;
        const currentNeighbors = getNeighbors(current);

        if (currentNeighbors.length >= minPts) {
          queue.push(...currentNeighbors);
        }
      }

      if (labels[current] === -1) {
        labels[current] = cluster;
      }
    }
  };

  // Main DBSCAN loop
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;

    visited[i] = true;
    const neighbors = getNeighbors(i);

    if (neighbors.length < minPts) {
      labels[i] = -2; // Noise
    } else {
      expandCluster(i, neighbors, currentCluster);
      currentCluster++;
    }
  }

  // Build result
  const clusters: number[][] = [];
  const noise: number[] = [];

  for (let c = 0; c < currentCluster; c++) {
    clusters.push([]);
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] === -2) {
      noise.push(i);
    } else if (labels[i] >= 0) {
      clusters[labels[i]].push(i);
    }
  }

  return { clusters, noise };
}

/**
 * Estimate eps parameter using k-distance graph
 */
function estimateEps(vectors: number[][], k: number): number {
  const n = vectors.length;
  if (n <= k) {
    return 0.5; // Default for very small datasets
  }

  // Calculate k-distance for each point
  const kDistances: number[] = [];

  for (let i = 0; i < n; i++) {
    const distances: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        distances.push(euclideanDistance(vectors[i], vectors[j]));
      }
    }
    distances.sort((a, b) => a - b);
    kDistances.push(distances[k - 1] || distances[distances.length - 1]);
  }

  // Sort k-distances
  kDistances.sort((a, b) => a - b);

  // Find elbow point (simplified: use the 75th percentile)
  const elbowIdx = Math.floor(n * 0.75);
  return kDistances[elbowIdx];
}

/**
 * Silhouette score for evaluating clustering quality
 * Returns a value between -1 and 1 (higher is better)
 */
export function silhouetteScore(
  vectors: number[][],
  clusters: number[][],
): number {
  if (clusters.length <= 1) return 0;

  let totalScore = 0;
  let totalPoints = 0;

  for (let clusterIdx = 0; clusterIdx < clusters.length; clusterIdx++) {
    const cluster = clusters[clusterIdx];
    if (cluster.length === 0) continue;

    for (const pointIdx of cluster) {
      // Calculate a(i) - average distance to same cluster
      let a = 0;
      if (cluster.length > 1) {
        for (const otherIdx of cluster) {
          if (otherIdx !== pointIdx) {
            a += euclideanDistance(vectors[pointIdx], vectors[otherIdx]);
          }
        }
        a /= cluster.length - 1;
      }

      // Calculate b(i) - minimum average distance to other clusters
      let b = Infinity;
      for (
        let otherClusterIdx = 0;
        otherClusterIdx < clusters.length;
        otherClusterIdx++
      ) {
        if (otherClusterIdx === clusterIdx) continue;
        const otherCluster = clusters[otherClusterIdx];
        if (otherCluster.length === 0) continue;

        let avgDist = 0;
        for (const otherIdx of otherCluster) {
          avgDist += euclideanDistance(vectors[pointIdx], vectors[otherIdx]);
        }
        avgDist /= otherCluster.length;

        if (avgDist < b) b = avgDist;
      }

      // Calculate silhouette for this point
      const s = b === Infinity ? 0 : (b - a) / Math.max(a, b);
      totalScore += s;
      totalPoints++;
    }
  }

  return totalPoints > 0 ? totalScore / totalPoints : 0;
}
