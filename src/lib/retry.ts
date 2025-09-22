import { ensureConnection } from './prisma.js';

// 🔄 Fonction helper pour retry avec backoff
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Vérifier la connexion avant chaque tentative
      if (attempt > 1) {
        const connectionOk = await ensureConnection();
        if (!connectionOk) {
          throw new Error(`Connexion impossible après ${attempt} tentatives`);
        }
      }
      
      return await operation();
    } catch (error: any) {
      const isConnectionError = error.message?.includes("Can't reach database server") || 
                               error.message?.includes("Connection") ||
                               error.code === 'P1001';
      
      if (attempt === maxRetries || !isConnectionError) {
        console.error(`❌ Échec final après ${attempt} tentatives:`, error.message);
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
      console.warn(`⚠️ Tentative ${attempt}/${maxRetries} échouée, retry dans ${delay}ms:`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Nombre maximum de tentatives atteint');
}
