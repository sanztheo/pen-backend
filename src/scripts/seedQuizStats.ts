import { prisma } from '../lib/prisma';

/**
 * Script pour générer des quiz de test avec résultats variés
 * pour tester la page de statistiques
 * 
 * Usage: npx tsx src/scripts/seedQuizStats.ts
 */

const USER_ID = 'user_349VpAGrJ9dXN3fVbTxg4LtCh89'; // Votre ID utilisateur

interface QuizTestData {
  title: string;
  schoolLevel: string;
  difficulty: 'facile' | 'moyen' | 'difficile';
  specialties: string[];
  score: number;
  timeSpent: number; // en secondes
  daysAgo: number;
  questionTypes: string[];
  questionCount: number;
}

const testQuizzes: QuizTestData[] = [
  // Quiz récents (dernière semaine)
  {
    title: 'Quiz Mathématiques - Fonctions',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'moyen',
    specialties: ['MATHEMATIQUES'],
    score: 85,
    timeSpent: 720, // 12 min
    daysAgo: 1,
    questionTypes: ['MULTIPLE_CHOICE', 'OPEN_QUESTION'],
    questionCount: 10
  },
  {
    title: 'Quiz Physique - Mécanique',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'difficile',
    specialties: ['PHYSIQUE_CHIMIE'],
    score: 92,
    timeSpent: 900, // 15 min
    daysAgo: 2,
    questionTypes: ['MULTIPLE_CHOICE', 'OPEN_QUESTION'],
    questionCount: 12
  },
  {
    title: 'Quiz Histoire - Révolution française',
    schoolLevel: 'LYCEE_PREMIERE',
    difficulty: 'facile',
    specialties: ['HISTOIRE_GEO'],
    score: 78,
    timeSpent: 600, // 10 min
    daysAgo: 3,
    questionTypes: ['MULTIPLE_CHOICE', 'TRUE_FALSE'],
    questionCount: 15
  },
  {
    title: 'Quiz SVT - Génétique',
    schoolLevel: 'LYCEE_PREMIERE',
    difficulty: 'moyen',
    specialties: ['SVT'],
    score: 88,
    timeSpent: 840, // 14 min
    daysAgo: 4,
    questionTypes: ['MULTIPLE_CHOICE'],
    questionCount: 10
  },
  {
    title: 'Quiz Mathématiques - Probabilités',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'difficile',
    specialties: ['MATHEMATIQUES'],
    score: 65,
    timeSpent: 1080, // 18 min
    daysAgo: 5,
    questionTypes: ['MULTIPLE_CHOICE', 'OPEN_QUESTION'],
    questionCount: 8
  },
  
  // Quiz de la semaine dernière
  {
    title: 'Quiz SES - Économie',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'moyen',
    specialties: ['SES'],
    score: 82,
    timeSpent: 720,
    daysAgo: 7,
    questionTypes: ['MULTIPLE_CHOICE', 'OPEN_QUESTION'],
    questionCount: 12
  },
  {
    title: 'Quiz Physique - Électricité',
    schoolLevel: 'LYCEE_PREMIERE',
    difficulty: 'facile',
    specialties: ['PHYSIQUE_CHIMIE'],
    score: 94,
    timeSpent: 540,
    daysAgo: 8,
    questionTypes: ['MULTIPLE_CHOICE', 'TRUE_FALSE'],
    questionCount: 10
  },
  {
    title: 'Quiz Mathématiques - Géométrie',
    schoolLevel: 'LYCEE_PREMIERE',
    difficulty: 'moyen',
    specialties: ['MATHEMATIQUES'],
    score: 75,
    timeSpent: 900,
    daysAgo: 10,
    questionTypes: ['MULTIPLE_CHOICE'],
    questionCount: 15
  },
  {
    title: 'Quiz Histoire - Seconde Guerre mondiale',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'moyen',
    specialties: ['HISTOIRE_GEO'],
    score: 86,
    timeSpent: 780,
    daysAgo: 12,
    questionTypes: ['MULTIPLE_CHOICE', 'OPEN_QUESTION'],
    questionCount: 10
  },
  
  // Quiz plus anciens (2-3 semaines)
  {
    title: 'Quiz SVT - Écologie',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'facile',
    specialties: ['SVT'],
    score: 90,
    timeSpent: 600,
    daysAgo: 14,
    questionTypes: ['MULTIPLE_CHOICE', 'TRUE_FALSE'],
    questionCount: 12
  },
  {
    title: 'Quiz Mathématiques - Analyse',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'difficile',
    specialties: ['MATHEMATIQUES'],
    score: 72,
    timeSpent: 1200,
    daysAgo: 16,
    questionTypes: ['OPEN_QUESTION'],
    questionCount: 6
  },
  {
    title: 'Quiz Physique - Optique',
    schoolLevel: 'LYCEE_PREMIERE',
    difficulty: 'moyen',
    specialties: ['PHYSIQUE_CHIMIE'],
    score: 80,
    timeSpent: 720,
    daysAgo: 18,
    questionTypes: ['MULTIPLE_CHOICE'],
    questionCount: 10
  },
  {
    title: 'Quiz SES - Sociologie',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'facile',
    specialties: ['SES'],
    score: 88,
    timeSpent: 540,
    daysAgo: 20,
    questionTypes: ['MULTIPLE_CHOICE', 'TRUE_FALSE'],
    questionCount: 15
  },
  {
    title: 'Quiz Histoire - Guerre froide',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'moyen',
    specialties: ['HISTOIRE_GEO'],
    score: 76,
    timeSpent: 840,
    daysAgo: 22,
    questionTypes: ['MULTIPLE_CHOICE', 'OPEN_QUESTION'],
    questionCount: 10
  },
  {
    title: 'Quiz Mathématiques - Suites',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'difficile',
    specialties: ['MATHEMATIQUES'],
    score: 68,
    timeSpent: 960,
    daysAgo: 24,
    questionTypes: ['OPEN_QUESTION'],
    questionCount: 8
  },
  
  // Quiz anciens (3-4 semaines)
  {
    title: 'Quiz SVT - Immunologie',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'moyen',
    specialties: ['SVT'],
    score: 84,
    timeSpent: 720,
    daysAgo: 26,
    questionTypes: ['MULTIPLE_CHOICE'],
    questionCount: 12
  },
  {
    title: 'Quiz Physique - Thermodynamique',
    schoolLevel: 'LYCEE_TERMINALE',
    difficulty: 'difficile',
    specialties: ['PHYSIQUE_CHIMIE'],
    score: 70,
    timeSpent: 1080,
    daysAgo: 28,
    questionTypes: ['MULTIPLE_CHOICE', 'OPEN_QUESTION'],
    questionCount: 10
  },
  {
    title: 'Quiz Histoire - Renaissance',
    schoolLevel: 'LYCEE_PREMIERE',
    difficulty: 'facile',
    specialties: ['HISTOIRE_GEO'],
    score: 92,
    timeSpent: 540,
    daysAgo: 29,
    questionTypes: ['MULTIPLE_CHOICE', 'TRUE_FALSE'],
    questionCount: 15
  }
];

async function generateQuestions(count: number, types: string[]) {
  const questions = [];
  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    questions.push({
      id: `q${i + 1}`,
      type,
      question: `Question ${i + 1} de test`,
      points: type === 'OPEN_QUESTION' ? 10 : 5,
      options: type === 'MULTIPLE_CHOICE' ? ['A', 'B', 'C', 'D'] : undefined,
      correctAnswer: type === 'MULTIPLE_CHOICE' ? 'A' : type === 'TRUE_FALSE' ? 'true' : 'Réponse',
      difficulty: 'moyen'
    });
  }
  return questions;
}

async function generateUserAnswers(questions: any[], targetScore: number) {
  const correctCount = Math.round((questions.length * targetScore) / 100);
  const answers: any = {};
  
  questions.forEach((q, index) => {
    // Donner des bonnes réponses pour les premiers questions jusqu'à atteindre le score cible
    if (index < correctCount) {
      answers[q.id] = q.correctAnswer;
    } else {
      // Mauvaises réponses pour le reste
      answers[q.id] = q.type === 'MULTIPLE_CHOICE' ? 'B' : 'false';
    }
  });
  
  return answers;
}

async function main() {
  console.log('🌱 Génération de quiz de test pour les statistiques...\n');

  for (const data of testQuizzes) {
    const questions = await generateQuestions(data.questionCount, data.questionTypes);
    const userAnswers = await generateUserAnswers(questions, data.score);
    
    const completedAt = new Date();
    completedAt.setDate(completedAt.getDate() - data.daysAgo);
    const startedAt = new Date(completedAt);
    startedAt.setSeconds(startedAt.getSeconds() - data.timeSpent);

    // Créer le quiz
    const quiz = await prisma.quiz.create({
      data: {
        userId: USER_ID,
        title: data.title,
        schoolLevel: data.schoolLevel as any,
        difficulty: data.difficulty,
        questionTypes: data.questionTypes as any,
        selectedSpecialties: data.specialties as any,
        questions: questions as any,
        userAnswers: userAnswers as any,
        isCompleted: true,
        timeSpent: data.timeSpent,
        startedAt,
        completedAt,
        targetGrade: 14 + Math.random() * 4, // Entre 14 et 18
        timeLimit: Math.ceil(data.timeSpent / 60) + 5, // Un peu plus que le temps passé
        createdAt: startedAt,
        updatedAt: completedAt
      }
    });

    // Créer le résultat du quiz
    const maxScore = questions.reduce((sum, q) => sum + q.points, 0);
    const totalScore = (maxScore * data.score) / 100;
    
    await prisma.quizResult.create({
      data: {
        quizId: quiz.id,
        totalScore,
        maxScore,
        percentage: data.score,
        adaptedGrade: (data.score / 100) * 20, // Note sur 20
        gradeScale: 'FR_20',
        detailedScoring: questions.map((q, index) => ({
          questionId: q.id,
          question: q.question,
          type: q.type,
          userAnswer: userAnswers[q.id],
          correctAnswer: q.correctAnswer,
          score: index < Math.round((questions.length * data.score) / 100) ? q.points : 0,
          maxScore: q.points,
          isCorrect: index < Math.round((questions.length * data.score) / 100),
          explanation: `Explication pour la question ${index + 1}`,
          difficulty: q.difficulty
        })),
        aiCorrection: {
          summary: `Vous avez obtenu ${data.score}% à ce quiz.`,
          strengths: ['Bonne maîtrise des concepts de base', 'Bonnes réponses aux questions faciles'],
          weaknesses: data.score < 80 ? ['Quelques difficultés sur les questions avancées'] : [],
          recommendations: ['Continuer à pratiquer régulièrement', 'Revoir les points difficiles']
        },
        recommendations: ['Revoir le cours', 'Faire plus d\'exercices'],
        strengths: ['Compréhension générale'],
        weaknesses: data.score < 75 ? ['Questions complexes'] : []
      }
    });

    console.log(`✅ Quiz créé: ${data.title} (${data.score}%) - Il y a ${data.daysAgo} jours`);
  }

  console.log(`\n🎉 ${testQuizzes.length} quiz de test générés avec succès !`);
  console.log('\nVous pouvez maintenant accéder à /quiz/statistics pour voir les graphiques.\n');
}

main()
  .catch((e) => {
    console.error('❌ Erreur:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

