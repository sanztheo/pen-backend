import { prisma } from "../lib/prisma.js";

// Interface pour les éléments de layout du dashboard
export interface DashboardLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface DashboardLayout {
  visibleCharts: string[];
  layout?: DashboardLayoutItem[];
}

/**
 * Service pour gérer la disposition du dashboard de statistiques de quiz
 */
export const DashboardLayoutService = {
  /**
   * Récupère la disposition sauvegardée pour un utilisateur
   */
  async getUserLayout(userId: string): Promise<DashboardLayout | null> {
    const layout = await prisma.userDashboardLayout.findUnique({
      where: { userId },
      select: {
        visibleCharts: true,
        layout: true,
      },
    });

    if (!layout) return null;

    return {
      visibleCharts: layout.visibleCharts as string[],
      layout: layout.layout as unknown as DashboardLayoutItem[],
    };
  },

  /**
   * Sauvegarde la disposition pour un utilisateur
   */
  async saveUserLayout(
    userId: string,
    data: DashboardLayout,
  ): Promise<DashboardLayout> {
    const layout = await prisma.userDashboardLayout.upsert({
      where: { userId },
      create: {
        userId,
        visibleCharts: data.visibleCharts,
        layout: (data.layout || []) as unknown as Parameters<
          typeof prisma.userDashboardLayout.create
        >[0]["data"]["layout"],
      },
      update: {
        visibleCharts: data.visibleCharts,
        layout: (data.layout || []) as unknown as Parameters<
          typeof prisma.userDashboardLayout.update
        >[0]["data"]["layout"],
        updatedAt: new Date(),
      },
      select: {
        visibleCharts: true,
        layout: true,
      },
    });

    return {
      visibleCharts: layout.visibleCharts as string[],
      layout: layout.layout as unknown as DashboardLayoutItem[],
    };
  },

  /**
   * Réinitialise la disposition aux valeurs par défaut
   */
  async resetUserLayout(userId: string): Promise<void> {
    await prisma.userDashboardLayout
      .delete({
        where: { userId },
      })
      .catch(() => {
        // Si le layout n'existe pas, on ignore l'erreur
      });
  },
};
