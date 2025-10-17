import { prisma } from '../../lib/prisma.js';

/**
 * Helper pour calculer la date de début selon la période
 */
function getStartDate(period: 'week' | 'month' | 'year'): Date {
  const now = new Date();
  const startDate = new Date();

  switch (period) {
    case 'week':
      startDate.setDate(now.getDate() - 7);
      break;
    case 'month':
      startDate.setMonth(now.getMonth() - 1);
      break;
    case 'year':
      startDate.setFullYear(now.getFullYear() - 1);
      break;
  }

  return startDate;
}

export interface AdvancedQuizStats {
  userId: string;
  totalQuizzes: number;
  completedQuizzes: number;
  averageScore: number;
  bestScore: number;
  worstScore: number;
  totalTimeSpent: number; // en minutes
  averageTimePerQuiz: number;
  averageTimePerQuestion: number;
  lastQuizDate: string | null;
  currentStreak: number; // jours consécutifs
  longestStreak: number;
}

export interface ProgressionDataPoint {
  date: string;
  score: number;
  timeSpent: number;
  quizId: string;
  quizTitle: string;
  questionCount: number;
}

export interface SubjectPerformance {
  subject: string;
  averageScore: number;
  quizCount: number;
  totalTimeSpent: number;
  bestScore: number;
  worstScore: number;
  trend: 'improving' | 'stable' | 'declining';
  lastAttemptDate: string;
}

export interface DifficultyAnalysis {
  facile: {
    averageScore: number;
    count: number;
    averageTime: number;
  };
  moyen: {
    averageScore: number;
    count: number;
    averageTime: number;
  };
  difficile: {
    averageScore: number;
    count: number;
    averageTime: number;
  };
}

export interface TimeAnalytics {
  totalTimeSpent: number;
  averageQuizTime: number;
  averageTimePerQuestion: number;
  efficiency: number; // score moyen / temps moyen
  timeByDifficulty: {
    facile: number;
    moyen: number;
    difficile: number;
  };
  timeBySchoolLevel: Record<string, number>;
}

export interface PageSourceUsage {
  pageId: string;
  pageTitle: string;
  usageCount: number;
  averageScore: number;
  lastUsedDate: string;
}

export interface QuestionTypeStats {
  type: string;
  count: number;
  averageScore: number;
  totalQuestions: number;
}

export class StatsService {
  /**
   * Récupère les statistiques avancées complètes d'un utilisateur
   */
  static async getAdvancedUserStats(
    userId: string,
    period: 'week' | 'month' | 'year' = 'month'
  ): Promise<AdvancedQuizStats> {
    const startDate = getStartDate(period);
    
    const allQuizzes = await prisma.quiz.findMany({
      where: { 
        userId,
        createdAt: { gte: startDate }
      },
      include: { result: true },
      orderBy: { completedAt: 'desc' }
    });

    const completedQuizzes = allQuizzes.filter(q => q.isCompleted);

    if (completedQuizzes.length === 0) {
      return {
        userId,
        totalQuizzes: allQuizzes.length,
        completedQuizzes: 0,
        averageScore: 0,
        bestScore: 0,
        worstScore: 0,
        totalTimeSpent: 0,
        averageTimePerQuiz: 0,
        averageTimePerQuestion: 0,
        lastQuizDate: null,
        currentStreak: 0,
        longestStreak: 0
      };
    }

    const scores = completedQuizzes
      .map(q => q.result?.percentage || 0)
      .filter(s => s > 0);

    const totalTimeSpent = completedQuizzes.reduce(
      (sum, q) => sum + (q.timeSpent || 0),
      0
    );

    const totalQuestions = completedQuizzes.reduce((sum, q) => {
      const questions = (q.questions as any[]) || [];
      return sum + questions.length;
    }, 0);

    // Calculer les streaks
    const { currentStreak, longestStreak } = this.calculateStreaks(completedQuizzes);

    return {
      userId,
      totalQuizzes: allQuizzes.length,
      completedQuizzes: completedQuizzes.length,
      averageScore: scores.length > 0 
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length 
        : 0,
      bestScore: scores.length > 0 ? Math.max(...scores) : 0,
      worstScore: scores.length > 0 ? Math.min(...scores) : 0,
      totalTimeSpent: Math.round(totalTimeSpent / 60), // convertir en minutes
      averageTimePerQuiz: completedQuizzes.length > 0 
        ? Math.round(totalTimeSpent / completedQuizzes.length / 60) 
        : 0,
      averageTimePerQuestion: totalQuestions > 0 
        ? Math.round(totalTimeSpent / totalQuestions) 
        : 0,
      lastQuizDate: completedQuizzes[0]?.completedAt?.toISOString() || null,
      currentStreak,
      longestStreak
    };
  }

  /**
   * Récupère la progression dans le temps
   */
  static async getProgressionOverTime(
    userId: string,
    period: 'week' | 'month' | 'year' = 'month'
  ): Promise<ProgressionDataPoint[]> {
    const daysAgo = period === 'week' ? 7 : period === 'month' ? 30 : 365;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    const quizzes = await prisma.quiz.findMany({
      where: {
        userId,
        isCompleted: true,
        completedAt: { gte: startDate }
      },
      include: { result: true },
      orderBy: { completedAt: 'asc' }
    });

    return quizzes.map(quiz => ({
      date: quiz.completedAt?.toISOString() || quiz.createdAt.toISOString(),
      score: quiz.result?.percentage || 0,
      timeSpent: Math.round((quiz.timeSpent || 0) / 60), // en minutes
      quizId: quiz.id,
      quizTitle: quiz.title,
      questionCount: ((quiz.questions as any[]) || []).length
    }));
  }

  /**
   * Analyse la performance par matière/spécialité
   */
  static async getSubjectBreakdown(
    userId: string,
    period: 'week' | 'month' | 'year' = 'month'
  ): Promise<SubjectPerformance[]> {
    const startDate = getStartDate(period);
    
    const quizzes = await prisma.quiz.findMany({
      where: {
        userId,
        isCompleted: true,
        createdAt: { gte: startDate }
      },
      include: { result: true },
      orderBy: { completedAt: 'desc' }
    });

    // Grouper par spécialités sélectionnées ou par higherEdField
    const subjectMap = new Map<string, any[]>();

    quizzes.forEach(quiz => {
      // Essayer d'extraire les spécialités
      const specialties = quiz.selectedSpecialties || [];
      
      if (specialties.length > 0) {
        specialties.forEach(specialty => {
          if (!subjectMap.has(specialty)) {
            subjectMap.set(specialty, []);
          }
          subjectMap.get(specialty)!.push(quiz);
        });
      } else if (quiz.higherEdField) {
        if (!subjectMap.has(quiz.higherEdField)) {
          subjectMap.set(quiz.higherEdField, []);
        }
        subjectMap.get(quiz.higherEdField)!.push(quiz);
      } else {
        // Grouper par niveau scolaire si pas de spécialité
        const level = quiz.schoolLevel;
        if (!subjectMap.has(level)) {
          subjectMap.set(level, []);
        }
        subjectMap.get(level)!.push(quiz);
      }
    });

    const subjectPerformances: SubjectPerformance[] = [];

    subjectMap.forEach((quizzes, subject) => {
      const scores = quizzes
        .map(q => q.result?.percentage || 0)
        .filter(s => s > 0);

      const totalTime = quizzes.reduce(
        (sum, q) => sum + (q.timeSpent || 0),
        0
      );

      // Calculer la tendance
      const trend = this.calculateTrend(quizzes);

      subjectPerformances.push({
        subject,
        averageScore: scores.length > 0 
          ? scores.reduce((sum, s) => sum + s, 0) / scores.length 
          : 0,
        quizCount: quizzes.length,
        totalTimeSpent: Math.round(totalTime / 60),
        bestScore: scores.length > 0 ? Math.max(...scores) : 0,
        worstScore: scores.length > 0 ? Math.min(...scores) : 0,
        trend,
        lastAttemptDate: quizzes[0]?.completedAt?.toISOString() || quizzes[0]?.createdAt.toISOString()
      });
    });

    return subjectPerformances.sort((a, b) => b.quizCount - a.quizCount);
  }

  /**
   * Analyse la performance par niveau de difficulté
   */
  static async getDifficultyAnalysis(
    userId: string,
    period: 'week' | 'month' | 'year' = 'month'
  ): Promise<DifficultyAnalysis> {
    const startDate = getStartDate(period);
    
    const quizzes = await prisma.quiz.findMany({
      where: {
        userId,
        isCompleted: true,
        createdAt: { gte: startDate }
      },
      include: { result: true }
    });

    const difficultyGroups = {
      facile: quizzes.filter(q => q.difficulty === 'facile'),
      moyen: quizzes.filter(q => q.difficulty === 'moyen'),
      difficile: quizzes.filter(q => q.difficulty === 'difficile')
    };

    const analysis: DifficultyAnalysis = {
      facile: this.analyzeDifficultyGroup(difficultyGroups.facile),
      moyen: this.analyzeDifficultyGroup(difficultyGroups.moyen),
      difficile: this.analyzeDifficultyGroup(difficultyGroups.difficile)
    };

    return analysis;
  }

  /**
   * Analyse le temps passé
   */
  static async getTimeAnalytics(
    userId: string,
    period: 'week' | 'month' | 'year' = 'month'
  ): Promise<TimeAnalytics> {
    const startDate = getStartDate(period);
    
    const quizzes = await prisma.quiz.findMany({
      where: {
        userId,
        isCompleted: true,
        createdAt: { gte: startDate }
      },
      include: { result: true }
    });

    const totalTimeSpent = quizzes.reduce(
      (sum, q) => sum + (q.timeSpent || 0),
      0
    );

    const totalQuestions = quizzes.reduce((sum, q) => {
      const questions = (q.questions as any[]) || [];
      return sum + questions.length;
    }, 0);

    const scores = quizzes
      .map(q => q.result?.percentage || 0)
      .filter(s => s > 0);
    
    const averageScore = scores.length > 0 
      ? scores.reduce((sum, s) => sum + s, 0) / scores.length 
      : 0;

    const averageQuizTime = quizzes.length > 0 
      ? totalTimeSpent / quizzes.length 
      : 0;

    // Temps par difficulté
    const timeByDifficulty = {
      facile: this.calculateAverageTime(quizzes.filter(q => q.difficulty === 'facile')),
      moyen: this.calculateAverageTime(quizzes.filter(q => q.difficulty === 'moyen')),
      difficile: this.calculateAverageTime(quizzes.filter(q => q.difficulty === 'difficile'))
    };

    // Temps par niveau scolaire
    const timeBySchoolLevel: Record<string, number> = {};
    const levels = new Set(quizzes.map(q => q.schoolLevel));
    
    levels.forEach(level => {
      const levelQuizzes = quizzes.filter(q => q.schoolLevel === level);
      timeBySchoolLevel[level] = this.calculateAverageTime(levelQuizzes);
    });

    return {
      totalTimeSpent: Math.round(totalTimeSpent / 60),
      averageQuizTime: Math.round(averageQuizTime / 60),
      averageTimePerQuestion: totalQuestions > 0 
        ? Math.round(totalTimeSpent / totalQuestions) 
        : 0,
      efficiency: averageQuizTime > 0 ? averageScore / (averageQuizTime / 60) : 0,
      timeByDifficulty: {
        facile: Math.round(timeByDifficulty.facile / 60),
        moyen: Math.round(timeByDifficulty.moyen / 60),
        difficile: Math.round(timeByDifficulty.difficile / 60)
      },
      timeBySchoolLevel: Object.fromEntries(
        Object.entries(timeBySchoolLevel).map(([k, v]) => [k, Math.round(v / 60)])
      )
    };
  }

  /**
   * Stats sur les pages sources utilisées
   */
  static async getPageSourcesUsage(
    userId: string,
    period: 'week' | 'month' | 'year' = 'month'
  ): Promise<PageSourceUsage[]> {
    const startDate = getStartDate(period);
    
    const quizzes = await prisma.quiz.findMany({
      where: {
        userId,
        isCompleted: true,
        hasDocuments: true,
        createdAt: { gte: startDate }
      },
      include: { result: true }
    });

    const pageUsageMap = new Map<string, any[]>();

    quizzes.forEach(quiz => {
      const sourceDocuments = (quiz.sourceDocuments as any);
      
      // sourceDocuments peut être soit un tableau directement, soit un objet avec une propriété pages
      let pages = [];
      if (Array.isArray(sourceDocuments)) {
        pages = sourceDocuments;
      } else if (sourceDocuments && Array.isArray(sourceDocuments.pages)) {
        pages = sourceDocuments.pages;
      }

      pages.forEach((page: any) => {
        const pageId = page.id || page.pageId || 'unknown';
        if (!pageUsageMap.has(pageId)) {
          pageUsageMap.set(pageId, []);
        }
        pageUsageMap.get(pageId)!.push({
          quiz,
          pageTitle: page.title || page.pageTitle || 'Sans titre'
        });
      });
    });

    const pageUsages: PageSourceUsage[] = [];

    pageUsageMap.forEach((items, pageId) => {
      const scores = items
        .map(item => item.quiz.result?.percentage || 0)
        .filter(s => s > 0);

      const lastUsed = items[items.length - 1];

      pageUsages.push({
        pageId,
        pageTitle: items[0].pageTitle,
        usageCount: items.length,
        averageScore: scores.length > 0 
          ? scores.reduce((sum, s) => sum + s, 0) / scores.length 
          : 0,
        lastUsedDate: lastUsed.quiz.completedAt?.toISOString() || lastUsed.quiz.createdAt.toISOString()
      });
    });

    return pageUsages.sort((a, b) => b.usageCount - a.usageCount);
  }

  /**
   * Stats sur les types de questions
   */
  static async getQuestionTypeStats(
    userId: string,
    period: 'week' | 'month' | 'year' = 'month'
  ): Promise<QuestionTypeStats[]> {
    const startDate = getStartDate(period);
    
    const quizzes = await prisma.quiz.findMany({
      where: {
        userId,
        isCompleted: true,
        createdAt: { gte: startDate }
      },
      include: { result: true }
    });

    const typeMap = new Map<string, { count: number; totalQuestions: number; totalScore: number; maxScore: number }>();

    quizzes.forEach(quiz => {
      const questions = (quiz.questions as any[]) || [];
      const detailedScoring = quiz.result?.detailedScoring as any[] || [];

      questions.forEach((question, index) => {
        const type = question.type || 'UNKNOWN';
        const scoring = detailedScoring[index];

        if (!typeMap.has(type)) {
          typeMap.set(type, { count: 0, totalQuestions: 0, totalScore: 0, maxScore: 0 });
        }

        const stats = typeMap.get(type)!;
        stats.count++;
        stats.totalQuestions++;
        
        if (scoring) {
          stats.totalScore += scoring.score || 0;
          stats.maxScore += scoring.maxScore || 1;
        }
      });
    });

    const questionTypeStats: QuestionTypeStats[] = [];

    typeMap.forEach((stats, type) => {
      questionTypeStats.push({
        type,
        count: stats.count,
        totalQuestions: stats.totalQuestions,
        averageScore: stats.maxScore > 0 
          ? (stats.totalScore / stats.maxScore) * 100 
          : 0
      });
    });

    return questionTypeStats.sort((a, b) => b.count - a.count);
  }

  // ===== Méthodes utilitaires privées =====

  private static analyzeDifficultyGroup(quizzes: any[]) {
    const scores = quizzes
      .map(q => q.result?.percentage || 0)
      .filter(s => s > 0);

    const totalTime = quizzes.reduce(
      (sum, q) => sum + (q.timeSpent || 0),
      0
    );

    return {
      averageScore: scores.length > 0 
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length 
        : 0,
      count: quizzes.length,
      averageTime: quizzes.length > 0 
        ? Math.round(totalTime / quizzes.length / 60) 
        : 0
    };
  }

  private static calculateAverageTime(quizzes: any[]): number {
    if (quizzes.length === 0) return 0;
    const totalTime = quizzes.reduce(
      (sum, q) => sum + (q.timeSpent || 0),
      0
    );
    return totalTime / quizzes.length;
  }

  private static calculateTrend(quizzes: any[]): 'improving' | 'stable' | 'declining' {
    if (quizzes.length < 3) return 'stable';

    const recentQuizzes = quizzes.slice(0, Math.min(5, quizzes.length));
    const scores = recentQuizzes
      .map(q => q.result?.percentage || 0)
      .filter(s => s > 0);

    if (scores.length < 2) return 'stable';

    // Calculer la pente de régression linéaire simple
    const n = scores.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = scores.reduce((sum, s) => sum + s, 0);
    const sumXY = scores.reduce((sum, s, i) => sum + i * s, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    if (slope > 0.5) return 'improving';
    if (slope < -0.5) return 'declining';
    return 'stable';
  }

  private static calculateStreaks(quizzes: any[]): { currentStreak: number; longestStreak: number } {
    if (quizzes.length === 0) return { currentStreak: 0, longestStreak: 0 };

    const dates = quizzes
      .map(q => q.completedAt || q.createdAt)
      .filter(d => d)
      .map(d => new Date(d).toISOString().split('T')[0])
      .sort();

    const uniqueDates = [...new Set(dates)].reverse();

    let currentStreak = 1;
    let longestStreak = 1;
    let tempStreak = 1;

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Calculer le streak actuel
    if (uniqueDates[0] !== today && uniqueDates[0] !== yesterday) {
      currentStreak = 0;
    } else {
      for (let i = 0; i < uniqueDates.length - 1; i++) {
        const date1 = new Date(uniqueDates[i]);
        const date2 = new Date(uniqueDates[i + 1]);
        const diffDays = Math.floor((date1.getTime() - date2.getTime()) / 86400000);

        if (diffDays === 1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    // Calculer le streak le plus long
    for (let i = 0; i < uniqueDates.length - 1; i++) {
      const date1 = new Date(uniqueDates[i]);
      const date2 = new Date(uniqueDates[i + 1]);
      const diffDays = Math.floor((date1.getTime() - date2.getTime()) / 86400000);

      if (diffDays === 1) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 1;
      }
    }

    return { currentStreak, longestStreak: Math.max(longestStreak, currentStreak) };
  }
}

