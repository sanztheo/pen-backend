import {
  QuestionType,
  SchoolLevel,
  CollegeGrade,
  QuizPreset,
  ExamSubject,
  QuizGenerationRequest,
} from "../types.js";
import {
  CollegePrompts,
  LyceePrompts,
  SuperieurPrompts,
} from "../levels/index.js";
import { getBrevetPrompt } from "../presets/brevet/index.js";
import { getBacPrompt } from "../presets/bac/index.js";
import { getPartielsPrompt } from "../presets/partiels/index.js";
import { getFewShotPrompt } from "../assistant/fewShotExamples.js";

/**
 * Utilitaires pour la génération de prompts IA
 */
export class PromptUtils {
  /**
   * Génère un prompt adapté selon le context : preset spécialisé ou niveau personnalisé
   */
  static getGenerationPrompt(request: QuizGenerationRequest): string {
    // Si c'est un preset, utiliser le prompt spécialisé
    if (request.preset && request.preset !== QuizPreset.NONE) {
      return this.getPresetPrompt(
        request.preset,
        request.specificSubject,
        request,
      );
    }

    // Pour les quiz personnalisés, construire un prompt adapté aux paramètres
    const specialtiesDebug =
      request.specialties ||
      request.lyceeSpecialties ||
      request.selectedSpecialties;
    console.log(
      `📚 [CUSTOM] Génération prompt personnalisé: ${request.schoolLevel} - Spécialités: ${specialtiesDebug?.join(", ") || "N/A"} - Types: ${request.questionTypes?.join(", ") || "N/A"}`,
    );
    return this.getCustomPrompt(request);
  }

  /**
   * Génère un prompt personnalisé basé sur les paramètres spécifiques de l'utilisateur
   * 🎓 NOUVEAUTÉ : Intégration automatique Few-Shot pour génération sans RAG
   */
  static getCustomPrompt(request: QuizGenerationRequest): string {
    // Base du prompt selon le niveau
    let basePrompt = this.getGenerationPromptByLevel(
      request.schoolLevel,
      request.collegeGrade,
    );

    // 🎓 FEW-SHOT : Ajouter les exemples calibrés si PAS de RAG
    // Détection : ragContext vide → Few-Shot activé automatiquement
    const ragContextProvided =
      request.ragContext && request.ragContext.trim().length > 0;
    const shouldActivateFewShot = !ragContextProvided;

    if (shouldActivateFewShot) {
      console.log(
        `🎓 [FEW-SHOT] Génération SANS RAG détectée - Ajout des exemples calibrés`,
      );
      console.log(
        `🎓 [FEW-SHOT] Contexte RAG: ${ragContextProvided ? "OUI" : "NON"} - Few-Shot: ACTIVÉ`,
      );
      const fewShotPrompt = getFewShotPrompt(
        request.schoolLevel,
        request.collegeGrade,
      );
      basePrompt += "\n\n" + fewShotPrompt;
      console.log(
        `🎓 [FEW-SHOT] Exemples intégrés pour améliorer la qualité sans documents`,
      );
    } else {
      console.log(
        `📚 [RAG] Génération AVEC contexte RAG - Few-Shot désactivé (non nécessaire)`,
      );
      console.log(
        `📚 [RAG] Taille contexte: ${request.ragContext?.length || 0} caractères`,
      );
    }

    // Construire les spécifications personnalisées
    let customizations = [];

    // Spécialités/matières (vérifier à la fois specialties, lyceeSpecialties et selectedSpecialties)
    const specialtiesList =
      request.specialties ||
      request.lyceeSpecialties ||
      request.selectedSpecialties;
    if (specialtiesList && specialtiesList.length > 0) {
      const specialtiesStr = specialtiesList
        .map((s) => {
          // Conversion des codes en noms lisibles
          const specialtyNames: Record<string, string> = {
            MATHEMATIQUES: "Mathématiques",
            PHYSIQUE_CHIMIE: "Physique-Chimie",
            SVT: "Sciences de la Vie et de la Terre",
            HISTOIRE_GEO: "Histoire-Géographie",
            SES: "Sciences Économiques et Sociales",
            NSI: "Numérique et Sciences Informatiques",
            SI: "Sciences de l'Ingénieur",
            PHILOSOPHIE: "Philosophie",
            LANGUES: "Langues Vivantes",
            LITTERATURE: "Littérature",
            ARTS: "Arts",
          };
          return specialtyNames[s] || s;
        })
        .join(", ");
      customizations.push(
        `- MATIÈRES SPÉCIFIQUES : Concentre-toi UNIQUEMENT sur ${specialtiesStr}`,
      );
    }

    // Niveau et filière études supérieures
    if (request.schoolLevel === "ETUDES_SUPERIEURES") {
      // Niveau d'études (L1, L2, L3, M1, M2, Doctorat, BTS, DUT, Prépa)
      if (request.higherEdLevel) {
        const levelLabels: Record<string, string> = {
          L1: "Licence 1ère année (L1)",
          L2: "Licence 2ème année (L2)",
          L3: "Licence 3ème année (L3)",
          M1: "Master 1ère année (M1)",
          M2: "Master 2ème année (M2)",
          Doctorat: "Doctorat / Thèse",
          BTS: "BTS (Bac+2 professionnel)",
          DUT: "DUT / BUT (Bac+2/3 technologique)",
          Prépa: "Classes préparatoires (CPGE)",
        };
        const levelLabel =
          levelLabels[request.higherEdLevel] || request.higherEdLevel;
        customizations.push(
          `- NIVEAU D'ÉTUDES : Adapte la complexité et les attentes au niveau ${levelLabel}`,
        );
      }

      // Filière d'études
      if (request.higherEdField) {
        customizations.push(
          `- FILIÈRE D'ÉTUDES : Toutes les questions doivent être spécifiques à ${request.higherEdField}`,
        );
      }
    }

    // Types de questions avec répartition équitable OBLIGATOIRE
    if (request.questionTypes && request.questionTypes.length > 0) {
      const typeNames: Record<string, string> = {
        MULTIPLE_CHOICE: "Questions à choix multiples (QCM)",
        TRUE_FALSE: "Questions Vrai/Faux",
        OPEN_QUESTION: "Questions ouvertes",
        MATCHING: "Questions d'association",
      };

      const questionCount = request.questionCount || 10;
      const typeCount = request.questionTypes.length;

      if (typeCount === 1) {
        // Un seul type : toutes les questions de ce type
        const typeName =
          typeNames[request.questionTypes[0]] || request.questionTypes[0];
        customizations.push(
          `- TYPES DE QUESTIONS : Génère ${questionCount} questions EXCLUSIVEMENT de type ${typeName}`,
        );
      } else {
        // Plusieurs types : répartition équitable OBLIGATOIRE
        const basePerType = Math.floor(questionCount / typeCount);
        const remainder = questionCount % typeCount;

        let distributionDetails: string[] = [];
        request.questionTypes.forEach((type, index) => {
          const countForThisType = basePerType + (index < remainder ? 1 : 0);
          const typeName = typeNames[type] || type;
          distributionDetails.push(
            `${countForThisType} questions de type ${typeName}`,
          );
        });

        customizations.push(
          `- RÉPARTITION OBLIGATOIRE DES TYPES : Sur ${questionCount} questions totales, génère EXACTEMENT :`,
        );
        distributionDetails.forEach((detail) => {
          customizations.push(`  • ${detail}`);
        });
        customizations.push(
          `-  CRITIQUE : Cette répartition est STRICTEMENT OBLIGATOIRE. Ne génère PAS uniquement des QCM !`,
        );
      }
    }

    // Difficulté
    const difficulty = (request as unknown as { difficulty?: unknown })
      .difficulty;
    if (typeof difficulty === "string" && difficulty !== "adaptatif") {
      customizations.push(
        `- NIVEAU DE DIFFICULTÉ : ${difficulty.toUpperCase()}`,
      );
    }

    // Note cible
    if (request.targetGrade) {
      customizations.push(
        `- OBJECTIF : Vise une note de ${request.targetGrade}/20`,
      );
    }

    // Construire le prompt final
    if (customizations.length > 0) {
      let customPrompt =
        basePrompt +
        `

PARAMÈTRES PERSONNALISÉS OBLIGATOIRES :
${customizations.join("\n")}

IMPORTANT : Respecte STRICTEMENT ces paramètres. Ne génère aucune question en dehors des matières/types spécifiés.

 RÈGLES ABSOLUES :
- Si seules les "Questions ouvertes" sont demandées, ne génère AUCUNE question de type MULTIPLE_CHOICE, TRUE_FALSE, ou MATCHING
- Si plusieurs types sont demandés, RÉPARTIS-LES ÉQUITABLEMENT (ex: 4 questions avec QCM+OPEN → 2 QCM + 2 OPEN)
- Ne génère JAMAIS uniquement des QCM si d'autres types sont dans la liste demandée
- Si une matière spécifique est demandée (ex: NSI), ne génère AUCUNE question d'autres matières
- Chaque question doit correspondre EXACTEMENT aux critères spécifiés
- CONTRÔLE FINAL : Vérifie que tu as bien respecté la répartition des types avant de finaliser`;

      // Ajouter les instructions spécifiques aux types de questions si spécifiés
      if (request.questionTypes && request.questionTypes.length > 0) {
        const typeInstructions = request.questionTypes
          .map((type) => this.getQuestionTypePrompt(type))
          .join("\n");
        customPrompt += `\n\nINSTRUCTIONS SPÉCIFIQUES AUX TYPES DE QUESTIONS :\n${typeInstructions}`;

        // Rappel critique de la répartition pour plusieurs types
        if (request.questionTypes.length > 1) {
          customPrompt += `\n\n🚨 RAPPEL CRITIQUE DE RÉPARTITION :
Avec ${request.questionTypes.length} types demandés pour ${request.questionCount || 10} questions :
- Ne génère PAS uniquement des QCM même si c'est plus facile !
- Répartis équitablement entre TOUS les types demandés
- Exemple concret : Si tu demandes QCM + Questions ouvertes pour 4 questions → génère 2 QCM + 2 Questions ouvertes
- Vérification finale obligatoire : Compte le nombre de questions de chaque type avant de finaliser`;
        }
      }

      return customPrompt;
    }

    return basePrompt;
  }

  /**
   * Génère un prompt spécialisé pour les presets d'examens
   */
  static getPresetPrompt(
    preset: QuizPreset,
    subject?: ExamSubject,
    request?: QuizGenerationRequest,
  ): string {
    switch (preset) {
      case QuizPreset.BREVET:
        if (subject) {
          console.log(`📝 [BREVET] Génération prompt pour: ${subject}`);
          return getBrevetPrompt(subject, request?.collegeGrade);
        }
        // Vérifier s'il y a un specificSubject dans la requête
        if (request?.specificSubject) {
          console.log(
            `📝 [BREVET] Génération prompt pour specificSubject: ${request.specificSubject}`,
          );
          return getBrevetPrompt(
            request.specificSubject,
            request?.collegeGrade,
          );
        }
        console.log(`📝 [BREVET] Génération prompt par défaut: FRANCAIS`);
        return getBrevetPrompt(ExamSubject.FRANCAIS, request?.collegeGrade);

      case QuizPreset.BAC:
        if (subject) {
          console.log(`🎓 [BAC] Génération prompt pour: ${subject}`);
          return getBacPrompt(subject, request?.lyceeSpecialties);
        }
        // Vérifier s'il y a un specificSubject dans la requête
        if (request?.specificSubject) {
          console.log(
            `🎓 [BAC] Génération prompt pour specificSubject: ${request.specificSubject}`,
          );
          return getBacPrompt(
            request.specificSubject,
            request?.lyceeSpecialties,
          );
        }
        console.log(`🎓 [BAC] Génération prompt par défaut: PHILOSOPHIE`);
        return getBacPrompt(ExamSubject.PHILOSOPHIE, request?.lyceeSpecialties);

      case QuizPreset.PARTIELS:
        if (subject && request?.higherEdField) {
          // Pour les partiels, on utilise le nom de la matière spécifique
          const subjectName = this.getPartielsSubjectName(request, subject);
          console.log(
            `📚 [PARTIELS] Génération prompt pour: ${request.higherEdField} - ${subjectName}`,
          );
          return getPartielsPrompt(request.higherEdField, subjectName);
        }
        // Vérifier s'il y a un specificSubject dans la requête
        if (request?.specificSubject && request?.higherEdField) {
          const subjectName = this.getPartielsSubjectName(
            request,
            request.specificSubject,
          );
          console.log(
            `📚 [PARTIELS] Génération prompt pour specificSubject: ${request.higherEdField} - ${subjectName}`,
          );
          return getPartielsPrompt(request.higherEdField, subjectName);
        }
        console.log(
          `📚 [PARTIELS] Génération prompt par défaut: ${request?.higherEdField || "Général"}`,
        );
        return getPartielsPrompt(
          request?.higherEdField || "Général",
          "Matière générale",
        );

      default:
        console.log(
          `⚠️ [PRESET] Preset non reconnu: ${preset}, fallback vers prompt générique`,
        );
        // Fallback vers le prompt générique
        return this.getGenerationPromptByLevel(
          request?.schoolLevel || SchoolLevel.COLLEGE,
          request?.collegeGrade,
        );
    }
  }

  /**
   * Obtient le nom de la matière pour les partiels
   */
  private static getPartielsSubjectName(
    request: QuizGenerationRequest,
    subject: ExamSubject,
  ): string {
    // Utiliser le nom stocké dans subjectResults quand disponible
    if (
      request.sequentialConfig &&
      typeof request.sequentialConfig.currentSubjectIndex === "number"
    ) {
      const currentSubjectResult =
        request.sequentialConfig.subjectResults?.[
          request.sequentialConfig.currentSubjectIndex
        ];

      // Utiliser le nom personnalisé stocké si disponible
      if (currentSubjectResult?.subjectName) {
        return currentSubjectResult.subjectName;
      }
    }
    return "Matière générale";
  }

  /**
   * Génère un prompt adapté au niveau scolaire et à la classe spécifique (méthode legacy)
   */
  static getGenerationPromptByLevel(
    level: SchoolLevel,
    collegeGrade?: CollegeGrade,
  ): string {
    if (level === "COLLEGE" && collegeGrade) {
      return CollegePrompts.getPromptByGrade(collegeGrade);
    }

    switch (level) {
      case "COLLEGE":
        return CollegePrompts.getGeneralCollegePrompt();

      case "LYCEE_SECONDE":
        return LyceePrompts.getSecondePrompt();

      case "LYCEE_PREMIERE":
        return LyceePrompts.getPremierePrompt();

      case "LYCEE_TERMINALE":
        return LyceePrompts.getTerminalePrompt();

      case "ETUDES_SUPERIEURES":
        // Note: higherEdLevel is handled via customizations in getCustomPrompt
        // This is the base prompt, level-specific details are added separately
        return SuperieurPrompts.getPrompt();

      default:
        return `
Tu es un enseignant expérimenté. Génère des questions adaptées au niveau d'études spécifié.
- Adapte le vocabulaire et la complexité au niveau
- Questions claires et bien structurées
- Encourage la réflexion et l'apprentissage`;
    }
  }

  /**
   * Templates de prompts par type de question
   */
  static getQuestionTypePrompt(type: QuestionType): string {
    const typePrompts = {
      [QuestionType.MULTIPLE_CHOICE]: `
Génère des questions à choix multiples (QCM) avec :
- 4 options de réponse (A, B, C, D)
- UNE seule bonne réponse
- 3 distracteurs plausibles mais incorrects
- Des options équilibrées en longueur
- ⚠️ RÈGLE CRITIQUE : TOUTES les 4 options DOIVENT être DIFFÉRENTES
- ⚠️ INTERDIT ABSOLU : Aucune option ne doit avoir le même texte qu'une autre
- ⚠️ VÉRIFICATION OBLIGATOIRE : Avant de finaliser, vérifie qu'aucune option n'est en doublon
`,
      [QuestionType.TRUE_FALSE]: `
Génère des questions Vrai/Faux avec :
- Une affirmation claire et précise
- Une réponse binaire (vrai ou faux)
- Une explication de la bonne réponse
- Évite les pièges trop subtils
`,
      [QuestionType.OPEN_QUESTION]: `
Génère des questions ouvertes avec :
- Une question claire nécessitant une réponse rédigée
- Des mots-clés attendus dans la réponse
- Une longueur de réponse estimée (nombre de mots)
- Des critères d'évaluation précis
`,
      [QuestionType.MATCHING]: `
Génère des questions d'appariement avec :
- 2 colonnes à associer (5-6 éléments chacune)
- Des correspondances logiques et claires
- Évite les ambiguïtés dans les associations
- Un mélange de l'ordre des éléments
- ⚠️ RÈGLE CRITIQUE : TOUS les éléments de chaque colonne DOIVENT être UNIQUES
- ⚠️ INTERDIT ABSOLU : Aucun doublon dans leftColumn ni dans rightColumn
- ⚠️ VÉRIFICATION OBLIGATOIRE : Avant de finaliser, vérifie qu'il n'y a aucun élément en doublon
`,
    };
    return typePrompts[type];
  }

  /**
   * Génère le template d'instructions pour les questions
   */
  static getQuestionInstructionsTemplate(): string {
    return `
IMPORTANT :
- Pour chaque question de type MULTIPLE_CHOICE, ajoute obligatoirement un champ "options" qui est un tableau de 4 objets, chacun ayant :
  - id: "A", "B", "C" ou "D"
  - text: le texte de la réponse
  - isCorrect: true ou false
- ⚠️ RÈGLE ABSOLUE POUR LES QCM : Les 4 options DOIVENT être TOTALEMENT DIFFÉRENTES
  - Chaque option doit avoir un texte UNIQUE et DISTINCT
  - INTERDIT : Avoir deux options avec le même texte (même si légèrement différentes)
  - OBLIGATOIRE : Vérifie qu'aucune option n'est en doublon avant de finaliser
- Exemple de question MULTIPLE_CHOICE attendue :
{
  "id": "1",
  "type": "MULTIPLE_CHOICE",
  "question": "Quelle est la planète la plus proche du Soleil ?",
  "difficulty": "facile",
  "points": 1,
  "category": "Astronomie",
  "timeEstimate": 20,
  "latexRequired": false,
  "latexHint": "",
  "options": [
    { "id": "A", "text": "Mercure", "isCorrect": true },
    { "id": "B", "text": "Vénus", "isCorrect": false },
    { "id": "C", "text": "Terre", "isCorrect": false },
    { "id": "D", "text": "Mars", "isCorrect": false }
  ]
}
- Pour chaque question de type TRUE_FALSE, utilise ce format :
  - correctAnswer: true ou false (JAMAIS de string)
  - explanation: explication de la bonne réponse
- Exemple de question TRUE_FALSE attendue :
{
  "id": "1",
  "type": "TRUE_FALSE",
  "question": "Vrai ou faux : La Terre tourne autour du Soleil en 365 jours.",
  "difficulty": "facile",
  "points": 1,
  "category": "Astronomie",
  "timeEstimate": 15,
  "latexRequired": false,
  "latexHint": "",
  "correctAnswer": true,
  "explanation": "La Terre met environ 365,25 jours pour faire une révolution complète autour du Soleil."
}
- Pour chaque question de type MATCHING, utilise ce format :
  - leftColumn : tableau d'objets { id, text } pour les TERMES/CONCEPTS à associer (ex: A, B, C, D)
  - rightColumn : tableau d'objets { id, text } pour les DÉFINITIONS/EXPLICATIONS (ex: 1, 2, 3, 4)
  - correctMatches : tableau d'objets { leftId, rightId } pour les bonnes associations

RÈGLES CRUCIALES POUR MATCHING :
1. La leftColumn doit contenir les TERMES/CONCEPTS (courts, précis)
2. La rightColumn doit contenir les DÉFINITIONS/EXPLICATIONS (plus détaillées)
3. OBLIGATOIRE: leftColumn et rightColumn doivent avoir EXACTEMENT le même nombre d'éléments
4. Ne JAMAIS mettre le même contenu dans les deux colonnes
5. Les textes des colonnes doivent être DIFFÉRENTS et complémentaires
6. Chaque élément de leftColumn doit avoir EXACTEMENT une correspondance dans rightColumn
7. ⚠️ RÈGLE ABSOLUE : Aucun élément ne doit apparaître en doublon dans leftColumn
8. ⚠️ RÈGLE ABSOLUE : Aucun élément ne doit apparaître en doublon dans rightColumn
9. ⚠️ VÉRIFICATION OBLIGATOIRE : Avant de finaliser, vérifie qu'il n'y a AUCUN doublon dans les deux colonnes

- Exemple CORRECT de question MATCHING :
{
  "id": "1",
  "type": "MATCHING",
  "question": "Associe chaque terme scientifique à sa définition :",
  "leftColumn": [
    { "id": "A", "text": "Photosynthèse" },
    { "id": "B", "text": "Écosystème" },
    { "id": "C", "text": "Mitose" }
  ],
  "rightColumn": [
    { "id": "1", "text": "Division cellulaire produisant deux cellules filles identiques" },
    { "id": "2", "text": "Processus de transformation de l'énergie lumineuse en énergie chimique" },
    { "id": "3", "text": "Ensemble des êtres vivants et de leur environnement" }
  ],
  "correctMatches": [
    { "leftId": "A", "rightId": "2" },
    { "leftId": "B", "rightId": "3" },
    { "leftId": "C", "rightId": "1" }
  ]
}
- Pour les autres types de questions, garde la structure précédente.
`;
  }

  /**
   * Génère les instructions pour LaTeX
   */
  static getLatexInstructions(): string {
    return `
6. Pour les questions ouvertes, indique si LaTeX est requis :
   - latexRequired: true si la réponse nécessite des formules mathématiques/chimiques
   - latexRequired: false si la réponse est purement textuelle
   - latexHint: donne une indication claire sur l'utilisation du LaTeX

EXEMPLES D'UTILISATION DU LaTeX :
- latexRequired: true, latexHint: "Utilisez LaTeX pour les formules mathématiques (ex: x^2 + 2x + 1 = 0)"
- latexRequired: true, latexHint: "Écrivez la formule chimique en LaTeX (ex: H_2O, CO_2)"
- latexRequired: false, latexHint: "Expliquez votre raisonnement en français"
- latexRequired: true, latexHint: "Donnez la solution avec les calculs en LaTeX"
`;
  }
}
