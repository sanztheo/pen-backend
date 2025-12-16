// assistant/utils/helpers.ts - Fonctions utilitaires diverses

/**
 * Génère un ID unique pour les opérations
 */
export function generateOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Génère un ID unique pour les questions
 */
export function generateQuestionId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Génère un ID unique pour les quiz
 */
export function generateQuizId(): string {
  return `quiz_${Date.now()}`;
}

/**
 * Nettoyage des threads après opération
 */
export async function cleanupThread(threadId: string): Promise<void> {
  try {
    // Ici on pourrait ajouter une méthode de nettoyage si nécessaire
    console.log(`🧹 Thread ${threadId} marqué pour nettoyage`);
  } catch (error) {
    console.warn(`⚠️ Échec nettoyage thread ${threadId}:`, error);
  }
}

/**
 * Délai avec promesse
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tronque un texte à une longueur maximale
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + "...";
}

/**
 * Formate la taille en Ko/Mo
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}
