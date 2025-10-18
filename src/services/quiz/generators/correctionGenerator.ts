import { AIService } from '../../ai/base.js';
import { 
  Question, 
  OpenQuestion,
  MultipleChoiceQuestion,
  TrueFalseQuestion,
  MatchingQuestion,
  UserAnswer, 
  QuizCorrectionRequest, 
  QuizCorrectionResult 
} from '../types.js';
import { PromptUtils } from '../utils/promptUtils.js';
import { JsonUtils } from '../utils/jsonUtils.js';
import * as fs from 'fs';
import * as path from 'path';

// Types pour la correction de sujets
interface SubjectCorrectionRequest {
  subjectId: string;
  userId: string;
  subjectTitle: string;
  exercises: SubjectExercise[];
  schoolLevel?: string;
  subject?: string;
  hasDocuments?: boolean;
  sourceDocuments?: any[];
  workspaceContent?: any[];
  coursesOnly?: boolean;
}

interface SubjectExercise {
  id: string;
  type: 'QCM' | 'VRAI_FAUX' | 'TEXTE_LIBRE' | 'CALCUL';
  question: string;
  correctAnswer?: any;
  options?: Array<{id: string, text: string, isCorrect: boolean}>;
  points: number;
  difficulty?: string;
}

interface SubjectCorrectionResult {
  subjectId: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  adaptedGrade: number;
  gradeScale: string;
  exerciseResults: Array<{
    exerciseId: string;
    userAnswer: string;
    correctAnswer: string;
    score: number;
    maxScore: number;
    isCorrect: boolean;
    explanation: string;
  }>;
  globalFeedback: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  metadata: {
    correctedAt: Date;
    aiModel: string;
    correctionTime: number;
  };
}

/**
 * Générateur de correction avec IA + correction automatique pour questions fermées
 */
export class CorrectionGenerator {
  
  /**
   * Sauvegarde les données de debug pour analyser les problèmes de correction
   */
  private static saveDebugData(
    questions: Question[],
    userAnswers: UserAnswer[],
    request: QuizCorrectionRequest,
    prompt: string,
    aiResponse?: string,
    result?: QuizCorrectionResult
  ): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `correction-debug-${timestamp}.json`;
      const filepath = path.join(process.cwd(), 'debug-logs', filename);
      
      const debugData = {
        timestamp: new Date().toISOString(),
        quizId: request.quizId,
        userId: request.userId,
        preset: request.preset,
        specificSubject: request.specificSubject,
        schoolLevel: request.schoolLevel,
        questions: questions.map(q => {
          const baseData = {
            id: q.id,
            type: q.type, 
            question: q.question,
            points: q.points,
            difficulty: q.difficulty
          };
          
          // Ajouter les propriétés spécifiques selon le type
          switch (q.type) {
            case 'MULTIPLE_CHOICE':
              const mcQ = q as MultipleChoiceQuestion;
              return { ...baseData, options: mcQ.options };
            case 'TRUE_FALSE':
              const tfQ = q as TrueFalseQuestion;
              return { ...baseData, correctAnswer: tfQ.correctAnswer };
            case 'MATCHING':
              const matchQ = q as MatchingQuestion;
              return { ...baseData, correctMatches: matchQ.correctMatches };
            case 'OPEN_QUESTION':
              const openQ = q as OpenQuestion;
              return { ...baseData, expectedAnswer: openQ.expectedAnswer };
            default:
              return baseData;
          }
        }),
        userAnswers: userAnswers.map(ua => ({
          questionId: ua.questionId,
          answer: ua.answer,
          timeSpent: ua.timeSpent
        })),
        request: {
          preset: request.preset,
          specificSubject: request.specificSubject,
          schoolLevel: request.schoolLevel,
          coursesOnly: request.coursesOnly
        },
        promptSentToAI: prompt,
        aiRawResponse: aiResponse || null,
        correctionResult: result ? {
          totalScore: result.totalScore,
          maxScore: result.maxScore,
          percentage: result.percentage,
          questionResults: result.questionResults
        } : null
      };
      
      // Créer le dossier s'il n'existe pas
      const debugDir = path.dirname(filepath);
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      fs.writeFileSync(filepath, JSON.stringify(debugData, null, 2));
      console.log(`🐛 [DEBUG] Données de correction sauvegardées: ${filename}`);
      
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde debug:', error);
    }
  }

  /**
   * 🚀 NOUVELLE MÉTHODE : Correction automatique pour questions fermées (QCM, Vrai/Faux, Matching)
   * Pas besoin d'IA car on connaît déjà les bonnes réponses !
   */
  private static correctClosedQuestions(
    questions: Question[],
    userAnswers: UserAnswer[]
  ): Array<{
    questionId: string;
    userAnswer: string;
    correctAnswer: string;
    score: number;
    maxScore: number;
    isCorrect: boolean;
    explanation: string;
  }> {
    const closedQuestions = questions.filter(q => 
      q.type === 'MULTIPLE_CHOICE' || 
      q.type === 'TRUE_FALSE' || 
      q.type === 'MATCHING'
    );

    console.log(`🤖 [AUTO-CORRECTION] Correction automatique de ${closedQuestions.length} questions fermées`);

    return closedQuestions.map(question => {
      const userAnswer = userAnswers.find(ua => ua.questionId === question.id);
      const formattedUserAnswer = this.formatUserAnswer(question, userAnswer);
      const correctAnswer = this.extractCorrectAnswer(question);
      const maxScore = question.points || 1;
      
      let score = 0;
      let isCorrect = false;
      let explanation = '';

      switch (question.type) {
        case 'MULTIPLE_CHOICE':
          const mcQ = question as MultipleChoiceQuestion;
          const selectedOption = mcQ.options?.find(opt => opt.id === userAnswer?.answer);
          
          if (selectedOption && selectedOption.isCorrect) {
            score = maxScore;
            isCorrect = true;
            explanation = `Réponse correcte. L'option "${selectedOption.text}" est bien la bonne réponse.`;
          } else if (selectedOption) {
            score = 0;
            isCorrect = false;
            const correctOptions = mcQ.options?.filter(opt => opt.isCorrect) || [];
            explanation = `Réponse incorrecte. La bonne réponse était : ${correctOptions.map(opt => `"${opt.text}"`).join(' ou ')}.`;
          } else {
            score = 0;
            isCorrect = false;
            explanation = 'Aucune réponse sélectionnée.';
          }
          break;

        case 'TRUE_FALSE':
          const tfQ = question as TrueFalseQuestion;
          const userTFAnswer = userAnswer?.answer;
          let userBoolAnswer = false;
          
          // Normaliser la réponse utilisateur
          if (typeof userTFAnswer === 'boolean') {
            userBoolAnswer = userTFAnswer;
          } else if (typeof userTFAnswer === 'string') {
            const normalized = userTFAnswer.toLowerCase().trim();
            // 🔧 FIX: Gérer correctement à la fois "Vrai" ET "Faux"
            if (normalized === 'vrai' || normalized === 'true') {
              userBoolAnswer = true;
            } else if (normalized === 'faux' || normalized === 'false') {
              userBoolAnswer = false;
            } else {
              // Valeur par défaut si la réponse est imprévisible
              userBoolAnswer = false;
            }
          }

          if (userBoolAnswer === tfQ.correctAnswer) {
            score = maxScore;
            isCorrect = true;
            explanation = `Réponse correcte. La bonne réponse était bien "${tfQ.correctAnswer ? 'Vrai' : 'Faux'}".`;
          } else {
            score = 0;
            isCorrect = false;
            explanation = `Réponse incorrecte. La bonne réponse était "${tfQ.correctAnswer ? 'Vrai' : 'Faux'}", vous avez répondu "${userBoolAnswer ? 'Vrai' : 'Faux'}".`;
          }
          break;

        case 'MATCHING':
          const matchQ = question as MatchingQuestion;
          const userPairs = Array.isArray(userAnswer?.answer) ? userAnswer.answer as Array<{leftId: string, rightId: string}> : [];
          const correctPairs = matchQ.correctMatches || [];
          
          let correctMatches = 0;
          const totalMatches = correctPairs.length;

          // Vérifier chaque paire correcte
          correctPairs.forEach(correctPair => {
            const userMatch = userPairs.find(up => up.leftId === correctPair.leftId);
            if (userMatch && userMatch.rightId === correctPair.rightId) {
              correctMatches++;
            }
          });

          // Score proportionnel basé sur le nombre d'associations correctes
          if (totalMatches > 0) {
            score = Math.round((correctMatches / totalMatches) * maxScore * 100) / 100;
            isCorrect = (correctMatches === totalMatches);
            
            if (isCorrect) {
              explanation = `Toutes les associations sont correctes (${correctMatches}/${totalMatches}).`;
            } else if (correctMatches > 0) {
              explanation = `${correctMatches}/${totalMatches} associations correctes. Score proportionnel attribué.`;
            } else {
              explanation = `Aucune association correcte. Les bonnes associations étaient : ${correctPairs.map(cp => `${cp.leftId}→${cp.rightId}`).join(', ')}.`;
            }
          } else {
            score = 0;
            isCorrect = false;
            explanation = 'Aucune association définie pour cette question.';
          }
          break;
      }

      console.log(`✅ [AUTO] Question ${question.id} (${question.type}): ${score}/${maxScore} points - ${isCorrect ? 'CORRECT' : 'INCORRECT'}`);

      return {
        questionId: question.id,
        userAnswer: formattedUserAnswer,
        correctAnswer,
        score,
        maxScore,
        isCorrect,
        explanation
      };
    });
  }
  /**
   * 🚀 MÉTHODE HYBRIDE : Corrige un quiz avec correction automatique + IA optimisée
   * - Questions fermées (QCM, Vrai/Faux, Matching) : correction automatique instantanée
   * - Questions ouvertes : correction par IA avec prompts optimisés
   */
  static async correctQuiz(
    questions: Question[],
    userAnswers: UserAnswer[],
    request: QuizCorrectionRequest
  ): Promise<QuizCorrectionResult> {
    const startTime = Date.now();

    try {
      // 🚀 ÉTAPE 1 : Correction automatique des questions fermées (QCM, Vrai/Faux, Matching)
      const autoCorrections = this.correctClosedQuestions(questions, userAnswers);
      console.log(`⚡ [HYBRID] Correction automatique : ${autoCorrections.length} questions traitées instantanément`);

      // 🧠 ÉTAPE 2 : Identifier les questions ouvertes qui nécessitent l'IA
      const openQuestions = questions.filter(q => q.type === 'OPEN_QUESTION');
      console.log(`🤖 [HYBRID] Questions ouvertes nécessitant l'IA : ${openQuestions.length}`);
      
      let aiCorrections: any[] = [];
      let maxTokens = 0; // Déclarer ici pour l'accès dans les métadonnées
      
      // Si on a des questions ouvertes, utiliser l'IA seulement pour elles
      if (openQuestions.length > 0) {
        console.log(`🧠 [IA] Correction de ${openQuestions.length} questions ouvertes avec IA...`);
        
        // Réduire considérablement les tokens car on a moins de questions à traiter
        const baseTokens = openQuestions.length * 800; // ~800 tokens par question ouverte
        maxTokens = Math.min(Math.max(baseTokens, 2000), 8000); // Entre 2K et 8K tokens
        console.log(`⚡ [OPTIMISATION] Tokens réduits pour questions ouvertes : ${maxTokens} (vs 12K habituels)`);
        
        // Déterminer le prompt adapté aux questions ouvertes uniquement
        let levelPrompt: string;
      
        if (request.coursesOnly && request.workspaceContent && request.workspaceContent.length > 0) {
          // Mode correction basée uniquement sur les cours (pour questions ouvertes)
          console.log(`📝 [IA-OPEN] Mode coursesOnly pour questions ouvertes avec ${request.workspaceContent.length} workspace(s)`);
          
          const workspaceInfo = request.workspaceContent.map(ws => ({
            workspace: ws.workspaceName,
            topics: ws.contentSummary.mainTopics.join(', '),
            content: ws.extractedContent.slice(0, 3).map(c => c.content).join('\n\n')
          }));
          
          levelPrompt = `Tu es un correcteur STRICT spécialisé dans l'évaluation des questions ouvertes basée UNIQUEMENT sur le contenu des cours fournis.

CONTENU DES COURS POUR LA CORRECTION :
${workspaceInfo.map(ws => `
Workspace: ${ws.workspace}  
Sujets principaux: ${ws.topics}
Contenu de référence:
${ws.content}
`).join('\n---\n')}

CONSIGNES DE CORRECTION STRICTE POUR QUESTIONS OUVERTES :
- Base ta correction STRICTEMENT sur le contenu des cours fourni ci-dessus
- Réponses non-pertinentes ("a", "b", mots isolés) = 0 point OBLIGATOIRE
- Score proportionnel si réponse partiellement correcte selon les cours
- Explications détaillées basées sur le contenu de référence`;
          
        } else if (request.preset && request.preset !== 'NONE') {
          // Mode preset pour questions ouvertes
          console.log(`📝 [IA-OPEN] Prompt preset pour questions ouvertes: ${request.preset} - ${request.specificSubject || 'matière par défaut'}`);
          const basePrompt = PromptUtils.getPresetPrompt(request.preset, request.specificSubject, {
            schoolLevel: request.schoolLevel,
            collegeGrade: request.collegeGrade,
            preset: request.preset,
            specificSubject: request.specificSubject
          } as any);
          
          levelPrompt = `${basePrompt}

CORRECTION QUESTIONS OUVERTES UNIQUEMENT :
Tu corriges seulement les questions ouvertes avec rigueur académique.
Les QCM, Vrai/Faux et Matching sont déjà corrigés automatiquement.`;
          
        } else {
          // Mode générique pour questions ouvertes
          console.log(`📝 [IA-OPEN] Prompt générique pour questions ouvertes: ${request.schoolLevel}`);
          const basePrompt = PromptUtils.getGenerationPromptByLevel(request.schoolLevel, request.collegeGrade);
          
          levelPrompt = `${basePrompt}

CORRECTION QUESTIONS OUVERTES UNIQUEMENT :
Tu corriges seulement les questions ouvertes avec rigueur académique.
Les QCM, Vrai/Faux et Matching sont déjà corrigés automatiquement.`;
        }

        // Intégration des documents Wikipedia pour les questions ouvertes
        let documentsSection = '';
        if (request.hasDocuments && request.sourceDocuments && request.sourceDocuments.length > 0) {
          console.log(`📚 [IA-OPEN] Intégration de ${request.sourceDocuments.length} document(s) Wikipedia pour questions ouvertes`);
          
          documentsSection = `
DOCUMENTS WIKIPEDIA DE RÉFÉRENCE :
${request.sourceDocuments.map((doc: any, index: number) => `
Document ${index + 1}: ${doc.title} 
Contenu: ${doc.content.substring(0, 500)}...
`).join('\n---\n')}

CONSIGNES POUR LES QUESTIONS OUVERTES DOCUMENTAIRES :
- Utilise les documents pour évaluer la pertinence des réponses ouvertes
- Score basé sur la cohérence avec le contenu documentaire`;
          
          levelPrompt = `${levelPrompt}\n\n${documentsSection}`;
        }

        // Préparer seulement les questions ouvertes pour l'IA
        const openQuestionsWithAnswers = this.prepareQuestionsForCorrection(openQuestions, userAnswers);

        const optimizedPrompt = `
${levelPrompt}

🤖 CORRECTION OPTIMISÉE - QUESTIONS OUVERTES UNIQUEMENT
Les questions fermées (QCM, Vrai/Faux, Matching) ont déjà été corrigées automatiquement.
Tu dois corriger UNIQUEMENT les ${openQuestions.length} questions ouvertes ci-dessous.

QUESTIONS OUVERTES À CORRIGER :
${openQuestionsWithAnswers.map((qa, index) => `
Question ${index + 1} (${qa.question.difficulty}, ${qa.question.points} points):
Question: ${qa.question.question}
Réponse attendue: ${qa.correctAnswer}
Réponse de l'élève: ${qa.userAnswer || 'Pas de réponse'}
ID Question: ${qa.question.id}
`).join('\n---\n')}

STRUCTURE JSON REQUISE - Questions ouvertes seulement :
{
  "questionResults": [
    {
      "questionId": "id_de_la_question_ouverte",
      "userAnswer": "réponse_de_l_élève",
      "correctAnswer": "réponse_correcte_attendue", 
      "score": 8,
      "maxScore": 10,
      "isCorrect": false,
      "explanation": "Explication détaillée"
    }
  ],
  "globalFeedback": "Analyse des questions ouvertes uniquement",
  "strengths": ["Points forts sur questions ouvertes"],
  "weaknesses": ["Axes d'amélioration sur questions ouvertes"],
  "recommendations": ["Conseils pour questions ouvertes"]
}

IMPORTANT : Réponds UNIQUEMENT en JSON valide pour les ${openQuestions.length} questions ouvertes.`;

        // 🐛 [DEBUG] Sauvegarder les données AVANT l'appel à l'IA (questions ouvertes seulement)
        this.saveDebugData(openQuestions, userAnswers, request, optimizedPrompt);

        const result = await AIService.generateContent({
          prompt: optimizedPrompt,
          maxTokens,
          temperature: 0.3,
          model: AIService.getDefaultModel()
        });

        console.log(`🐛 [DEBUG] Réponse IA pour questions ouvertes (${result.content.length} caractères):`, result.content.substring(0, 300) + '...');

        const aiCorrectionData = JsonUtils.extractJsonFromText(result.content);
        
        // Traiter les corrections IA pour les questions ouvertes
        aiCorrections = this.processQuestionResults(aiCorrectionData.questionResults || [], openQuestions);
        
        console.log(`✅ [IA] ${aiCorrections.length} questions ouvertes corrigées par l'IA`);
      } else {
        console.log(`⚡ [HYBRID] Aucune question ouverte - correction 100% automatique !`);
      }

      // 🔗 ÉTAPE 3 : Combiner les corrections automatiques + IA
      const allCorrections = [...autoCorrections, ...aiCorrections];
      console.log(`🎯 [HYBRID] TOTAL: ${allCorrections.length} questions corrigées (${autoCorrections.length} auto + ${aiCorrections.length} IA)`);

      // Tri des corrections par ordre des questions originales
      const sortedCorrections = allCorrections.sort((a, b) => {
        const indexA = questions.findIndex(q => q.id === a.questionId);
        const indexB = questions.findIndex(q => q.id === b.questionId);
        return indexA - indexB;
      });

      // Calculer les scores finaux
      const { realTotalScore, realMaxScore, realPercentage, realAdaptedGrade } = this.recalculateScores(sortedCorrections);

      console.log(`🔢 SCORES FINAUX HYBRIDES :
        - Score total : ${realTotalScore}/${realMaxScore}
        - Pourcentage : ${realPercentage.toFixed(2)}%
        - Note sur 20 : ${realAdaptedGrade.toFixed(2)}/20
        - Correction automatique: ${autoCorrections.length} questions
        - Correction IA: ${aiCorrections.length} questions`);

      // Construction du résultat final hybride
      const correctionResult: QuizCorrectionResult = {
        quizId: request.quizId,
        totalScore: realTotalScore,
        maxScore: realMaxScore,
        percentage: Math.round(realPercentage * 100) / 100,
        adaptedGrade: Math.round(realAdaptedGrade * 100) / 100,
        gradeScale: '20',
        questionResults: sortedCorrections,
        aiCorrection: {
          globalFeedback: aiCorrections.length > 0 
            ? `Correction hybride: ${autoCorrections.length} questions automatiques + ${aiCorrections.length} questions par IA. Performance globale: ${realPercentage.toFixed(1)}%`
            : `Correction 100% automatique pour ${autoCorrections.length} questions fermées. Performance: ${realPercentage.toFixed(1)}%`,
          strengths: this.extractStrengthsFromCorrections(sortedCorrections),
          weaknesses: this.extractWeaknessesFromCorrections(sortedCorrections),
          recommendations: this.generateRecommendations(sortedCorrections, realPercentage)
        },
        metadata: {
          correctedAt: new Date(),
          aiModel: (aiCorrections.length > 0 ? AIService.getDefaultModel() : 'Auto-correction') || 'unknown',
          correctionTime: Date.now() - startTime,
          
        }
      };

      // 🐛 [DEBUG] Sauvegarder le résultat final complet
      this.saveDebugData(questions, userAnswers, request, '', '', correctionResult);

      return correctionResult;

    } catch (error) {
      console.error('Erreur correction quiz hybride:', error);
      throw new Error(`Échec de la correction du quiz: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * 🚀 MÉTHODE STREAMING : Corrige un quiz avec streaming des corrections
   * Yield les corrections progressivement au fur et à mesure
   */
  static async *correctQuizStreaming(
    questions: Question[],
    userAnswers: UserAnswer[],
    request: QuizCorrectionRequest
  ): AsyncGenerator<{
    type: 'closed-questions' | 'open-question' | 'completion';
    questionNumber?: number;
    totalOpenQuestions?: number;
    correction?: any;
    finalResult?: QuizCorrectionResult;
  }> {
    const startTime = Date.now();

    try {
      // 🚀 ÉTAPE 1 : Correction automatique des questions fermées (QCM, Vrai/Faux, Matching)
      const autoCorrections = this.correctClosedQuestions(questions, userAnswers);
      console.log(`⚡ [HYBRID-STREAMING] Correction automatique : ${autoCorrections.length} questions fermées traitées`);

      // Générer les suggestions IA pour les questions fermées qui ont des points partiels/zéro
      const closedWithSuggestions = await this.generateSuggestionsForClosedQuestions(
        autoCorrections,
        questions,
        request
      );

      // Yielder toutes les questions fermées d'un coup
      yield {
        type: 'closed-questions',
        correction: closedWithSuggestions
      };

      // 🧠 ÉTAPE 2 : Identifier les questions ouvertes qui nécessitent l'IA
      const openQuestions = questions.filter(q => q.type === 'OPEN_QUESTION');
      console.log(`🤖 [HYBRID-STREAMING] Questions ouvertes nécessitant l'IA : ${openQuestions.length}`);
      
      let aiCorrections: any[] = [];
      
      // Si on a des questions ouvertes, corriger une par une
      if (openQuestions.length > 0) {
        for (let i = 0; i < openQuestions.length; i++) {
          try {
            const openQuestion = openQuestions[i];
            const userAnswer = userAnswers.find(ua => ua.questionId === openQuestion.id);
            
            console.log(`🧠 [STREAMING] Correction question ouverte ${i + 1}/${openQuestions.length}`);
            
            // Corriger cette question ouverte spécifique
            const singleQuestionCorrection = await this.correctSingleOpenQuestion(
              openQuestion,
              userAnswer,
              request
            );

            aiCorrections.push(singleQuestionCorrection);

            // Yielder la correction pour affichage progressif
            yield {
              type: 'open-question',
              questionNumber: i + 1,
              totalOpenQuestions: openQuestions.length,
              correction: singleQuestionCorrection
            };

            console.log(`✅ [STREAMING] Question ouverte ${i + 1} corrigée et envoyée`);
          } catch (error) {
            console.error(`❌ [STREAMING] Erreur correction question ouverte ${i + 1}:`, error);
            // Continuer avec la question suivante
          }
        }
      } else {
        console.log(`⚡ [HYBRID-STREAMING] Aucune question ouverte - correction 100% automatique !`);
      }

      // 🔗 ÉTAPE 3 : Combiner les corrections automatiques + IA
      const allCorrections = [...closedWithSuggestions, ...aiCorrections];
      console.log(`🎯 [HYBRID-STREAMING] TOTAL: ${allCorrections.length} questions corrigées (${closedWithSuggestions.length} auto + ${aiCorrections.length} IA)`);

      // Tri des corrections par ordre des questions originales
      const sortedCorrections = allCorrections.sort((a, b) => {
        const indexA = questions.findIndex(q => q.id === a.questionId);
        const indexB = questions.findIndex(q => q.id === b.questionId);
        return indexA - indexB;
      });

      // Calculer les scores finaux
      const { realTotalScore, realMaxScore, realPercentage, realAdaptedGrade } = this.recalculateScores(sortedCorrections);

      console.log(`🔢 SCORES FINAUX HYBRIDES STREAMING :
        - Score total : ${realTotalScore}/${realMaxScore}
        - Pourcentage : ${realPercentage.toFixed(2)}%
        - Note sur 20 : ${realAdaptedGrade.toFixed(2)}/20
        - Correction automatique: ${closedWithSuggestions.length} questions
        - Correction IA: ${aiCorrections.length} questions`);

      // 🧠 ÉTAPE 4 : Générer l'analyse détaillée IA
      console.log('🧠 [STREAMING] Génération de l\'analyse détaillée IA...');
      const detailedAnalysis = await this.generateDetailedAnalysis(
        questions,
        sortedCorrections,
        request,
        realTotalScore,
        realMaxScore,
        realPercentage
      );

      // Construction du résultat final hybride avec analyse
      const correctionResult: QuizCorrectionResult = {
        quizId: request.quizId,
        totalScore: realTotalScore,
        maxScore: realMaxScore,
        percentage: Math.round(realPercentage * 100) / 100,
        adaptedGrade: Math.round(realAdaptedGrade * 100) / 100,
        gradeScale: '20',
        questionResults: sortedCorrections,
        aiCorrection: {
          globalFeedback: detailedAnalysis.summary,
          strengths: detailedAnalysis.strengths,
          weaknesses: detailedAnalysis.weaknesses,
          recommendations: detailedAnalysis.recommendations
        },
        metadata: {
          correctedAt: new Date(),
          aiModel: AIService.getDefaultModel() || 'unknown',
          correctionTime: Date.now() - startTime,
          personalizedTips: detailedAnalysis.personalizedTips
        }
      };

      // Yielder le résultat final complet
      yield {
        type: 'completion',
        finalResult: correctionResult
      };

      // 🐛 [DEBUG] Sauvegarder le résultat final complet
      this.saveDebugData(questions, userAnswers, request, '', '', correctionResult);

    } catch (error) {
      console.error('Erreur correction quiz streaming:', error);
      throw new Error(`Échec de la correction du quiz: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * Helper : Extrait les points forts depuis les corrections
   */
  private static extractStrengthsFromCorrections(corrections: any[]): string[] {
    const strengths = [];
    const correctAnswers = corrections.filter(c => c.isCorrect);
    
    if (correctAnswers.length > 0) {
      strengths.push(`${correctAnswers.length} réponse(s) parfaitement correcte(s)`);
    }
    
    const partialScores = corrections.filter(c => c.score > 0 && !c.isCorrect);
    if (partialScores.length > 0) {
      strengths.push(`Compréhension partielle sur ${partialScores.length} question(s)`);
    }
    
    return strengths.length > 0 ? strengths : ['Continuez vos efforts'];
  }

  /**
   * Helper : Extrait les faiblesses depuis les corrections
   */
  private static extractWeaknessesFromCorrections(corrections: any[]): string[] {
    const weaknesses = [];
    const incorrectAnswers = corrections.filter(c => c.score === 0);
    
    if (incorrectAnswers.length > 0) {
      weaknesses.push(`${incorrectAnswers.length} réponse(s) à retravailler`);
    }
    
    const partialScores = corrections.filter(c => c.score > 0 && !c.isCorrect);
    if (partialScores.length > 0) {
      weaknesses.push(`Approfondissement nécessaire sur ${partialScores.length} point(s)`);
    }
    
    return weaknesses.length > 0 ? weaknesses : [];
  }

  /**
   * Helper : Génère des recommandations basées sur les performances
   */
  private static generateRecommendations(corrections: any[], percentage: number): string[] {
    const recommendations = [];
    
    if (percentage < 50) {
      recommendations.push('Revoir les concepts fondamentaux du cours');
      recommendations.push('Pratiquer davantage avec des exercices similaires');
    } else if (percentage < 75) {
      recommendations.push('Consolider les notions partiellement maîtrisées');
      recommendations.push('Approfondir les sujets les plus complexes');
    } else {
      recommendations.push('Excellent travail ! Continuer sur cette lancée');
      recommendations.push('Approfondir les sujets avancés pour aller plus loin');
    }
    
    const incorrectAnswers = corrections.filter(c => c.score === 0);
    if (incorrectAnswers.length > 0) {
      recommendations.push('Réviser spécifiquement les questions ratées');
    }
    
    return recommendations;
  }

  /**
   * Prépare les questions pour la correction
   */
  private static prepareQuestionsForCorrection(questions: Question[], userAnswers: UserAnswer[]): Array<{
    question: Question;
    userAnswer: any;
    timeSpent?: number;
    correctAnswer: string;
  }> {
    return questions.map(q => {
      const userAnswer = userAnswers.find(ua => ua.questionId === q.id);
      
      // Extraire la réponse correcte selon le type de question
      const correctAnswer = this.extractCorrectAnswer(q);
      
      // Formatter la réponse utilisateur selon le type de question
      const formattedUserAnswer = this.formatUserAnswer(q, userAnswer);
      
      return {
        question: q,
        userAnswer: formattedUserAnswer,
        timeSpent: userAnswer?.timeSpent,
        correctAnswer
      };
    });
  }

  /**
   * Extrait la réponse correcte d'une question
   */
  private static extractCorrectAnswer(question: Question): string {
    switch (question.type) {
      case 'OPEN_QUESTION':
        const openQ = question as OpenQuestion;
        // Pour les questions ouvertes, on demande à l'IA de fournir une réponse modèle
        // au lieu de retourner "Réponse libre" qui n'aide pas la correction
        return openQ.expectedAnswer || `Réponse attendue de niveau ${openQ.difficulty || 'moyen'} pour : ${openQ.question}`;
      case 'MULTIPLE_CHOICE':
        const mcQ = question as MultipleChoiceQuestion;
        const correctOptions = mcQ.options?.filter(opt => opt.isCorrect) || [];
        return correctOptions.map(opt => opt.text).join(', ');
      case 'TRUE_FALSE':
        const tfQ = question as TrueFalseQuestion;
        return tfQ.correctAnswer ? 'Vrai' : 'Faux';
      case 'MATCHING':
        const matchQ = question as MatchingQuestion;
        return matchQ.correctMatches?.map(match => 
          `${match.leftId} → ${match.rightId}`
        ).join(', ') || 'Associations attendues';
      default:
        return 'Réponse attendue non définie';
    }
  }

  /**
   * Formate la réponse utilisateur selon le type de question
   */
  private static formatUserAnswer(question: Question, userAnswer?: UserAnswer): string {
    if (!userAnswer?.answer) {
      return 'Pas de réponse';
    }

    switch (question.type) {
      case 'MATCHING':
        // Formater les MatchingPair[] en format lisible
        if (Array.isArray(userAnswer.answer) && userAnswer.answer.length > 0) {
          const pairs = userAnswer.answer as Array<{leftId: string, rightId: string}>;
          return pairs.map(pair => `${pair.leftId} → ${pair.rightId}`).join(', ');
        } else {
          return 'Aucune association';
        }
      case 'TRUE_FALSE':
        // Normaliser les réponses TRUE_FALSE
        if (typeof userAnswer.answer === 'boolean') {
          return userAnswer.answer ? 'Vrai' : 'Faux';
        } else if (typeof userAnswer.answer === 'string') {
          const normalized = userAnswer.answer.toLowerCase().trim();
          if (normalized === 'vrai' || normalized === 'true') {
            return 'Vrai';
          } else if (normalized === 'faux' || normalized === 'false') {
            return 'Faux';
          } else {
            return String(userAnswer.answer);
          }
        } else {
          return String(userAnswer.answer);
        }
      case 'MULTIPLE_CHOICE':
        // Pour les QCM, afficher l'ID et le texte de l'option choisie si possible
        const mcQ = question as MultipleChoiceQuestion;
        const selectedOption = mcQ.options?.find(opt => opt.id === userAnswer.answer);
        if (selectedOption) {
          return `${selectedOption.id}: ${selectedOption.text}`;
        } else {
          return String(userAnswer.answer);
        }
      default:
        // Pour les autres types, conversion simple en string
        if (Array.isArray(userAnswer.answer)) {
          return userAnswer.answer.join(', ');
        } else {
          return String(userAnswer.answer);
        }
    }
  }

  /**
   * Traite les résultats de questions de la correction IA
   */
  private static processQuestionResults(questionResults: any[], questions: Question[]): any[] {
    return questionResults?.map((qr: any) => {
      // Trouver la vraie question pour récupérer le maxScore correct
      const actualQuestion = questions.find(q => q.id === qr.questionId);
      const actualMaxScore = actualQuestion ? actualQuestion.points : Number(qr.maxScore) || 1;
      
      // S'assurer que le score est un nombre valide
      const cleanScore = isNaN(Number(qr.score)) ? 0 : Number(qr.score);
      
      // 🔧 FIX CRITIQUE: Si l'IA indique que la réponse est correcte (isCorrect: true),
      // forcer le score à être égal au maxScore pour éviter les points partiels sur des bonnes réponses
      let finalScore = Math.min(cleanScore, actualMaxScore);
      const aiSaysCorrect = qr.isCorrect === true || qr.isCorrect === 'true';
      
      if (aiSaysCorrect && finalScore < actualMaxScore) {
        console.log(`🔧 [SCORING-FIX] Question ${qr.questionId}: L'IA dit correct mais score partiel ${finalScore}/${actualMaxScore} → Correction à ${actualMaxScore}/${actualMaxScore}`);
        finalScore = actualMaxScore;
      }
      
      return {
        questionId: qr.questionId,
        userAnswer: qr.userAnswer || '',
        correctAnswer: qr.correctAnswer || '',
        score: finalScore,
        maxScore: actualMaxScore,
        isCorrect: (finalScore === actualMaxScore),
        explanation: qr.explanation || ''
      };
    }) || [];
  }

  /**
   * Recalcule les scores pour garantir la cohérence
   */
  private static recalculateScores(detailedScoring: any[]): {
    realTotalScore: number;
    realMaxScore: number;
    realPercentage: number;
    realAdaptedGrade: number;
  } {
    // Calculer le score total réel à partir des questions individuelles
    const realTotalScore = detailedScoring.reduce((sum: number, qr: any) => {
      const score = isNaN(qr.score) ? 0 : Number(qr.score);
      return sum + score;
    }, 0);
    
    const realMaxScore = detailedScoring.reduce((sum: number, qr: any) => {
      const maxScore = isNaN(qr.maxScore) ? 0 : Number(qr.maxScore);
      return sum + maxScore;
    }, 0);
    
    // Calculer le pourcentage réel avec protection contre division par zéro
    const realPercentage = realMaxScore > 0 ? (realTotalScore / realMaxScore) * 100 : 0;
    
    // Calculer la note adaptée sur 20 (système français standard)
    const realAdaptedGrade = (realPercentage * 20) / 100;

    return {
      realTotalScore,
      realMaxScore,
      realPercentage,
      realAdaptedGrade
    };
  }

  /**
   * 🚀 CORRECTION HYBRIDE POUR SUJETS/DEVOIRS
   * Système identique aux quiz : auto-correction pour exercices fermés + IA pour ouverts
   */
  static async correctSubject(
    exercises: SubjectExercise[],
    userAnswers: Array<{exerciseId: string, answer: any}>,
    request: SubjectCorrectionRequest
  ): Promise<SubjectCorrectionResult> {
    const startTime = Date.now();

    try {
      console.log(`🎯 [SUBJECT-CORRECTION] Correction hybride du sujet: ${request.subjectTitle}`);
      console.log(`📝 [SUBJECT-CORRECTION] ${exercises.length} exercices à corriger`);

      // 🚀 ÉTAPE 1 : Correction automatique des exercices fermés (QCM, Vrai/Faux)
      const autoCorrections = this.correctClosedSubjectExercises(exercises, userAnswers);
      console.log(`⚡ [SUBJECT-HYBRID] Correction automatique : ${autoCorrections.length} exercices traités instantanément`);

      // 🧠 ÉTAPE 2 : Identifier les exercices ouverts qui nécessitent l'IA
      const openExercises = exercises.filter(ex => ex.type === 'TEXTE_LIBRE' || ex.type === 'CALCUL');
      console.log(`🤖 [SUBJECT-HYBRID] Exercices ouverts nécessitant l'IA : ${openExercises.length}`);
      
      let aiCorrections: any[] = [];
      let maxTokens = 0;
      
      // Si on a des exercices ouverts, utiliser l'IA seulement pour eux
      if (openExercises.length > 0) {
        console.log(`🧠 [SUBJECT-IA] Correction de ${openExercises.length} exercices ouverts avec IA...`);
        
        // Réduire les tokens car on a moins d'exercices à traiter
        const baseTokens = openExercises.length * 1000; // ~1000 tokens par exercice ouvert
        maxTokens = Math.min(Math.max(baseTokens, 3000), 10000); // Entre 3K et 10K tokens
        console.log(`⚡ [SUBJECT-OPTIMISATION] Tokens réduits pour exercices ouverts : ${maxTokens}`);

        // Construire le prompt optimisé pour les exercices ouverts uniquement
        const levelPrompt = this.buildSubjectCorrectionPrompt(request);

        // Préparer seulement les exercices ouverts pour l'IA
        const openExercisesWithAnswers = this.prepareOpenExercisesForCorrection(openExercises, userAnswers);

        const optimizedPrompt = `
${levelPrompt}

🤖 CORRECTION OPTIMISÉE - EXERCICES OUVERTS UNIQUEMENT
Les exercices fermés (QCM, Vrai/Faux) ont déjà été corrigés automatiquement.
Tu dois corriger UNIQUEMENT les ${openExercises.length} exercices ouverts ci-dessous.

SUJET : ${request.subjectTitle}
MATIÈRE : ${request.subject || 'Non spécifiée'}
NIVEAU : ${request.schoolLevel || 'Non spécifié'}

EXERCICES OUVERTS À CORRIGER :
${openExercisesWithAnswers.map((ex, index) => `
Exercice ${index + 1} (${ex.exercise.difficulty || 'moyen'}, ${ex.exercise.points} points):
Question: ${ex.exercise.question}
Réponse attendue: ${ex.correctAnswer || 'À évaluer'}
Réponse de l'élève: ${ex.userAnswer || 'Pas de réponse'}
ID Exercice: ${ex.exercise.id}
`).join('\n---\n')}

STRUCTURE JSON REQUISE - Exercices ouverts seulement :
{
  "exerciseResults": [
    {
      "exerciseId": "id_de_l_exercice_ouvert",
      "userAnswer": "réponse_de_l_élève",
      "correctAnswer": "réponse_correcte_ou_explication", 
      "score": 8,
      "maxScore": 10,
      "isCorrect": false,
      "explanation": "Explication détaillée de la correction"
    }
  ],
  "globalFeedback": "Analyse des exercices ouverts uniquement",
  "strengths": ["Points forts sur exercices ouverts"],
  "weaknesses": ["Axes d'amélioration sur exercices ouverts"],
  "recommendations": ["Conseils pour exercices ouverts"]
}

IMPORTANT : Réponds UNIQUEMENT en JSON valide pour les ${openExercises.length} exercices ouverts.`;

        const result = await AIService.generateContent({
          prompt: optimizedPrompt,
          maxTokens,
          temperature: 0.3,
          model: AIService.getDefaultModel()
        });

        console.log(`🐛 [DEBUG] Réponse IA pour exercices ouverts du sujet (${result.content.length} caractères)`);

        const aiCorrectionData = JsonUtils.extractJsonFromText(result.content);
        
        // Traiter les corrections IA pour les exercices ouverts
        aiCorrections = this.processSubjectExerciseResults(aiCorrectionData.exerciseResults || [], openExercises);
        
        console.log(`✅ [SUBJECT-IA] ${aiCorrections.length} exercices ouverts corrigés par l'IA`);
      } else {
        console.log(`⚡ [SUBJECT-HYBRID] Aucun exercice ouvert - correction 100% automatique !`);
      }

      // 🔗 ÉTAPE 3 : Combiner les corrections automatiques + IA
      const allCorrections = [...autoCorrections, ...aiCorrections];
      console.log(`🎯 [SUBJECT-HYBRID] TOTAL: ${allCorrections.length} exercices corrigés (${autoCorrections.length} auto + ${aiCorrections.length} IA)`);

      // Tri des corrections par ordre des exercices originaux
      const sortedCorrections = allCorrections.sort((a, b) => {
        const indexA = exercises.findIndex(ex => ex.id === a.exerciseId);
        const indexB = exercises.findIndex(ex => ex.id === b.exerciseId);
        return indexA - indexB;
      });

      // Calculer les scores finaux
      const { realTotalScore, realMaxScore, realPercentage, realAdaptedGrade } = 
        this.recalculateSubjectScores(sortedCorrections);

      console.log(`🔢 SCORES FINAUX HYBRIDES SUJET :
        - Score total : ${realTotalScore}/${realMaxScore}
        - Pourcentage : ${realPercentage.toFixed(2)}%
        - Note sur 20 : ${realAdaptedGrade.toFixed(2)}/20
        - Correction automatique: ${autoCorrections.length} exercices
        - Correction IA: ${aiCorrections.length} exercices`);

      // Construction du résultat final
      const correctionResult: SubjectCorrectionResult = {
        subjectId: request.subjectId,
        totalScore: realTotalScore,
        maxScore: realMaxScore,
        percentage: Math.round(realPercentage * 100) / 100,
        adaptedGrade: Math.round(realAdaptedGrade * 100) / 100,
        gradeScale: '20',
        exerciseResults: sortedCorrections,
        globalFeedback: aiCorrections.length > 0 
          ? `Correction hybride: ${autoCorrections.length} exercices automatiques + ${aiCorrections.length} exercices par IA. Performance globale: ${realPercentage.toFixed(1)}%`
          : `Correction 100% automatique pour ${autoCorrections.length} exercices fermés. Performance: ${realPercentage.toFixed(1)}%`,
        strengths: this.extractStrengthsFromCorrections(sortedCorrections),
        weaknesses: this.extractWeaknessesFromCorrections(sortedCorrections),
        recommendations: this.generateRecommendations(sortedCorrections, realPercentage),
        metadata: {
          correctedAt: new Date(),
          aiModel: (aiCorrections.length > 0 ? AIService.getDefaultModel() : 'Auto-correction') || 'unknown',
          correctionTime: Date.now() - startTime
        }
      };

      return correctionResult;

    } catch (error) {
      console.error('Erreur correction sujet hybride:', error);
      throw new Error(`Échec de la correction du sujet: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * 🚀 CORRECTION AUTOMATIQUE pour exercices fermés de sujets (QCM, Vrai/Faux)
   * Identique à la logique quiz mais adapté aux types de sujets
   */
  private static correctClosedSubjectExercises(
    exercises: SubjectExercise[],
    userAnswers: Array<{exerciseId: string, answer: any}>
  ): Array<{
    exerciseId: string;
    userAnswer: string;
    correctAnswer: string;
    score: number;
    maxScore: number;
    isCorrect: boolean;
    explanation: string;
  }> {
    const closedExercises = exercises.filter(ex => 
      ex.type === 'QCM' || ex.type === 'VRAI_FAUX'
    );

    console.log(`🤖 [SUBJECT-AUTO-CORRECTION] Correction automatique de ${closedExercises.length} exercices fermés`);

    return closedExercises.map(exercise => {
      const userAnswer = userAnswers.find(ua => ua.exerciseId === exercise.id);
      const maxScore = exercise.points || 1;
      
      let score = 0;
      let isCorrect = false;
      let explanation = '';
      let correctAnswer = '';
      let formattedUserAnswer = userAnswer?.answer ? String(userAnswer.answer) : 'Pas de réponse';

      switch (exercise.type) {
        case 'QCM':
          if (exercise.options) {
            const selectedOption = exercise.options.find(opt => opt.id === userAnswer?.answer);
            const correctOptions = exercise.options.filter(opt => opt.isCorrect);
            correctAnswer = correctOptions.map(opt => opt.text).join(', ');
            
            if (selectedOption && selectedOption.isCorrect) {
              score = maxScore;
              isCorrect = true;
              explanation = `Réponse correcte. L'option "${selectedOption.text}" est bien la bonne réponse.`;
            } else if (selectedOption) {
              score = 0;
              isCorrect = false;
              explanation = `Réponse incorrecte. La bonne réponse était : ${correctOptions.map(opt => `"${opt.text}"`).join(' ou ')}.`;
            } else {
              score = 0;
              isCorrect = false;
              explanation = 'Aucune réponse sélectionnée.';
            }
            
            if (selectedOption) {
              formattedUserAnswer = `${selectedOption.id}: ${selectedOption.text}`;
            }
          }
          break;

        case 'VRAI_FAUX':
          const userBoolAnswer = this.normalizeVraiFauxAnswer(userAnswer?.answer);
          const correctBoolAnswer = exercise.correctAnswer;
          correctAnswer = correctBoolAnswer ? 'Vrai' : 'Faux';
          
          if (userBoolAnswer === correctBoolAnswer) {
            score = maxScore;
            isCorrect = true;
            explanation = `Réponse correcte. La bonne réponse était bien "${correctAnswer}".`;
          } else {
            score = 0;
            isCorrect = false;
            explanation = `Réponse incorrecte. La bonne réponse était "${correctAnswer}", vous avez répondu "${userBoolAnswer ? 'Vrai' : 'Faux'}".`;
          }
          
          formattedUserAnswer = userBoolAnswer ? 'Vrai' : 'Faux';
          break;
      }

      console.log(`✅ [SUBJECT-AUTO] Exercice ${exercise.id} (${exercise.type}): ${score}/${maxScore} points - ${isCorrect ? 'CORRECT' : 'INCORRECT'}`);

      return {
        exerciseId: exercise.id,
        userAnswer: formattedUserAnswer,
        correctAnswer,
        score,
        maxScore,
        isCorrect,
        explanation
      };
    });
  }

  /**
   * Helpers pour la correction de sujets
   */
  private static normalizeVraiFauxAnswer(answer: any): boolean {
    if (typeof answer === 'boolean') return answer;
    if (typeof answer === 'string') {
      const normalized = answer.toLowerCase().trim();
      // 🔧 FIX: Gérer correctement à la fois "Vrai" ET "Faux"
      if (normalized === 'vrai' || normalized === 'true') {
        return true;
      } else if (normalized === 'faux' || normalized === 'false') {
        return false;
      }
    }
    return false; // Valeur par défaut
  }

  private static buildSubjectCorrectionPrompt(request: SubjectCorrectionRequest): string {
    let basePrompt = `Tu es un correcteur expert pour la matière ${request.subject || 'générale'} niveau ${request.schoolLevel || 'non spécifié'}.

CORRECTION D'EXERCICES OUVERTS DE SUJET :
- Évalue avec rigueur académique
- Score proportionnel selon la qualité de la réponse
- Explications pédagogiques détaillées`;

    // Ajouter le contenu des cours si disponible
    if (request.coursesOnly && request.workspaceContent && request.workspaceContent.length > 0) {
      const workspaceInfo = request.workspaceContent.map(ws => ({
        workspace: ws.workspaceName,
        topics: ws.contentSummary.mainTopics.join(', '),
        content: ws.extractedContent.slice(0, 2).map((c: any) => c.content).join('\n\n')
      }));
      
      basePrompt += `

CONTENU DES COURS POUR LA CORRECTION :
${workspaceInfo.map(ws => `
Workspace: ${ws.workspace}  
Sujets principaux: ${ws.topics}
Contenu de référence:
${ws.content}
`).join('\n---\n')}

CONSIGNES : Base ta correction STRICTEMENT sur le contenu des cours fourni ci-dessus.`;
    }

    // Ajouter les documents de référence si disponibles
    if (request.hasDocuments && request.sourceDocuments && request.sourceDocuments.length > 0) {
      basePrompt += `

DOCUMENTS DE RÉFÉRENCE :
${request.sourceDocuments.map((doc: any, index: number) => `
Document ${index + 1}: ${doc.title || 'Document'} 
Contenu: ${doc.content?.substring(0, 400) || doc.text?.substring(0, 400) || 'Contenu non disponible'}...
`).join('\n---\n')}`;
    }

    return basePrompt;
  }

  private static prepareOpenExercisesForCorrection(
    exercises: SubjectExercise[],
    userAnswers: Array<{exerciseId: string, answer: any}>
  ): Array<{
    exercise: SubjectExercise;
    userAnswer: any;
    correctAnswer: string;
  }> {
    return exercises.map(ex => {
      const userAnswer = userAnswers.find(ua => ua.exerciseId === ex.id);
      
      return {
        exercise: ex,
        userAnswer: userAnswer?.answer || 'Pas de réponse',
        correctAnswer: ex.correctAnswer || `Réponse attendue pour : ${ex.question}`
      };
    });
  }

  private static processSubjectExerciseResults(exerciseResults: any[], exercises: SubjectExercise[]): any[] {
    return exerciseResults?.map((er: any) => {
      const actualExercise = exercises.find(ex => ex.id === er.exerciseId);
      const actualMaxScore = actualExercise ? actualExercise.points : Number(er.maxScore) || 1;
      
      const cleanScore = isNaN(Number(er.score)) ? 0 : Number(er.score);
      let finalScore = Math.min(cleanScore, actualMaxScore);
      
      // Fix pour les réponses correctes
      const aiSaysCorrect = er.isCorrect === true || er.isCorrect === 'true';
      if (aiSaysCorrect && finalScore < actualMaxScore) {
        console.log(`🔧 [SUBJECT-SCORING-FIX] Exercice ${er.exerciseId}: L'IA dit correct mais score partiel ${finalScore}/${actualMaxScore} → Correction à ${actualMaxScore}/${actualMaxScore}`);
        finalScore = actualMaxScore;
      }
      
      return {
        exerciseId: er.exerciseId,
        userAnswer: er.userAnswer || '',
        correctAnswer: er.correctAnswer || '',
        score: finalScore,
        maxScore: actualMaxScore,
        isCorrect: (finalScore === actualMaxScore),
        explanation: er.explanation || ''
      };
    }) || [];
  }

  private static recalculateSubjectScores(detailedScoring: any[]): {
    realTotalScore: number;
    realMaxScore: number;
    realPercentage: number;
    realAdaptedGrade: number;
  } {
    const realTotalScore = detailedScoring.reduce((sum: number, er: any) => {
      const score = isNaN(er.score) ? 0 : Number(er.score);
      return sum + score;
    }, 0);
    
    const realMaxScore = detailedScoring.reduce((sum: number, er: any) => {
      const maxScore = isNaN(er.maxScore) ? 0 : Number(er.maxScore);
      return sum + maxScore;
    }, 0);
    
    const realPercentage = realMaxScore > 0 ? (realTotalScore / realMaxScore) * 100 : 0;
    const realAdaptedGrade = (realPercentage * 20) / 100;

    return {
      realTotalScore,
      realMaxScore,
      realPercentage,
      realAdaptedGrade
    };
  }

  /**
   * Génère des suggestions IA pour les questions fermées incorrectes
   */
  private static async generateSuggestionsForClosedQuestions(
    autoCorrections: any[],
    questions: Question[],
    request: QuizCorrectionRequest
  ): Promise<any[]> {
    // Questions qui nécessitent une suggestion (pas parfait)
    const questionsNeedingSuggestions = autoCorrections.filter(
      c => c.score < c.maxScore
    );

    if (questionsNeedingSuggestions.length === 0) {
      return autoCorrections; // Toutes les réponses sont parfaites
    }

    console.log(`💡 [SUGGESTIONS] Génération suggestions IA pour ${questionsNeedingSuggestions.length} questions fermées incorrectes`);

    try {
      // Construire un prompt pour les suggestions
      const suggestionsPrompt = `Tu es un tuteur pédagogue. Pour chaque question fermée mal répondue ci-dessous, fournis UNE COURTE SUGGESTION (max 50 mots) pour aider l'élève.

Format: {"questionId": "id", "suggestion": "votre conseil"}

Questions:
${questionsNeedingSuggestions.map(qr => {
  const question = questions.find(q => q.id === qr.questionId);
  return `ID: ${qr.questionId}
Question: ${question?.question}
Réponse élève: ${qr.userAnswer}
Bonne réponse: ${qr.correctAnswer}`;
}).join('\n---\n')}

Réponds UNIQUEMENT en JSON array valide.`;

      const result = await AIService.generateContent({
        prompt: suggestionsPrompt,
        maxTokens: Math.min(questionsNeedingSuggestions.length * 150, 3000),
        temperature: 0.5,
        model: AIService.getDefaultModel()
      });

      const suggestionsData = JsonUtils.extractJsonFromText(result.content);
      const suggestionsMap = new Map();
      
      if (Array.isArray(suggestionsData)) {
        suggestionsData.forEach((item: any) => {
          if (item.questionId && item.suggestion) {
            suggestionsMap.set(item.questionId, item.suggestion);
          }
        });
      }

      // Fusionner les suggestions avec les corrections
      return autoCorrections.map(correction => ({
        ...correction,
        suggestion: suggestionsMap.get(correction.questionId)
      }));
    } catch (error) {
      console.error('❌ Erreur génération suggestions:', error);
      // Retourner sans suggestions si erreur
      return autoCorrections;
    }
  }

  /**
   * Corrige une seule question ouverte avec l'IA
   */
  private static async correctSingleOpenQuestion(
    question: OpenQuestion,
    userAnswer: UserAnswer | undefined,
    request: QuizCorrectionRequest
  ): Promise<any> {
    const basePrompt = this.buildSingleOpenQuestionPrompt(question, userAnswer, request);

    const result = await AIService.generateContent({
      prompt: basePrompt,
      maxTokens: 1500,
      temperature: 0.3,
      model: AIService.getDefaultModel()
    });

    const correctionData = JsonUtils.extractJsonFromText(result.content);

    return {
      questionId: question.id,
      userAnswer: userAnswer?.answer || 'Pas de réponse',
      correctAnswer: question.expectedAnswer || '',
      score: Number(correctionData.score) || 0,
      maxScore: question.points || 1,
      isCorrect: (Number(correctionData.score) || 0) === (question.points || 1),
      explanation: correctionData.explanation || '',
      suggestion: correctionData.suggestion || ''
    };
  }

  /**
   * Construit le prompt pour corriger une seule question ouverte
   */
  private static buildSingleOpenQuestionPrompt(
    question: OpenQuestion,
    userAnswer: UserAnswer | undefined,
    request: QuizCorrectionRequest
  ): string {
    let basePrompt = `Tu es un correcteur expert. Corrige cette question ouverte avec rigueur académique.

QUESTION :
${question.question}

NIVEAU : ${request.schoolLevel}
POINTS POSSIBLES : ${question.points || 1}
DIFFICULTÉ : ${question.difficulty || 'moyen'}

RÉPONSE ATTENDUE :
${question.expectedAnswer || 'Réponse libre à évaluer'}

RÉPONSE DE L'ÉLÈVE :
${userAnswer?.answer || 'Pas de réponse fournie'}`;

    // Ajouter le contexte des cours si disponible
    if (request.coursesOnly && request.workspaceContent && request.workspaceContent.length > 0) {
      const workspaceInfo = request.workspaceContent.map(ws => ({
        workspace: ws.workspaceName,
        topics: ws.contentSummary.mainTopics.join(', '),
        content: ws.extractedContent.slice(0, 2).map((c: any) => c.content).join('\n\n')
      }));
      
      basePrompt += `

CONTENU DES COURS DE RÉFÉRENCE :
${workspaceInfo.map(ws => `
Workspace: ${ws.workspace}
Sujets: ${ws.topics}
Contenu:
${ws.content}
`).join('\n---\n')}

CONSIGNES : Base ta correction STRICTEMENT sur le contenu fourni.`;
    }

    basePrompt += `

STRUCTURE JSON REQUISE :
{
  "score": <nombre entre 0 et ${question.points || 1}>,
  "isCorrect": <boolean>,
  "explanation": "Explication de la correction",
  "suggestion": "Conseil pour l'élève si réponse imparfaite"
}

Réponds UNIQUEMENT en JSON valide.`;

    return basePrompt;
  }

  /**
   * Génère une analyse détaillée IA après correction
   */
  private static async generateDetailedAnalysis(
    questions: Question[],
    corrections: any[],
    request: QuizCorrectionRequest,
    totalScore: number,
    maxScore: number,
    percentage: number
  ): Promise<{
    summary: string;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    personalizedTips: string[];
  }> {
    try {
      console.log('🧠 [ANALYSIS] Génération analyse IA détaillée...');

      const correctAnswers = corrections.filter(c => c.score === c.maxScore).length;
      const partialAnswers = corrections.filter(c => c.score > 0 && c.score < c.maxScore).length;
      const incorrectAnswers = corrections.filter(c => c.score === 0).length;

      const analysisPrompt = `Tu es un tuteur pédagogue expert. Génère une analyse détaillée et personnalisée du quiz basée sur les résultats suivants:

RÉSULTATS DU QUIZ:
- Score: ${totalScore}/${maxScore} (${percentage.toFixed(1)}%)
- Questions correctes: ${correctAnswers}/${questions.length}
- Questions partielles: ${partialAnswers}/${questions.length}
- Questions incorrectes: ${incorrectAnswers}/${questions.length}
- Niveau scolaire: ${request.schoolLevel}
- Sujet: ${request.specificSubject || 'général'}

DÉTAIL DES RÉPONSES:
${corrections.map((c, i) => `
Q${i + 1} (${c.isCorrect ? '✓' : '✗'}, ${c.score}/${c.maxScore} pts):
- Réponse élève: ${c.userAnswer}
- Réponse correcte: ${c.correctAnswer}
- Explication: ${c.explanation}
`).join('\n')}

Génère une analyse JSON avec:
1. "summary": Un résumé personnalisé (2-3 phrases) basé sur la performance globale
2. "strengths": 3-4 points forts observés dans les réponses
3. "weaknesses": 3-4 axes d'amélioration identifiés
4. "recommendations": 4-5 recommandations concrètes et personnalisées pour progresser
5. "personalizedTips": 2-3 conseils spécifiques basés sur les erreurs commises

Format JSON STRICT requis.`;

      const result = await AIService.generateContent({
        prompt: analysisPrompt,
        maxTokens: 2500,
        temperature: 0.7,
        model: AIService.getDefaultModel()
      });

      console.log('🧠 [ANALYSIS] Réponse IA reçue, parsing...');
      const analysisData = JsonUtils.extractJsonFromText(result.content);

      return {
        summary: analysisData.summary || 'Analyse non disponible',
        strengths: Array.isArray(analysisData.strengths) ? analysisData.strengths : [],
        weaknesses: Array.isArray(analysisData.weaknesses) ? analysisData.weaknesses : [],
        recommendations: Array.isArray(analysisData.recommendations) ? analysisData.recommendations : [],
        personalizedTips: Array.isArray(analysisData.personalizedTips) ? analysisData.personalizedTips : []
      };
    } catch (error) {
      console.error('❌ [ANALYSIS] Erreur génération analyse:', error);
      return {
        summary: 'Analyse en cours...',
        strengths: [],
        weaknesses: [],
        recommendations: [],
        personalizedTips: []
      };
    }
  }
} 