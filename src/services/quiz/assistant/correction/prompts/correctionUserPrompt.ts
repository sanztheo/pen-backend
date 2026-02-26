// assistant/correction/prompts/correctionUserPrompt.ts - Prompts utilisateur pour la correction

import { getProfessorCorrectionPrompt } from "../../professorPersonas.js";
import { SchoolLevel } from "../../../types.js";
import type { AnswerValue, CollegeGrade } from "../../../types.js";

/**
 * Interface for quiz answer used in correction prompts
 */
interface CorrectionAnswer {
  questionId: string;
  answer: AnswerValue;
  timeSpent?: number;
  sourceType?: string;
}

/**
 * Interface for quiz option in multiple choice questions
 */
interface CorrectionQuizOption {
  id: string;
  text: string;
  isCorrect?: boolean;
}

/**
 * Interface for quiz question used in correction prompts
 */
interface CorrectionQuizQuestion {
  id: string;
  type: string;
  question: string;
  options?: CorrectionQuizOption[];
}

/**
 * Interface for correction prompt options
 * Note: schoolLevel and collegeGrade accept string for backward compatibility with CorrectQuizOptions
 */
export interface CorrectionPromptOptions {
  questions?: CorrectionQuizQuestion[];
  schoolLevel?: SchoolLevel | string;
  collegeGrade?: CollegeGrade | string;
  [key: string]: unknown;
}

/**
 * Type guard to check if a value is a valid SchoolLevel
 */
function isSchoolLevel(value: unknown): value is SchoolLevel {
  return typeof value === "string" && Object.values(SchoolLevel).includes(value as SchoolLevel);
}

/**
 * Safely convert schoolLevel to SchoolLevel enum with fallback
 */
function toSchoolLevel(value: SchoolLevel | string | undefined): SchoolLevel {
  if (value === undefined) {
    return SchoolLevel.LYCEE_SECONDE;
  }
  if (isSchoolLevel(value)) {
    return value;
  }
  // Fallback for unknown string values
  return SchoolLevel.LYCEE_SECONDE;
}

/**
 * Construit le prompt pour la correction standard
 */
export function buildStandardCorrectionPrompt(
  quizId: string,
  answers: CorrectionAnswer[],
  options?: CorrectionPromptOptions,
): string {
  // Récupérer les questions depuis les options si disponibles
  const questions = options?.questions || [];

  // Intégration du persona professoral adaptatif
  const professorPersona = getProfessorCorrectionPrompt(
    toSchoolLevel(options?.schoolLevel),
    options?.collegeGrade as CollegeGrade | undefined,
  );

  const prompt = `${professorPersona}

CORRIGE CE QUIZ STANDARD

QUIZ ID : ${quizId}
NOMBRE DE RÉPONSES : ${answers.length}

DÉTAIL DES QUESTIONS ET RÉPONSES :
${answers
  .map((answer, index) => {
    const question = questions.find((q: CorrectionQuizQuestion) => q.id === answer.questionId);
    let questionDetails = "";

    if (question) {
      questionDetails = `
   Question: ${question.question || "Non disponible"}
   Type: ${question.type || "UNKNOWN"}`;

      // Pour les QCM, afficher les options et la bonne réponse
      if (question.type === "MULTIPLE_CHOICE" && question.options && question.options.length > 0) {
        const correctOption = question.options.find(
          (opt: CorrectionQuizOption) => opt.isCorrect === true,
        );
        questionDetails += `
   Options disponibles: ${question.options.map((opt: CorrectionQuizOption) => `${opt.id}. ${opt.text}${opt.isCorrect ? " [CORRECTE]" : ""}`).join(", ")}
   Réponse correcte attendue: ${correctOption ? correctOption.id : "AUCUNE_DEFINIE"}`;
      }
    }

    return `
${index + 1}. Question ID: ${answer.questionId}${questionDetails}
   Réponse donnée: "${answer.answer}"
   Temps passé: ${answer.timeSpent || "Non renseigné"}s
---`;
  })
  .join("")}

INSTRUCTIONS DE CORRECTION SPÉCIFIQUES PAR TYPE :

🔹 QUESTIONS À CHOIX MULTIPLES (MULTIPLE_CHOICE) :
- VALIDATION STRICTE : Compare la réponse utilisateur avec l'option marquée "isCorrect": true
- Si la réponse utilisateur = ID de l'option correcte → isCorrect: true, points = pointsTotal
- Si la réponse utilisateur ≠ ID de l'option correcte → isCorrect: false, points = 0
- correctAnswer : ⚠️ RÈGLE ABSOLUE - UNIQUEMENT L'ID/LETTRE ⚠️
  * FORMAT OBLIGATOIRE : Une seule lettre majuscule ("A", "B", "C", ou "D")
  * EXEMPLE CORRECT : correctAnswer: "B"
  * EXEMPLE INTERDIT : correctAnswer: "L'énergie totale d'un système..."
  * INTERDICTION FORMELLE : Ne JAMAIS écrire le texte de la réponse
  * VALIDATION : correctAnswer doit être exactement 1 caractère
- NE JAMAIS donner de points si la réponse ne correspond pas exactement à l'option correcte

🔹 QUESTIONS OUVERTES (OPEN_QUESTION) :
- Évaluation sur le contenu, la pertinence et la justesse de la réponse
- Points partiels possibles selon la qualité de la réponse
- correctAnswer : ⚠️ RÉPONSE MODÈLE COMPLÈTE AVEC DÉMONSTRATION ⚠️
  * Pour les DÉMONSTRATIONS (maths, géométrie, physique) :
    → Inclure TOUTES les étapes du raisonnement (constructions, propriétés, calculs)
    → Format : "Étape 1: ... | Étape 2: ... | Étape 3: ... | Conclusion: ..."
    → INTERDIT : Donner uniquement la conclusion finale
  * Pour les EXPLICATIONS (sciences, histoire, etc.) :
    → Inclure le développement complet, pas seulement la réponse finale
    → Exemples, arguments, justifications détaillées
  * EXEMPLE CORRECT (géométrie) : "Construction: Tracer triangle ABC. Prolonger BC en D. Tracer parallèle à AB passant par C. Propriété: Les angles alternes-internes sont égaux (BC//AB). Calcul: angle ACB + angle BCD = 180° (angles supplémentaires). Donc A + B + C = 180°."
  * EXEMPLE INTERDIT : "La somme des angles d'un triangle est 180°."
- Correction plus nuancée possible (25%, 50%, 75%, 100% des points)

🔹 RÈGLES DE COHÉRENCE OBLIGATOIRES :
- isCorrect et pointsObtained DOIVENT être cohérents
- Si isCorrect = false → pointsObtained = 0 (sauf questions ouvertes avec points partiels)
- Si isCorrect = true → pointsObtained = pointsTotal (pour QCM uniquement)
- L'explication doit refléter exactement le résultat de la correction

🔹 INSTRUCTIONS GÉNÉRALES :
- Respecte le TYPE de chaque question pour adapter ta correction
- Calcule les points obtenus selon le type de question
- Fournis des explications détaillées adaptées au type
- Donne des conseils pédagogiques personnalisés
- Calcule le score global et l'appréciation correspondante

BARÈME FRANÇAIS :
- Très bien : 90-100%
- Bien : 75-89%
- Assez bien : 60-74%
- Passable : 50-59%
- Insuffisant : <50%

GÉNÈRE une correction complète et pédagogique au format JSON strict requis.`;

  return prompt;
}

/**
 * Construit le prompt pour la correction complète
 */
export function buildCompleteCorrectionPrompt(
  quizId: string,
  answers: CorrectionAnswer[],
  options?: CorrectionPromptOptions,
): string {
  // Récupérer les questions depuis les options si disponibles
  const questions = options?.questions || [];

  // Intégration du persona professoral adaptatif
  const professorPersona = getProfessorCorrectionPrompt(
    toSchoolLevel(options?.schoolLevel),
    options?.collegeGrade as CollegeGrade | undefined,
  );

  const prompt = `${professorPersona}

CORRIGE CE QUIZ COMPLET (GRAPHIQUES + DOCUMENTS)

QUIZ ID : ${quizId}
NOMBRE DE RÉPONSES : ${answers.length}
TYPE : Quiz multimédia avec analyse croisée

DÉTAIL DES QUESTIONS ET RÉPONSES :
${answers
  .map((answer, index) => {
    const question = questions.find((q: CorrectionQuizQuestion) => q.id === answer.questionId);
    let questionDetails = "";

    if (question) {
      questionDetails = `
   Question: ${question.question || "Non disponible"}
   Type: ${question.type || "UNKNOWN"}`;

      // Pour les QCM, afficher les options et la bonne réponse
      if (question.type === "MULTIPLE_CHOICE" && question.options && question.options.length > 0) {
        const correctOption = question.options.find(
          (opt: CorrectionQuizOption) => opt.isCorrect === true,
        );
        questionDetails += `
   Options disponibles: ${question.options.map((opt: CorrectionQuizOption) => `${opt.id}. ${opt.text}${opt.isCorrect ? " [CORRECTE]" : ""}`).join(", ")}
   Réponse correcte attendue: ${correctOption ? correctOption.id : "AUCUNE_DEFINIE"}`;
      }
    }

    return `
${index + 1}. Question ID: ${answer.questionId}${questionDetails}
   Réponse donnée: "${answer.answer}"
   Type de source: ${answer.sourceType || "Mixed"}
   Temps passé: ${answer.timeSpent || "Non renseigné"}s
---`;
  })
  .join("")}

INSTRUCTIONS DE CORRECTION SPÉCIFIQUES PAR TYPE :

🔹 QUESTIONS À CHOIX MULTIPLES (MULTIPLE_CHOICE) :
- VALIDATION STRICTE : Compare la réponse utilisateur avec l'option marquée "isCorrect": true
- Si la réponse utilisateur = ID de l'option correcte → isCorrect: true, points = pointsTotal
- Si la réponse utilisateur ≠ ID de l'option correcte → isCorrect: false, points = 0
- correctAnswer : ⚠️ RÈGLE ABSOLUE - UNIQUEMENT L'ID/LETTRE ⚠️
  * FORMAT OBLIGATOIRE : Une seule lettre majuscule ("A", "B", "C", ou "D")
  * EXEMPLE CORRECT : correctAnswer: "B"
  * EXEMPLE INTERDIT : correctAnswer: "L'énergie totale d'un système..."
  * INTERDICTION FORMELLE : Ne JAMAIS écrire le texte de la réponse
  * VALIDATION : correctAnswer doit être exactement 1 caractère
- NE JAMAIS donner de points si la réponse ne correspond pas exactement à l'option correcte

🔹 QUESTIONS OUVERTES (OPEN_QUESTION) :
- Évaluation sur le contenu, la pertinence et la justesse de la réponse
- Points partiels possibles selon la qualité de la réponse
- correctAnswer : ⚠️ RÉPONSE MODÈLE COMPLÈTE AVEC DÉMONSTRATION ⚠️
  * Pour les DÉMONSTRATIONS (maths, géométrie, physique) :
    → Inclure TOUTES les étapes du raisonnement (constructions, propriétés, calculs)
    → Format : "Étape 1: ... | Étape 2: ... | Étape 3: ... | Conclusion: ..."
    → INTERDIT : Donner uniquement la conclusion finale
  * Pour les EXPLICATIONS (sciences, histoire, etc.) :
    → Inclure le développement complet, pas seulement la réponse finale
    → Exemples, arguments, justifications détaillées
  * EXEMPLE CORRECT (géométrie) : "Construction: Tracer triangle ABC. Prolonger BC en D. Tracer parallèle à AB passant par C. Propriété: Les angles alternes-internes sont égaux (BC//AB). Calcul: angle ACB + angle BCD = 180° (angles supplémentaires). Donc A + B + C = 180°."
  * EXEMPLE INTERDIT : "La somme des angles d'un triangle est 180°."
- Correction plus nuancée possible (25%, 50%, 75%, 100% des points)

🔹 RÈGLES DE COHÉRENCE OBLIGATOIRES :
- isCorrect et pointsObtained DOIVENT être cohérents
- Si isCorrect = false → pointsObtained = 0 (sauf questions ouvertes avec points partiels)
- Si isCorrect = true → pointsObtained = pointsTotal (pour QCM uniquement)
- L'explication doit refléter exactement le résultat de la correction

ÉVALUATION DES COMPÉTENCES :
- Analyse visuelle (0-10) : Capacité à interpréter graphiques, schémas, diagrammes
- Analyse textuelle (0-10) : Compréhension et analyse de documents écrits
- Intégration de données (0-10) : Synthèse cohérente de sources multiples
- Raisonnement scientifique (0-10) : Logique et démarche scientifique
- Esprit critique (0-10) : Analyse critique et nuances

INSTRUCTIONS SPÉCIALISÉES :
- Respecte le TYPE de chaque question pour adapter ta correction
- Évalue la qualité de l'analyse graphique pour chaque réponse
- Vérifie la compréhension des documents de référence
- Analyse la capacité de synthèse multi-sources
- Identifie les compétences fortes et les axes d'amélioration
- Propose un parcours d'apprentissage personnalisé avec ressources

GÉNÈRE une évaluation complète des compétences au format JSON strict requis.`;

  return prompt;
}
