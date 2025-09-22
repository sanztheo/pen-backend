import { SequentialQuizConfig } from './types.js';

/**
 * Stockage temporaire en mémoire pour les séquences de quiz
 * À remplacer par la vraie base de données après migration
 */
class TempSequenceStorage {
  private sequences: Map<string, SequentialQuizConfig> = new Map();

  save(config: SequentialQuizConfig): void {
    this.sequences.set(config.id, { ...config });
  }

  set(sequenceId: string, config: SequentialQuizConfig): void {
    this.sequences.set(sequenceId, { ...config });
  }

  get(sequenceId: string): SequentialQuizConfig | null {
    const config = this.sequences.get(sequenceId);
    if (config) {
      return { ...config };
    }
    console.log('❌ [TempStorage] Séquence non trouvée:', sequenceId);
    return null;
  }

  update(sequenceId: string, updates: Partial<SequentialQuizConfig>): boolean {
    const existing = this.sequences.get(sequenceId);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.sequences.set(sequenceId, updated);
      return true;
    }
    return false;
  }

  list(): SequentialQuizConfig[] {
    return Array.from(this.sequences.values()).map(config => ({ ...config }));
  }

  delete(sequenceId: string): boolean {
    const deleted = this.sequences.delete(sequenceId);
    if (deleted) {
      console.log('🗑️ [TempStorage] Séquence supprimée:', sequenceId);
    }
    return deleted;
  }

  clear(): void {
    this.sequences.clear();
  }

  getUserSequences(userId: string): SequentialQuizConfig[] {
    return Array.from(this.sequences.values())
      .filter(config => config.id.includes(userId))
      .map(config => ({ ...config }));
  }
}

// Instance globale pour le stockage temporaire
export const tempSequenceStorage = new TempSequenceStorage();

export default tempSequenceStorage; 