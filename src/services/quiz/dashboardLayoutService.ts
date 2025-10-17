import { prisma } from '../../lib/prisma';

export interface DashboardLayout {
  layout: LayoutItem[];
  visibleCharts: string[];
}

export interface LayoutItem {
  i: string; // Chart ID
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

/**
 * Layout par défaut pour les nouveaux utilisateurs
 */
const DEFAULT_LAYOUT: DashboardLayout = {
  layout: [
    { i: 'progression-area', x: 0, y: 0, w: 8, h: 4, minW: 4, minH: 3 },
    { i: 'subject-performance-bar', x: 8, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    { i: 'difficulty-radar', x: 0, y: 4, w: 4, h: 4, minW: 3, minH: 3 },
    { i: 'time-analytics-line', x: 4, y: 4, w: 4, h: 4, minW: 3, minH: 3 }
  ],
  visibleCharts: [
    'progression-area',
    'subject-performance-bar',
    'difficulty-radar',
    'time-analytics-line'
  ]
};

export class DashboardLayoutService {
  /**
   * Récupère le layout d'un utilisateur (ou crée le défaut s'il n'existe pas)
   */
  static async getUserLayout(userId: string): Promise<DashboardLayout> {
    try {
      let userLayout = await prisma.userDashboardLayout.findUnique({
        where: { userId }
      });

      // Si pas de layout, créer le layout par défaut
      if (!userLayout) {
        userLayout = await prisma.userDashboardLayout.create({
          data: {
            userId,
            layout: DEFAULT_LAYOUT.layout as any,
            visibleCharts: DEFAULT_LAYOUT.visibleCharts as any
          }
        });
      }

      return {
        layout: userLayout.layout as LayoutItem[],
        visibleCharts: userLayout.visibleCharts as string[]
      };
    } catch (error) {
      console.error('❌ [DashboardLayoutService] Erreur récupération layout:', error);
      // En cas d'erreur, retourner le layout par défaut
      return DEFAULT_LAYOUT;
    }
  }

  /**
   * Sauvegarde le layout d'un utilisateur
   */
  static async saveUserLayout(
    userId: string,
    layout: LayoutItem[],
    visibleCharts: string[]
  ): Promise<DashboardLayout> {
    try {
      const userLayout = await prisma.userDashboardLayout.upsert({
        where: { userId },
        create: {
          userId,
          layout: layout as any,
          visibleCharts: visibleCharts as any
        },
        update: {
          layout: layout as any,
          visibleCharts: visibleCharts as any
        }
      });

      console.log(`✅ [DashboardLayoutService] Layout sauvegardé pour user ${userId}`);

      return {
        layout: userLayout.layout as LayoutItem[],
        visibleCharts: userLayout.visibleCharts as string[]
      };
    } catch (error) {
      console.error('❌ [DashboardLayoutService] Erreur sauvegarde layout:', error);
      throw new Error('Impossible de sauvegarder le layout');
    }
  }

  /**
   * Réinitialise le layout au défaut
   */
  static async resetToDefault(userId: string): Promise<DashboardLayout> {
    try {
      await prisma.userDashboardLayout.upsert({
        where: { userId },
        create: {
          userId,
          layout: DEFAULT_LAYOUT.layout as any,
          visibleCharts: DEFAULT_LAYOUT.visibleCharts as any
        },
        update: {
          layout: DEFAULT_LAYOUT.layout as any,
          visibleCharts: DEFAULT_LAYOUT.visibleCharts as any
        }
      });

      console.log(`✅ [DashboardLayoutService] Layout réinitialisé pour user ${userId}`);

      return DEFAULT_LAYOUT;
    } catch (error) {
      console.error('❌ [DashboardLayoutService] Erreur réinitialisation layout:', error);
      throw new Error('Impossible de réinitialiser le layout');
    }
  }

  /**
   * Ajoute un graphique au layout
   */
  static async addChart(
    userId: string,
    chartId: string,
    position?: { x: number; y: number; w: number; h: number }
  ): Promise<DashboardLayout> {
    try {
      const currentLayout = await this.getUserLayout(userId);

      // Vérifier si le graphique n'est pas déjà visible
      if (currentLayout.visibleCharts.includes(chartId)) {
        return currentLayout;
      }

      // Position par défaut si non spécifiée
      const defaultPosition = position || {
        x: 0,
        y: currentLayout.layout.length * 4,
        w: 4,
        h: 4
      };

      const newLayoutItem: LayoutItem = {
        i: chartId,
        ...defaultPosition,
        minW: 3,
        minH: 3
      };

      const updatedLayout = [...currentLayout.layout, newLayoutItem];
      const updatedVisibleCharts = [...currentLayout.visibleCharts, chartId];

      return await this.saveUserLayout(userId, updatedLayout, updatedVisibleCharts);
    } catch (error) {
      console.error('❌ [DashboardLayoutService] Erreur ajout graphique:', error);
      throw new Error('Impossible d\'ajouter le graphique');
    }
  }

  /**
   * Retire un graphique du layout
   */
  static async removeChart(userId: string, chartId: string): Promise<DashboardLayout> {
    try {
      const currentLayout = await this.getUserLayout(userId);

      const updatedLayout = currentLayout.layout.filter(item => item.i !== chartId);
      const updatedVisibleCharts = currentLayout.visibleCharts.filter(id => id !== chartId);

      return await this.saveUserLayout(userId, updatedLayout, updatedVisibleCharts);
    } catch (error) {
      console.error('❌ [DashboardLayoutService] Erreur suppression graphique:', error);
      throw new Error('Impossible de retirer le graphique');
    }
  }

  /**
   * Retourne le layout par défaut
   */
  static getDefaultLayout(): DashboardLayout {
    return DEFAULT_LAYOUT;
  }
}

