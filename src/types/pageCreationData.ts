/**
 * Structure des données de création de page sauvegardées en JSON
 * Utilisé pour persister l'état complet du modal PageCreationStreamDisplay
 */
export interface PageCreationData {
  /** ID de la page créée (null si supprimée et pas encore recréée) */
  pageId: string | null;
  
  /** Titre de la page */
  pageTitle: string;
  
  /** Contenu markdown complet de la page */
  pageContent: string;
  
  /** ID du projet parent (optionnel, peut être null) */
  projectId?: string | null;
  
  /** Statut de la page */
  status: 'creating' | 'created' | 'deleted' | 'recreating';
  
  /** true = génération terminée, false = en cours de streaming */
  isComplete: boolean;
  
  /** Date de création originale */
  createdAt: string;
  
  /** Date de suppression (null si pas supprimée) */
  deletedAt?: string | null;
  
  /** Date de recréation (null si pas recréée) */
  recreatedAt?: string | null;
}

