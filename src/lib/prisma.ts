import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

// Instance singleton de PrismaClient avec configuration optimisée pour Neon
export const prisma = globalThis.__prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  // Configuration pour optimiser les performances avec Neon
  errorFormat: 'minimal',
  transactionOptions: {
    timeout: 30000, // 30s timeout pour les transactions
    maxWait: 30000, // 30s maximum wait time
    isolationLevel: 'ReadCommitted'
  }
});

// En développement, éviter les reconnexions multiples lors des hot reloads
if (process.env.NODE_ENV === 'development') {
  globalThis.__prisma = prisma;
}

// 🔄 Fonction pour tester et reconnecter si nécessaire
export async function ensureConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error: any) {
    console.warn('⚠️ Reconnexion à la base de données nécessaire:', error.message);
    try {
      await prisma.$disconnect();
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ Reconnexion réussie');
      return true;
    } catch (reconnectError: any) {
      console.error('❌ Échec de reconnexion:', reconnectError.message);
      return false;
    }
  }
}

// 🛡️ Gérer proprement la fermeture des connexions pour éviter les fuites
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    console.log(`⚠️ ${signal} déjà en cours de traitement, forcer l'arrêt...`);
    process.exit(1);
  }
  
  isShuttingDown = true;
  console.log(`🔄 ${signal} reçu, fermeture propre des connexions Prisma...`);
  
  try {
    await prisma.$disconnect();
    console.log('✅ Connexions Prisma fermées proprement');
  } catch (error) {
    console.error('❌ Erreur lors de la fermeture Prisma:', error);
  } finally {
    process.exit(0);
  }
};

// Capture tous les signaux d'arrêt importants
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon

process.on('beforeExit', async (code) => {
  if (!isShuttingDown) {
    console.log(`🔄 beforeExit (code: ${code}), fermeture des connexions Prisma...`);
    await prisma.$disconnect().catch(err => 
      console.warn('⚠️ Erreur fermeture beforeExit:', err)
    );
  }
});

// Gérer les erreurs non catchées pour éviter les connexions pendantes
process.on('uncaughtException', async (error) => {
  console.error('❌ Exception non gérée:', error);
  if (!isShuttingDown) {
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ Promise rejetée non gérée:', reason, 'Promise:', promise);
  if (!isShuttingDown) {
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(1);
});

export default prisma; 