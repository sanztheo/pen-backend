/**
 * Script pour invalider le cache de contexte quiz
 * Utile après un bug fix du système de cache
 */
import { redis } from "../src/lib/redis.js";

async function invalidateQuizCache() {
  try {
    console.log("🔍 Recherche des clés de cache quiz-context...");
    
    const keys = await redis.keys("quiz-context:*");
    
    if (keys.length === 0) {
      console.log("✅ Aucun cache à invalider");
      return;
    }
    
    console.log(`🗑️ Invalidation de ${keys.length} cache(s)...`);
    await redis.del(...keys);
    
    console.log(`✅ ${keys.length} cache(s) invalidé(s) avec succès`);
  } catch (error) {
    console.error("❌ Erreur:", error);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

invalidateQuizCache();
