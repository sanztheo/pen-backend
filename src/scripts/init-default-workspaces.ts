/**
 * 🔄 SCRIPT D'INITIALISATION DES WORKSPACES PAR DÉFAUT
 * Crée automatiquement un workspace "Mon Espace" pour tous les utilisateurs existants
 */

import { DefaultWorkspaceService } from '../services/defaultWorkspace.js';
import { prisma } from '../lib/prisma.js';
import { ensureConnection } from '../lib/prisma.js';

async function initDefaultWorkspaces() {
  console.log('🚀 [INIT-WORKSPACES] Début de l\'initialisation des workspaces par défaut...');
  
  try {
    // Vérifier la connexion
    const isConnected = await ensureConnection();
    if (!isConnected) {
      throw new Error('Impossible de se connecter à la base de données');
    }
    
    // Initialiser les workspaces pour utilisateurs existants
    await DefaultWorkspaceService.initializeForExistingUsers();
    
    console.log('✅ [INIT-WORKSPACES] Initialisation terminée avec succès');
    
  } catch (error) {
    console.error('❌ [INIT-WORKSPACES] Erreur lors de l\'initialisation:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Exécuter le script si appelé directement
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  initDefaultWorkspaces();
}

export { initDefaultWorkspaces };