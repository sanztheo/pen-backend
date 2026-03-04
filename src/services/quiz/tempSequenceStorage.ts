import { SequentialQuizConfig } from "./types.js";
import { logger } from "../../utils/logger.js";

const SEQUENCE_TTL_MS = 2 * 60 * 60 * 1000; // 2 heures
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface TimestampedConfig {
  config: SequentialQuizConfig;
  createdAt: number;
}

/**
 * Stockage temporaire en mémoire pour les séquences de quiz
 * À remplacer par la vraie base de données après migration
 */
class TempSequenceStorage {
  private sequences: Map<string, TimestampedConfig> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.evictExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }

  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [id, entry] of this.sequences) {
      if (now - entry.createdAt > SEQUENCE_TTL_MS) {
        this.sequences.delete(id);
        evicted++;
      }
    }
    if (evicted > 0) {
      logger.log(
        `🧹 [TempStorage] ${evicted} séquences expirées supprimées, ${this.sequences.size} restantes`,
      );
    }
  }

  save(config: SequentialQuizConfig): void {
    this.sequences.set(config.id, { config: { ...config }, createdAt: Date.now() });
  }

  set(sequenceId: string, config: SequentialQuizConfig): void {
    this.sequences.set(sequenceId, { config: { ...config }, createdAt: Date.now() });
  }

  get(sequenceId: string): SequentialQuizConfig | null {
    const entry = this.sequences.get(sequenceId);
    if (entry) {
      return { ...entry.config };
    }
    logger.log("❌ [TempStorage] Séquence non trouvée:", sequenceId);
    return null;
  }

  update(sequenceId: string, updates: Partial<SequentialQuizConfig>): boolean {
    const entry = this.sequences.get(sequenceId);
    if (entry) {
      const updated = { ...entry.config, ...updates };
      this.sequences.set(sequenceId, { config: updated, createdAt: entry.createdAt });
      return true;
    }
    return false;
  }

  list(): SequentialQuizConfig[] {
    return Array.from(this.sequences.values()).map((entry) => ({ ...entry.config }));
  }

  delete(sequenceId: string): boolean {
    const deleted = this.sequences.delete(sequenceId);
    if (deleted) {
      logger.log("🗑️ [TempStorage] Séquence supprimée:", sequenceId);
    }
    return deleted;
  }

  clear(): void {
    this.sequences.clear();
  }

  getUserSequences(userId: string): SequentialQuizConfig[] {
    return Array.from(this.sequences.values())
      .filter((entry) => entry.config.id.includes(userId))
      .map((entry) => ({ ...entry.config }));
  }
}

// Instance globale pour le stockage temporaire
export const tempSequenceStorage = new TempSequenceStorage();
