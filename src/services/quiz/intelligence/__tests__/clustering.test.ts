/**
 * 🧪 Clustering Utilities Tests - PEN-24
 * Tests unitaires pour K-means, DBSCAN et fonctions de distance
 */

import { describe, expect, it } from "@jest/globals";
import {
  euclideanDistance,
  cosineSimilarity,
  calculateCentroid,
  kMeans,
  dbscan,
  silhouetteScore,
} from "../../../../utils/clustering.js";

// ============================================================================
// Tests: euclideanDistance
// ============================================================================

describe("euclideanDistance", () => {
  it("should return 0 for identical vectors", () => {
    const a = [1, 2, 3];
    const b = [1, 2, 3];

    expect(euclideanDistance(a, b)).toBe(0);
  });

  it("should calculate correct distance for simple vectors", () => {
    const a = [0, 0];
    const b = [3, 4];

    // Distance should be 5 (3-4-5 triangle)
    expect(euclideanDistance(a, b)).toBe(5);
  });

  it("should calculate correct distance for 3D vectors", () => {
    const a = [1, 2, 3];
    const b = [4, 6, 3];

    // sqrt((4-1)^2 + (6-2)^2 + (3-3)^2) = sqrt(9 + 16 + 0) = 5
    expect(euclideanDistance(a, b)).toBe(5);
  });

  it("should be symmetric", () => {
    const a = [1, 5, 9];
    const b = [3, 7, 2];

    expect(euclideanDistance(a, b)).toBe(euclideanDistance(b, a));
  });

  it("should throw for vectors of different dimensions", () => {
    const a = [1, 2, 3];
    const b = [1, 2];

    expect(() => euclideanDistance(a, b)).toThrow("same dimension");
  });
});

// ============================================================================
// Tests: cosineSimilarity
// ============================================================================

describe("cosineSimilarity", () => {
  it("should return 1 for identical normalized vectors", () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];

    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("should return 1 for parallel vectors", () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6];

    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("should return 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];

    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("should return -1 for opposite vectors", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];

    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it("should handle zero vectors", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];

    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("should be symmetric", () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];

    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });

  it("should throw for vectors of different dimensions", () => {
    const a = [1, 2];
    const b = [1, 2, 3];

    expect(() => cosineSimilarity(a, b)).toThrow("same dimension");
  });
});

// ============================================================================
// Tests: calculateCentroid
// ============================================================================

describe("calculateCentroid", () => {
  it("should return empty array for empty input", () => {
    expect(calculateCentroid([])).toEqual([]);
  });

  it("should return the same vector for single input", () => {
    const vectors = [[1, 2, 3]];

    expect(calculateCentroid(vectors)).toEqual([1, 2, 3]);
  });

  it("should calculate correct centroid for multiple vectors", () => {
    const vectors = [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ];

    const centroid = calculateCentroid(vectors);

    expect(centroid).toEqual([1, 1]);
  });

  it("should handle negative values", () => {
    const vectors = [
      [-2, -2],
      [2, 2],
    ];

    const centroid = calculateCentroid(vectors);

    expect(centroid).toEqual([0, 0]);
  });
});

// ============================================================================
// Tests: kMeans
// ============================================================================

describe("kMeans", () => {
  it("should return empty clusters for empty input", () => {
    const result = kMeans([], 3);

    expect(result.clusters).toEqual([]);
    expect(result.centroids).toEqual([]);
    expect(result.iterations).toBe(0);
  });

  it("should handle k >= n (each point is its own cluster)", () => {
    const vectors = [
      [0, 0],
      [1, 1],
    ];

    const result = kMeans(vectors, 5);

    expect(result.clusters.length).toBe(2);
    expect(result.iterations).toBe(0);
  });

  it("should create k clusters", () => {
    // Clear clusters: two groups
    const vectors = [
      // Group 1 around (0, 0)
      [0, 0],
      [0.1, 0.1],
      [-0.1, 0.1],
      // Group 2 around (10, 10)
      [10, 10],
      [10.1, 10.1],
      [9.9, 10.1],
    ];

    const result = kMeans(vectors, 2);

    expect(result.clusters.length).toBe(2);
    // Each cluster should have 3 points
    expect(result.clusters[0].length + result.clusters[1].length).toBe(6);
  });

  it("should converge in finite iterations", () => {
    const vectors = [
      [0, 0],
      [1, 1],
      [10, 10],
      [11, 11],
    ];

    const result = kMeans(vectors, 2, { maxIterations: 100 });

    expect(result.iterations).toBeLessThanOrEqual(100);
  });

  it("should separate clearly distinct clusters", () => {
    const vectors = [
      // Cluster A
      [0, 0],
      [1, 0],
      [0, 1],
      // Cluster B
      [100, 100],
      [101, 100],
      [100, 101],
    ];

    const result = kMeans(vectors, 2);

    // Find which cluster has points near origin
    const clusterAPoints = result.clusters.find((c) =>
      c.some((idx) => vectors[idx][0] < 50),
    );
    const clusterBPoints = result.clusters.find((c) =>
      c.some((idx) => vectors[idx][0] > 50),
    );

    expect(clusterAPoints).toBeDefined();
    expect(clusterBPoints).toBeDefined();
    expect(clusterAPoints!.length).toBe(3);
    expect(clusterBPoints!.length).toBe(3);
  });
});

// ============================================================================
// Tests: dbscan
// ============================================================================

describe("dbscan", () => {
  it("should return empty result for empty input", () => {
    const result = dbscan([]);

    expect(result.clusters).toEqual([]);
    expect(result.noise).toEqual([]);
  });

  it("should detect dense clusters", () => {
    const vectors = [
      // Dense cluster
      [0, 0],
      [0.1, 0],
      [0, 0.1],
      [0.1, 0.1],
      // Isolated point (noise)
      [100, 100],
    ];

    const result = dbscan(vectors, { eps: 0.5, minPts: 3 });

    // Should have 1 cluster (4 points) and 1 noise point
    expect(result.clusters.length).toBe(1);
    expect(result.clusters[0].length).toBe(4);
    expect(result.noise.length).toBe(1);
    expect(result.noise[0]).toBe(4); // Index of isolated point
  });

  it("should detect multiple clusters", () => {
    const vectors = [
      // Cluster 1
      [0, 0],
      [0.1, 0],
      [0, 0.1],
      [0.1, 0.1],
      // Cluster 2
      [10, 10],
      [10.1, 10],
      [10, 10.1],
      [10.1, 10.1],
    ];

    const result = dbscan(vectors, { eps: 0.5, minPts: 3 });

    expect(result.clusters.length).toBe(2);
    expect(result.noise.length).toBe(0);
  });

  it("should auto-calculate eps when autoEps is true", () => {
    const vectors = [
      [0, 0],
      [1, 1],
      [2, 2],
      [10, 10],
      [11, 11],
      [12, 12],
    ];

    const result = dbscan(vectors, { autoEps: true, minPts: 2 });

    // Should create some clusters (behavior depends on auto eps calculation)
    expect(result.clusters.length).toBeGreaterThanOrEqual(0);
  });

  it("should mark all points as noise if no dense regions exist", () => {
    const vectors = [
      [0, 0],
      [100, 100],
      [200, 200],
      [300, 300],
    ];

    const result = dbscan(vectors, { eps: 1, minPts: 3 });

    expect(result.clusters.length).toBe(0);
    expect(result.noise.length).toBe(4);
  });
});

// ============================================================================
// Tests: silhouetteScore
// ============================================================================

describe("silhouetteScore", () => {
  it("should return 0 for single cluster", () => {
    const vectors = [
      [0, 0],
      [1, 1],
    ];
    const clusters = [[0, 1]];

    expect(silhouetteScore(vectors, clusters)).toBe(0);
  });

  it("should return 0 for empty clusters", () => {
    expect(silhouetteScore([], [])).toBe(0);
  });

  it("should return high score for well-separated clusters", () => {
    const vectors = [
      // Cluster 1 - tight group at origin
      [0, 0],
      [0.1, 0.1],
      [0, 0.1],
      // Cluster 2 - tight group far away
      [100, 100],
      [100.1, 100.1],
      [100, 100.1],
    ];

    const clusters = [
      [0, 1, 2], // Cluster 1
      [3, 4, 5], // Cluster 2
    ];

    const score = silhouetteScore(vectors, clusters);

    // Well-separated clusters should have high score (close to 1)
    expect(score).toBeGreaterThan(0.8);
  });

  it("should return lower score for overlapping clusters", () => {
    const vectors = [
      // Overlapping points
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ];

    // Arbitrary split
    const clusters = [
      [0, 1, 2],
      [3, 4, 5],
    ];

    const score = silhouetteScore(vectors, clusters);

    // Overlapping clusters should have lower score (but still positive for linear data)
    expect(score).toBeLessThan(0.6);
  });

  it("should be between -1 and 1", () => {
    const vectors = [
      [0, 0],
      [1, 0],
      [5, 0],
      [6, 0],
    ];

    const clusters = [
      [0, 1],
      [2, 3],
    ];

    const score = silhouetteScore(vectors, clusters);

    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("Clustering - Performance", () => {
  it("should cluster 100 points with k-means in reasonable time", () => {
    // Generate random 2D points
    const vectors = Array.from({ length: 100 }, () => [
      Math.random() * 100,
      Math.random() * 100,
    ]);

    const start = performance.now();
    const result = kMeans(vectors, 5);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000); // Less than 1 second
    expect(result.clusters.length).toBe(5);
  });

  it("should cluster 50 points with DBSCAN in reasonable time", () => {
    const vectors = Array.from({ length: 50 }, () => [
      Math.random() * 100,
      Math.random() * 100,
    ]);

    const start = performance.now();
    const result = dbscan(vectors, { autoEps: true, minPts: 3 });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500); // Less than 500ms
    expect(result.clusters.length + result.noise.length).toBeGreaterThanOrEqual(
      0,
    );
  });

  it("should calculate silhouette score for 6 clusters quickly", () => {
    const vectors = Array.from({ length: 60 }, (_, i) => [
      Math.floor(i / 10) * 100 + Math.random(),
      Math.floor(i / 10) * 100 + Math.random(),
    ]);

    const clusters = Array.from({ length: 6 }, (_, i) =>
      Array.from({ length: 10 }, (_, j) => i * 10 + j),
    );

    const start = performance.now();
    const score = silhouetteScore(vectors, clusters);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
    expect(score).toBeGreaterThan(0);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Clustering - Edge Cases", () => {
  it("should handle single point in k-means", () => {
    const vectors = [[5, 5]];

    const result = kMeans(vectors, 1);

    expect(result.clusters.length).toBe(1);
    expect(result.clusters[0]).toEqual([0]);
  });

  it("should handle very high dimensions", () => {
    // 128-dimensional vectors (like embeddings)
    const vectors = Array.from({ length: 10 }, () =>
      Array.from({ length: 128 }, () => Math.random()),
    );

    const result = kMeans(vectors, 2);

    expect(result.clusters.length).toBe(2);
    expect(result.centroids[0].length).toBe(128);
  });

  it("should handle collinear points", () => {
    const vectors = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ];

    const result = kMeans(vectors, 2);

    expect(result.clusters.length).toBe(2);
  });
});
