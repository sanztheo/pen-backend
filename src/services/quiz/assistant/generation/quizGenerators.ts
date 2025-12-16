// assistant/generation/quizGenerators.ts - Générateurs de quiz via Assistant API

import {
  createThread as createAssistantThread,
  addMessageToThread,
  runAssistantOnThread,
  waitForRunCompletion,
} from "../thread.js";
import { ASSISTANT_ID, ASSISTANT_ID_DOCUMENTS } from "../index.js";
import { assistantFileManager } from "../fileManager.js";
import {
  STATIC_BASE_INSTRUCTIONS,
  STATIC_DOCUMENT_INSTRUCTIONS,
  STATIC_GRAPHICS_INSTRUCTIONS,
  buildCachedPrompt,
  buildFullCachedPrompt,
  buildDynamicQuizContent,
} from "../promptCache.js";
import { formatSpecialtyLabel } from "../config/index.js";
import type {
  QuizPreset,
  Difficulty,
  GraphicType,
  GraphicLibrary,
  GenerateQuizOptions,
  GenerateQuizWithGraphicsOptions,
  GenerateQuizWithDocumentsOptions,
  GenerateQuizWithFullDocumentsOptions,
  GenerateCompleteQuizOptions,
  GenerateStandardQuizOptions,
  GenerateGraphicOptions,
} from "../types/index.js";

/**
 * Classe pour la génération de quiz via l'Assistant API OpenAI
 */
export class QuizGenerators {
  private assistantId: string;

  constructor(assistantId?: string) {
    this.assistantId = assistantId || ASSISTANT_ID;
    if (!this.assistantId) {
      throw new Error(
        "ASSISTANT_ID non défini dans les variables d'environnement",
      );
    }
  }

  /**
   * Génère un quiz personnalisé via l'assistant
   */
  async generateQuiz(options: GenerateQuizOptions): Promise<any> {
    console.log(
      "🚀 Assistant Principal (system prompt supprimé) avec Prompt Caching 2024",
    );
    const threadId = await createAssistantThread();

    // Contenu dynamique (paramètres variables)
    const dynamicContent = buildDynamicQuizContent({
      level:
        options.preset === "BREVET"
          ? "COLLEGE"
          : options.preset === "BAC"
            ? "LYCEE"
            : "SUPERIEUR",
      preset: options.preset,
      subject: options.subject,
      questionCount: options.numQuestions,
      questionTypes: options.questionTypes || ["QCM"],
      difficulty: options.difficulty,
      includeDocuments: options.includeDocuments,
      includeGraphics: options.includeGraphics,
      documentTopics: options.documentTopics,
    });

    // Construction du prompt COMPLET (system + user) optimisé pour le cache
    const optimizedPrompt = buildFullCachedPrompt("PRINCIPAL", dynamicContent, {
      includeDocuments: options.includeDocuments,
      includeGraphics: options.includeGraphics,
      includeCorrection: false,
    });

    console.log(
      `📊 Assistant Principal Caching - Prompt: ${Math.round(optimizedPrompt.length / 1024)}KB`,
    );

    await addMessageToThread(threadId, optimizedPrompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Génère un quiz basé sur un preset prédéfini
   */
  async generatePresetQuiz(
    preset: QuizPreset,
    subject?: string,
    questionCount: number = 10,
  ): Promise<any> {
    console.log("🚀 Preset Quiz avec Prompt Caching OpenAI 2024");
    const threadId = await createAssistantThread();

    // PROMPT CACHING: Instructions complètes pour preset (documents + graphiques)
    const staticInstructions =
      STATIC_BASE_INSTRUCTIONS +
      "\n\n" +
      STATIC_DOCUMENT_INSTRUCTIONS +
      "\n\n" +
      STATIC_GRAPHICS_INSTRUCTIONS;

    // Paramètres dynamiques pour preset
    const dynamicContent = buildDynamicQuizContent({
      level:
        preset === "BREVET"
          ? "COLLEGE"
          : preset === "BAC"
            ? "LYCEE"
            : "SUPERIEUR",
      preset: preset,
      subject: subject || `Sujet général ${preset}`,
      questionCount: questionCount,
      questionTypes: ["QCM", "VRAI_FAUX"],
      includeDocuments: true, // Presets utilisent toujours des documents
      includeGraphics: preset === "BAC", // Graphiques pour BAC uniquement
      specificSubject: subject,
    });

    const optimizedPrompt = buildCachedPrompt(
      staticInstructions,
      dynamicContent,
    );
    console.log(
      `📊 Preset Caching - Taille: ${Math.round(optimizedPrompt.length / 1024)}KB`,
    );

    await addMessageToThread(threadId, optimizedPrompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Génère un quiz avec graphiques pédagogiques
   */
  async generateQuizWithGraphics(options: GenerateQuizWithGraphicsOptions): Promise<any> {
    const threadId = await createAssistantThread();

    const questionTypesText =
      options.questionTypes && options.questionTypes.length > 0
        ? `\n🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
        : "\n📝 Types de questions : Utilise la répartition par défaut du system prompt";

    const prompt = `Génère un quiz avec graphiques pour ${options.preset} sur "${options.subject}".${questionTypesText}

1. D'abord utilise generate_graphic pour créer un graphique pédagogique ${options.graphicType || "2d"} avec ${options.library || "apexcharts"}
2. Puis utilise generate_questions_array pour créer ${options.numQuestions} questions basées sur ce graphique
3. Niveau de difficulté: ${options.difficulty || "moyen"}

Assure-toi que les questions exploitent bien l'analyse graphique.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    const result = await waitForRunCompletion(threadId, runId);

    // Créer subjects pour les presets si un subject existe, sinon créer un subject par défaut
    if (result) {
      if (result.subject && result.subject.questions) {
        result.subjects = [result.subject];
        result.subjectBased = true;
        console.log(
          "✅ Subject transformé en subjects pour mode preset (graphics):",
          {
            subjectTitle: result.subject.title,
            questionsCount: result.subject.questions.length,
          },
        );
      } else if (result.questions && result.questions.length > 0) {
        // Créer un subject par défaut si pas de subject mais des questions
        result.subject = {
          id: "default-graphics-subject",
          title: `Quiz ${options.preset} - ${options.subject}`,
          questions: result.questions,
          graphics: result.graphics,
          difficulty: options.difficulty || "moyen",
        };
        result.subjects = [result.subject];
        result.subjectBased = true;
        console.log("✅ Subject par défaut créé pour quiz graphique:", {
          subjectTitle: result.subject.title,
          questionsCount: result.questions.length,
          graphicsCount: result.graphics?.length || 0,
        });
      }
    }

    return result;
  }

  /**
   * Génère un quiz avec documents Wikipedia
   */
  async generateQuizWithDocuments(options: GenerateQuizWithDocumentsOptions): Promise<any> {
    const threadId = await createAssistantThread();

    const topicsText = options.documentTopics
      ? ` avec les topics: ${options.documentTopics.join(", ")}`
      : "";

    const questionTypesText =
      options.questionTypes && options.questionTypes.length > 0
        ? `\n🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
        : "\n📝 Types de questions : Utilise la répartition par défaut du system prompt (60% basées sur documents, 40% connaissances générales)";

    const prompt = `Génère un quiz documentaire pour ${options.preset} sur "${options.subject}".${questionTypesText}

1. D'abord utilise generate_subject_with_documents pour enrichir le sujet avec des documents Wikipedia${topicsText}
2. Puis utilise generate_questions_array pour créer ${options.numQuestions} questions
3. Niveau de difficulté: ${options.difficulty || "moyen"}

Équilibre bien questions documentaires et questions de connaissances.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    const result = await waitForRunCompletion(threadId, runId);

    // Transformer documents en sourceDocuments pour la compatibilité
    if (result && result.documents && result.documents.length > 0) {
      result.sourceDocuments = result.documents;
      result.hasDocuments = true;
    }

    return result;
  }

  /**
   * Génère un quiz avec documents complets via File Upload
   * Contourne la limite des Function Calls en uploadant les documents comme fichiers
   */
  async generateQuizWithFullDocuments(options: GenerateQuizWithFullDocumentsOptions): Promise<any> {
    try {
      console.log(
        `📚 Génération quiz avec ${options.documents.length} documents complets...`,
      );

      // 1. Upload des documents comme fichiers Assistant
      const fileIds = await assistantFileManager.uploadDocuments(
        options.documents,
      );

      // 2. Créer le thread Assistant
      const threadId = await createAssistantThread();

      // 3. Prompt spécialisé pour les documents uploadés
      const documentsInfo = options.documents
        .map((doc) => `- "${doc.title}" (ID: ${doc.id})`)
        .join("\n");

      const questionTypesText =
        options.questionTypes && options.questionTypes.length > 0
          ? `   - 🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n   - ⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
          : `   - 📝 Types de questions : Respecte la répartition par défaut de 80% questions ouvertes (OPEN_QUESTION) et 20% QCM (MULTIPLE_CHOICE)`;

      const prompt = `Génère un quiz documentaire COMPLET pour ${options.preset} sur "${options.subject}".

🔹 DOCUMENTS DISPONIBLES: ${fileIds.length} fichiers Wikipedia uploadés avec contenu INTEGRAL
   - ${documentsInfo}
🔹 IDs des fichiers techniques: ${fileIds.join(", ")}

SÉQUENCE OBLIGATOIRE À SUIVRE:
1. ÉTAPE 1: Utilise generate_subject_with_documents en référençant les fichiers uploadés. Dans les métadonnées, utilise les VRAIS titres des documents fournis ci-dessus.
2. ÉTAPE 2: Utilise generate_questions_array pour créer ${options.numQuestions} questions.
   - 60% des questions basées sur le contenu RÉEL des documents uploadés.
   - 40% des questions de connaissances générales du niveau ${options.preset} sur le sujet "${options.subject}".
${questionTypesText}
   - Niveau: ${options.difficulty || "moyen"}

INSTRUCTIONS CRITIQUES:
- Tu DOIS appeler les 2 fonctions dans l'ordre: generate_subject_with_documents PUIS generate_questions_array.
- Les questions documentaires doivent porter sur les documents fournis (ex: "Dans le document 'Musée d'Orsay', quel artiste est mentionné ?").
- NE PAS inventer de titres de documents. Utilise ceux que j'ai fournis.
- Respecte IMPÉRATIVEMENT la répartition 60/40 (document/connaissance) ET la répartition des types de questions.

IMPORTANT: Cette génération nécessite OBLIGATOIREMENT les 2 étapes. Ne t'arrête pas après la première fonction !`;

      await addMessageToThread(threadId, prompt);

      // Utiliser l'Assistant principal pour la génération (gpt-4o)
      const assistantId = ASSISTANT_ID;
      console.log(
        `🚀 Utilisation de l'Assistant principal pour génération avec documents: ${assistantId}`,
      );
      const runId = await runAssistantOnThread(threadId, assistantId);

      // TIMEOUT ADAPTÉ: gpt-4o pour génération avec prompts détaillés
      const result = await waitForRunCompletion(threadId, runId, 120); // 120 × 10s = 20 minutes

      // 4. Ajouter les métadonnées des fichiers au résultat et les documents sources
      if (result) {
        result.fileUploadMetadata = {
          uploadedFiles: fileIds.length,
          fileIds: fileIds,
          documentsInfo: options.documents.map((doc) => ({
            title: doc.title,
            topic: doc.topic,
            contentLength: doc.content.length,
          })),
        };

        // 5. Utiliser les VRAIS documents au lieu des références fictives
        result.sourceDocuments = options.documents.map((doc) => ({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          topic: doc.topic,
          similarity: doc.similarity || 1.0,
          source: doc.source || "Wikipedia",
        }));
        result.hasDocuments = true;
        console.log(
          `✅ Documents réels ajoutés: ${result.sourceDocuments.length} avec contenu complet`,
        );

        // 6. Créer subjects pour les presets si un subject existe
        if (result.subject && result.subject.questions) {
          result.subjects = [result.subject];
          result.subjectBased = true;
          console.log("✅ Subject transformé en subjects pour mode preset:", {
            subjectTitle: result.subject.title,
            questionsCount: result.subject.questions.length,
          });
        }
      }

      console.log(
        `✅ Quiz généré avec succès en utilisant ${fileIds.length} fichiers complets`,
      );
      return result;
    } catch (error) {
      console.error(
        "❌ Erreur génération quiz avec documents complets:",
        error,
      );
      throw error;
    }
  }

  /**
   * Génère un quiz complet avec graphiques ET documents
   */
  async generateCompleteQuiz(options: GenerateCompleteQuizOptions): Promise<any> {
    const threadId = await createAssistantThread();

    const topicsText = options.documentTopics
      ? ` avec les topics: ${options.documentTopics.join(", ")}`
      : "";

    const questionTypesText =
      options.questionTypes && options.questionTypes.length > 0
        ? `\n🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
        : "\n📝 Types de questions : Utilise la répartition par défaut du system prompt";

    const prompt = `Génère un quiz complet multimédia pour ${options.preset} sur "${options.subject}".${questionTypesText}

1. Utilise generate_subject_with_documents pour enrichir avec documents Wikipedia${topicsText}
2. Utilise generate_graphic pour créer des graphiques pédagogiques ${options.graphicType || "2d"} (${options.library || "apexcharts"})
3. Utilise generate_questions_array pour ${options.numQuestions} questions:
   - 30% basées sur graphiques
   - 40% basées sur documents
   - 30% connaissances générales
4. Niveau: ${options.difficulty || "moyen"}

Crée une expérience d'apprentissage riche et variée.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    const result = await waitForRunCompletion(threadId, runId);

    // Transformer documents en sourceDocuments pour la compatibilité
    if (result && result.documents && result.documents.length > 0) {
      result.sourceDocuments = result.documents;
      result.hasDocuments = true;
    }

    // Créer subjects pour les presets si un subject existe
    if (result && result.subject && result.subject.questions) {
      result.subjects = [result.subject];
      result.subjectBased = true;
      console.log(
        "✅ Subject transformé en subjects pour mode preset (complete):",
        {
          subjectTitle: result.subject.title,
          questionsCount: result.subject.questions.length,
        },
      );
    }

    return result;
  }

  /**
   * Génère un quiz standard sans contexte spécial
   */
  async generateStandardQuiz(options: GenerateStandardQuizOptions): Promise<any> {
    const threadId = await createAssistantThread();

    const questionTypesText =
      options.questionTypes && options.questionTypes.length > 0
        ? `\n🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${options.questionTypes.join(", ")}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`
        : "\n📝 Types de questions : Utilise la répartition par défaut du system prompt";

    let prompt = `Génère un quiz standard pour ${options.preset} sur "${options.subject}".${questionTypesText}

Utilise generate_questions_array pour créer ${options.numQuestions} questions de connaissances générales.
Niveau de difficulté: ${options.difficulty || "moyen"}`;

    if (options.specialties && options.specialties.length > 0) {
      prompt += `\nSpécialités ciblées: ${options.specialties.join(", ")}`;
    }

    if (options.targetGrade) {
      prompt += `\nNote cible: ${options.targetGrade}/20`;
    }

    prompt += `\n\nConcentre-toi sur les fondamentaux et la progression pédagogique.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    const assistantResponse = await waitForRunCompletion(threadId, runId);

    // Structurer la réponse avec un titre approprié
    return {
      id: `quiz_${Date.now()}`,
      title: `Quiz ${options.preset} - ${options.subject}`,
      questions: Array.isArray(assistantResponse)
        ? assistantResponse
        : assistantResponse.questions || [],
      metadata: {
        generatedAt: new Date(),
        preset: options.preset,
        subject: options.subject,
        difficulty: options.difficulty || "moyen",
        numQuestions: options.numQuestions,
      },
    };
  }

  /**
   * Génère un graphique pédagogique
   */
  async generateGraphic(options: GenerateGraphicOptions): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Génère un graphique pédagogique avec les spécifications suivantes: ${JSON.stringify(options)}. Utilise la fonction generate_graphic.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Recherche et enrichit un sujet avec des documents
   */
  async enrichSubjectWithDocuments(
    subject: string,
    preset: QuizPreset,
    keywords?: string[],
    maxDocuments = 3,
  ): Promise<any> {
    const threadId = await createAssistantThread();

    const prompt = `Enrichis le sujet "${subject}" pour le niveau ${preset} avec des documents Wikipedia pertinents. Utilise generate_subject_with_documents${keywords ? ` avec les mots-clés: ${keywords.join(", ")}` : ""} et un maximum de ${maxDocuments} documents.`;

    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }

  /**
   * Méthode générique pour interagir directement avec l'assistant
   */
  async chat(message: string): Promise<any> {
    const threadId = await createAssistantThread();

    await addMessageToThread(threadId, message);
    const runId = await runAssistantOnThread(threadId, this.assistantId);

    return await waitForRunCompletion(threadId, runId);
  }
}

// Export d'une instance par défaut
export const quizGenerators = new QuizGenerators();
