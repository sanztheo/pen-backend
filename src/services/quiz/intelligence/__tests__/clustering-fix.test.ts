/**
 * 🧪 Test de validation du fix clustering
 * Vérifie que 3 pages avec sujets différents créent plusieurs clusters
 */

import { describe, expect, it } from "@jest/globals";
import { kMeans } from "../../../../utils/clustering.js";

describe("Clustering Fix - Multiple clusters avec peu de pages", () => {
  it("devrait créer k=2 clusters pour 3 pages", () => {
    // Simuler 3 embeddings très différents (sujets distincts)
    const embeddings = [
      // Page 1: Physique (Newton)
      [1.0, 0.0, 0.0, 0.2, 0.1],
      // Page 2: Écologie (Bilan)
      [0.0, 1.0, 0.0, 0.1, 0.2],
      // Page 3: IA (Intelligence Artificielle)
      [0.0, 0.0, 1.0, 0.3, 0.1],
    ];

    // Calcul de k selon la nouvelle formule
    // k = Math.min(maxClusters, Math.max(2, Math.ceil(3 / 2.5)))
    // k = Math.min(10, Math.max(2, Math.ceil(1.2)))
    // k = Math.min(10, Math.max(2, 2))
    // k = 2
    const k = Math.min(10, Math.max(2, Math.ceil(embeddings.length / 2.5)));

    expect(k).toBe(2);

    // Exécuter k-means
    const result = kMeans(embeddings, k);

    // Devrait créer 2 clusters (au moins)
    const nonEmptyClusters = result.clusters.filter((c) => c.length > 0);
    expect(nonEmptyClusters.length).toBeGreaterThanOrEqual(2);

    console.log(
      `✅ K-means créé ${nonEmptyClusters.length} clusters pour 3 pages`,
    );
    console.log(
      `   Cluster 1: ${result.clusters[0].length} pages, Cluster 2: ${result.clusters[1]?.length || 0} pages`,
    );
  });

  it("devrait séparer des embeddings orthogonaux en clusters différents", () => {
    // 3 vecteurs orthogonaux (très différents)
    const embeddings = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];

    const k = 2;
    const result = kMeans(embeddings, k);

    // Au moins 2 clusters non-vides
    const nonEmptyClusters = result.clusters.filter((c) => c.length > 0);
    expect(nonEmptyClusters.length).toBe(2);
  });

  it("ancienne formule: k=1 pour 3 pages (BUG)", () => {
    const pageCount = 3;
    const maxClusters = 10;

    // Ancienne formule (buggée)
    const oldK = Math.min(maxClusters, Math.ceil(pageCount / 4));
    expect(oldK).toBe(1); // BUG: 1 seul cluster

    // Nouvelle formule (fixée)
    const newK = Math.min(maxClusters, Math.max(2, Math.ceil(pageCount / 2.5)));
    expect(newK).toBe(2); // FIX: 2 clusters minimum

    console.log(`   Ancienne: k=${oldK} ❌`);
    console.log(`   Nouvelle: k=${newK} ✅`);
  });

  it("table de vérification: k pour différents nombres de pages", () => {
    const testCases = [
      { pages: 2, expectedK: 2 }, // Math.max(2, ceil(2/2.5)) = 2
      { pages: 3, expectedK: 2 }, // Math.max(2, ceil(3/2.5)) = 2
      { pages: 4, expectedK: 2 }, // Math.max(2, ceil(4/2.5)) = 2
      { pages: 5, expectedK: 2 }, // Math.max(2, ceil(5/2.5)) = 2
      { pages: 6, expectedK: 3 }, // Math.max(2, ceil(6/2.5)) = 3
      { pages: 8, expectedK: 4 }, // Math.max(2, ceil(8/2.5)) = 4
      { pages: 10, expectedK: 4 }, // Math.max(2, ceil(10/2.5)) = 4
      { pages: 13, expectedK: 6 }, // Math.max(2, ceil(13/2.5)) = 6
    ];

    console.log("\n📊 Table k optimal:");
    console.log("Pages | k ancien | k nouveau");
    console.log("------|----------|----------");

    for (const { pages, expectedK } of testCases) {
      const oldK = Math.min(10, Math.ceil(pages / 4));
      const newK = Math.min(10, Math.max(2, Math.ceil(pages / 2.5)));

      console.log(
        `  ${pages.toString().padStart(2)}  |    ${oldK}     |     ${newK}`,
      );
      expect(newK).toBe(expectedK);
    }
  });
});
