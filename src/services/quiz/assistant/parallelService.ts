// assistant/parallelService.ts - Service de génération parallèle avec 2 assistants
import { 
  createThread as createAssistantThread, 
  addMessageToThread, 
  runAssistantOnThread, 
  waitForRunCompletion 
} from './thread.js';
import { ASSISTANT_ID, ASSISTANT_ID_2 } from './index.js';
import { buildFullCachedPrompt, buildDynamicQuizContent } from './promptCache.js';
import fetch from 'node-fetch';

/**
 * Service pour la génération parallèle de quiz avec 2 assistants
 * Optimise la génération des séquences preset en répartissant les sujets
 */
export class ParallelAssistantService {
  private assistantId1: string;
  private assistantId2: string;

  constructor() {
    this.assistantId1 = ASSISTANT_ID;
    this.assistantId2 = ASSISTANT_ID_2;
    
    if (!this.assistantId1 || !this.assistantId2) {
      throw new Error('ASSISTANT_ID et ASSISTANT_ID_2 doivent être définis');
    }
    
    console.log(`🚀 ParallelAssistantService initialisé avec:`, {
      assistant1: this.assistantId1.substring(0, 20) + '...',
      assistant2: this.assistantId2.substring(0, 20) + '...'
    });
  }

  /**
   * Génère des quiz pour plusieurs sujets en parallèle
   * NOUVELLE APPROCHE: Un assistant recherche le document, les 2 assistants génèrent des questions sur différentes parties
   */
  async generateQuizSequenceParallel(subjects: Array<{
    id: string;
    title: string;
    preset: 'BREVET' | 'BAC' | 'PARTIELS';
    numQuestions?: number;
    difficulty?: 'facile' | 'moyen' | 'difficile';
    questionTypes?: string[];
    includeGraphics?: boolean;
    includeDocuments?: boolean;
    documentTopics?: string[];
  }>): Promise<Array<{
    subject: string;
    quiz: any;
    generatedBy: 'assistant1' | 'assistant2';
    generationTime: number;
    error?: string;
  }>> {
    
    if (subjects.length === 0) {
      throw new Error('Au moins un sujet requis pour la génération parallèle');
    }

    console.log(`⚡ Démarrage génération parallèle pour ${subjects.length} sujets (nouvelle approche: 1 doc + 2 assistants)`);
    const startTime = Date.now();

    // NOUVELLE APPROCHE: Traiter chaque sujet individuellement avec recherche doc + génération parallèle
    const results = [];
    
    for (const subject of subjects) {
      const subjectStartTime = Date.now();
      console.log(`📚 Traitement du sujet: "${subject.title}"`);
      
      try {
        // 1. DÉTERMINER LE TYPE DE GÉNÉRATION SELON LES FLAGS
        if (subject.includeDocuments && subject.includeGraphics) {
          // CAS 1: DOCUMENTS + GRAPHIQUES
          console.log(`🔍📊 Génération complète avec documents Wikipedia ET graphiques pour "${subject.title}"`);
          const documentSearchResult = await this.searchDocumentForSubject(subject);
          
          if (!documentSearchResult.success) {
            console.error(`❌ Échec recherche documentaire pour ${subject.title}:`, documentSearchResult.error);
            results.push({
              subject: subject.title,
              quiz: null,
              generatedBy: 'assistant1' as const,
              generationTime: Date.now() - subjectStartTime,
              error: `Recherche documentaire échouée: ${documentSearchResult.error}`
            });
            continue;
          }

          const document = documentSearchResult.document;
          console.log(`✅ Document trouvé: ${document.title} (${document.content.length} caractères)`);

          // Génération parallèle avec documents + graphiques
          const questionsPerAssistant = Math.ceil((subject.numQuestions || 10) / 2);
          const [result1, result2] = await Promise.all([
            this.generateQuestionsWithDocumentsAndGraphics(subject, document, questionsPerAssistant, 'assistant1', this.assistantId1),
            this.generateQuestionsWithDocumentsAndGraphics(subject, document, questionsPerAssistant, 'assistant2', this.assistantId2)
          ]);

          if (result1.success && result2.success) {
            const combinedQuiz = {
              title: `Quiz ${subject.preset}: ${subject.title}`,
              sourceDocuments: [document],
              hasDocuments: true,
              hasGraphics: true,
              questions: [...result1.questions, ...result2.questions],
              subjectBased: true,
              subjects: [{
                id: subject.id,
                title: subject.title,
                questions: [...result1.questions, ...result2.questions],
                instructions: `Questions basées sur documents Wikipedia et graphiques pour ${subject.title}`
              }],
              parallelGeneration: {
                method: 'documents_graphics_parallel',
                assistant1_questions: result1.questions.length,
                assistant2_questions: result2.questions.length,
                total_questions: result1.questions.length + result2.questions.length,
                with_documents: true,
                with_graphics: true
              }
            };

            results.push({
              subject: subject.title,
              quiz: combinedQuiz,
              generatedBy: 'both' as any,
              generationTime: Date.now() - subjectStartTime
            });

            console.log(`✅ Quiz collaboratif généré avec documents + graphiques: ${result1.questions.length + result2.questions.length} questions`);
          } else {
            // Fallback
            const fallbackResult = await this.generateSingleQuiz(subject, this.assistantId1);
            results.push({
              subject: subject.title,
              quiz: fallbackResult,
              generatedBy: 'assistant1' as const,
              generationTime: Date.now() - subjectStartTime,
              error: 'Génération parallèle documents+graphiques échouée, fallback utilisé'
            });
          }

        } else if (subject.includeDocuments) {
          // CAS 2: DOCUMENTS SEULEMENT
          // PHASE 1: Un seul assistant (assistant1) recherche et prépare le document Wikipedia
          console.log(`🔍 Phase 1: Recherche documentaire pour "${subject.title}"`);
          const documentSearchResult = await this.searchDocumentForSubject(subject);
          
          if (!documentSearchResult.success) {
            console.error(`❌ Échec recherche documentaire pour ${subject.title}:`, documentSearchResult.error);
            results.push({
              subject: subject.title,
              quiz: null,
              generatedBy: 'assistant1' as const,
              generationTime: Date.now() - subjectStartTime,
              error: `Recherche documentaire échouée: ${documentSearchResult.error}`
            });
            continue;
          }

          const document = documentSearchResult.document;
          console.log(`✅ Document trouvé: ${document.title} (${document.content.length} caractères)`);

          // PHASE 2: Diviser le document en 2 parties pour les 2 assistants
          const midPoint = Math.floor(document.content.length / 2);
          // Trouver une coupure intelligente proche du milieu (fin de phrase)
          let cutPoint = midPoint;
          for (let i = midPoint; i < midPoint + 200 && i < document.content.length; i++) {
            if (document.content[i] === '.' || document.content[i] === '!' || document.content[i] === '?') {
              cutPoint = i + 1;
              break;
            }
          }

          const part1 = {
            ...document,
            content: document.content.substring(0, cutPoint),
            partInfo: `Partie 1/2 (0-${Math.round((cutPoint / document.content.length) * 100)}%)`
          };
          
          const part2 = {
            ...document,
            content: document.content.substring(cutPoint),
            partInfo: `Partie 2/2 (${Math.round((cutPoint / document.content.length) * 100)}-100%)`
          };

          console.log(`✂️ Document divisé: Partie 1 (${part1.content.length} chars) | Partie 2 (${part2.content.length} chars)`);

          // PHASE 3: Les 2 assistants génèrent des questions en parallèle sur leur partie
          console.log(`⚡ Phase 3: Génération parallèle des questions basées sur documents`);
          const questionsPerAssistant = Math.ceil((subject.numQuestions || 10) / 2);
          
          const [result1, result2] = await Promise.all([
            this.generateQuestionsFromDocumentPart(subject, part1, questionsPerAssistant, 'assistant1', this.assistantId1),
            this.generateQuestionsFromDocumentPart(subject, part2, questionsPerAssistant, 'assistant2', this.assistantId2)
          ]);

          // PHASE 4: Combiner les résultats des documents
          if (result1.success && result2.success) {
            const combinedQuiz = {
              title: `Quiz ${subject.preset}: ${subject.title}`,
              sourceDocuments: [document], // Document complet original
              hasDocuments: true,
              questions: [...result1.questions, ...result2.questions],
              subjectBased: true,
              subjects: [{
                id: subject.id,
                title: subject.title,
                questions: [...result1.questions, ...result2.questions],
                instructions: `Questions basées sur le document Wikipedia: "${document.title}"`
              }],
              parallelGeneration: {
                method: 'document_split_parallel',
                assistant1_part: part1.partInfo,
                assistant2_part: part2.partInfo,
                total_questions: result1.questions.length + result2.questions.length,
                document_length: document.content.length
              }
            };

            results.push({
              subject: subject.title,
              quiz: combinedQuiz,
              generatedBy: 'both' as any, // Les 2 assistants ont collaboré
              generationTime: Date.now() - subjectStartTime,
              parallelInfo: {
                assistant1_questions: result1.questions.length,
                assistant2_questions: result2.questions.length,
                document_split: `${part1.content.length}/${part2.content.length} chars`
              }
            });

            console.log(`✅ Quiz collaboratif généré avec documents: ${result1.questions.length + result2.questions.length} questions`);
          } else {
            // Fallback: un seul assistant génère tout avec documents
            console.log(`⚠️ Fallback vers un seul assistant avec documents...`);
            const fallbackResult = await this.generateSingleQuiz(subject, this.assistantId1);
            results.push({
              subject: subject.title,
              quiz: fallbackResult,
              generatedBy: 'assistant1' as const,
              generationTime: Date.now() - subjectStartTime,
              error: 'Génération parallèle avec documents échouée, fallback utilisé'
            });
          }
        } else if (subject.includeGraphics) {
          // CAS 3: GRAPHIQUES SEULEMENT  
          console.log(`📊 Génération parallèle avec graphiques uniquement pour "${subject.title}"`);
          const questionsPerAssistant = Math.ceil((subject.numQuestions || 10) / 2);
          
          // Les 2 assistants génèrent des questions avec graphiques
          const [result1, result2] = await Promise.all([
            this.generateQuestionsWithGraphicsOnly(subject, questionsPerAssistant, 'assistant1', this.assistantId1),
            this.generateQuestionsWithGraphicsOnly(subject, questionsPerAssistant, 'assistant2', this.assistantId2)
          ]);

          if (result1.success && result2.success) {
            const combinedQuiz = {
              title: `Quiz ${subject.preset}: ${subject.title}`,
              sourceDocuments: [],
              hasDocuments: false,
              hasGraphics: true,
              questions: [...result1.questions, ...result2.questions],
              subjectBased: true,
              subjects: [{
                id: subject.id,
                title: subject.title,
                questions: [...result1.questions, ...result2.questions],
                instructions: `Questions avec graphiques pour ${subject.title}`
              }],
              parallelGeneration: {
                method: 'graphics_only_parallel',
                assistant1_questions: result1.questions.length,
                assistant2_questions: result2.questions.length,
                total_questions: result1.questions.length + result2.questions.length,
                with_graphics: true
              }
            };

            results.push({
              subject: subject.title,
              quiz: combinedQuiz,
              generatedBy: 'both' as any,
              generationTime: Date.now() - subjectStartTime,
              parallelInfo: {
                assistant1_questions: result1.questions.length,
                assistant2_questions: result2.questions.length,
                generation_type: 'graphics_based'
              }
            });

            console.log(`✅ Quiz collaboratif généré avec graphiques uniquement: ${result1.questions.length + result2.questions.length} questions`);
          } else {
            // Fallback: un seul assistant génère tout avec graphiques
            console.log(`⚠️ Fallback vers un seul assistant avec graphiques...`);
            const fallbackResult = await this.generateSingleQuiz(subject, this.assistantId1);
            results.push({
              subject: subject.title,
              quiz: fallbackResult,
              generatedBy: 'assistant1' as const,
              generationTime: Date.now() - subjectStartTime,
              error: 'Génération parallèle graphiques échouée, fallback utilisé'
            });
          }

        } else {
          // CAS 4: PAS DE DOCUMENTS NI GRAPHIQUES - GÉNÉRATION PARALLÈLE STANDARD
          console.log(`⚡ Phase unique: Génération parallèle sans documents pour "${subject.title}"`);
          const questionsPerAssistant = Math.ceil((subject.numQuestions || 10) / 2);
          
          // Les 2 assistants génèrent des questions en parallèle SANS documents
          const [result1, result2] = await Promise.all([
            this.generateQuestionsWithoutDocument(subject, questionsPerAssistant, 'assistant1', this.assistantId1),
            this.generateQuestionsWithoutDocument(subject, questionsPerAssistant, 'assistant2', this.assistantId2)
          ]);

          if (result1.success && result2.success) {
            const combinedQuiz = {
              title: `Quiz ${subject.preset}: ${subject.title}`,
              sourceDocuments: [],
              hasDocuments: false,
              questions: [...result1.questions, ...result2.questions],
              subjectBased: true,
              subjects: [{
                id: subject.id,
                title: subject.title,
                questions: [...result1.questions, ...result2.questions],
                instructions: `Questions de connaissances générales sur ${subject.title}`
              }],
              parallelGeneration: {
                method: 'knowledge_split_parallel',
                assistant1_questions: result1.questions.length,
                assistant2_questions: result2.questions.length,
                total_questions: result1.questions.length + result2.questions.length,
                without_documents: true
              }
            };

            results.push({
              subject: subject.title,
              quiz: combinedQuiz,
              generatedBy: 'both' as any,
              generationTime: Date.now() - subjectStartTime,
              parallelInfo: {
                assistant1_questions: result1.questions.length,
                assistant2_questions: result2.questions.length,
                generation_type: 'knowledge_based'
              }
            });

            console.log(`✅ Quiz collaboratif généré sans documents: ${result1.questions.length + result2.questions.length} questions`);
          } else {
            // Fallback: un seul assistant génère tout sans documents
            console.log(`⚠️ Fallback vers un seul assistant sans documents...`);
            const fallbackResult = await this.generateSingleQuiz(subject, this.assistantId1);
            results.push({
              subject: subject.title,
              quiz: fallbackResult,
              generatedBy: 'assistant1' as const,
              generationTime: Date.now() - subjectStartTime,
              error: 'Génération parallèle sans documents échouée, fallback utilisé'
            });
          }
        }

      } catch (error) {
        console.error(`❌ Erreur traitement sujet ${subject.title}:`, error);
        results.push({
          subject: subject.title,
          quiz: null,
          generatedBy: 'assistant1' as const,
          generationTime: Date.now() - subjectStartTime,
          error: error instanceof Error ? error.message : 'Erreur inconnue'
        });
      }
    }

    const totalTime = Date.now() - startTime;
    const successCount = results.filter(r => !r.error).length;
    const avgTime = totalTime / subjects.length;

    console.log(`✅ Génération parallèle terminée:`, {
      totalTime: `${totalTime}ms`,
      successCount: `${successCount}/${subjects.length}`,
      avgTimePerQuiz: `${avgTime}ms`,
      speedup: 'Approche collaborative: 1 doc + 2 assistants'
    });

    return results;
  }

  /**
   * 🆕 MÉTHODES UTILITAIRES WIKIPEDIA API
   */
  private async searchWikipediaAPI(query: string, limit: number = 10): Promise<any[]> {
    try {
      const searchUrl = `https://fr.wikipedia.org/w/api.php?` + new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        format: 'json',
        srlimit: String(limit),
        srprop: 'snippet|titlesnippet|size|wordcount|timestamp',
        origin: '*'
      }).toString();

      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'PenSaaS/1.0 (https://example.com/contact) Research Tool'
        }
      });

      if (!response.ok) {
        throw new Error(`Erreur API Wikipedia: ${response.status}`);
      }

      const data = await response.json() as any;
      return data.query?.search || [];
    } catch (error) {
      console.error('❌ Erreur recherche Wikipedia API:', error);
      return [];
    }
  }

  private async getWikipediaArticleContent(pageId: number, charLimit: number = 30000): Promise<any> {
    try {
      // 🔄 Utilise la même approche améliorée que functions.ts
      console.log(`🔍 Récupération contenu complet pour pageId: ${pageId}...`);
      
      // Première requête : récupérer les infos de base et le titre
      const infoUrl = `https://fr.wikipedia.org/w/api.php?` + new URLSearchParams({
        action: 'query',
        prop: 'info',
        pageids: String(pageId),
        format: 'json',
        inprop: 'url',
        origin: '*'
      }).toString();
      
      const infoResponse = await fetch(infoUrl, {
        headers: { 'User-Agent': 'PenSaaS/1.0 (https://pensaas.com/contact) Educational Tool' }
      });
      
      if (!infoResponse.ok) {
        throw new Error(`Erreur récupération infos: ${infoResponse.status}`);
      }
      
      const infoData = await infoResponse.json() as any;
      const pageInfo = infoData.query?.pages?.[pageId];
      
      if (!pageInfo || pageInfo.missing) {
        throw new Error('Article non trouvé');
      }
      
      // Deuxième requête : récupérer le contenu complet via l'API parse
      const parseUrl = `https://fr.wikipedia.org/w/api.php?` + new URLSearchParams({
        action: 'parse',
        pageid: String(pageId),
        format: 'json',
        prop: 'wikitext',
        origin: '*'
      }).toString();
      
      const parseResponse = await fetch(parseUrl, {
        headers: { 'User-Agent': 'PenSaaS/1.0 (https://pensaas.com/contact) Educational Tool' }
      });
      
      if (!parseResponse.ok) {
        throw new Error(`Erreur récupération parse: ${parseResponse.status}`);
      }
      
      const parseData = await parseResponse.json() as any;
      let wikitext = parseData.parse?.wikitext?.['*'] || '';
      
      // Nettoyer le wikitext pour le convertir en texte lisible
      let cleanText = wikitext
        // Supprimer les références {{...}}
        .replace(/\{\{[^}]*\}\}/g, '')
        // Supprimer les liens internes [[...]]
        .replace(/\[\[([^|\]]+)(\|[^\]]+)?\]\]/g, '$1')
        // Supprimer les liens externes [...]
        .replace(/\[[^\]]+\]/g, '')
        // Supprimer les balises HTML
        .replace(/<[^>]*>/g, '')
        // Supprimer les références <ref>...</ref>
        .replace(/<ref[^>]*>.*?<\/ref>/gs, '')
        // Supprimer les balises simples <ref />
        .replace(/<ref[^>]*\/>/g, '')
        // Nettoyer les espaces multiples
        .replace(/\s+/g, ' ')
        // Nettoyer les sauts de ligne multiples
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
      
      // Si le contenu est toujours trop court, essayer l'ancienne méthode en fallback
      if (cleanText.length < 5000) {
        console.log(`⚠️ Contenu parse trop court (${cleanText.length} chars), fallback vers extracts...`);
        
        const extractUrl = `https://fr.wikipedia.org/w/api.php?` + new URLSearchParams({
          action: 'query',
          prop: 'extracts',
          pageids: String(pageId),
          format: 'json',
          explaintext: '1',
          exsectionformat: 'plain',
          exintro: '0',
          exlimit: '1',
          origin: '*'
        }).toString();
        
        const extractResponse = await fetch(extractUrl, {
          headers: { 'User-Agent': 'PenSaaS/1.0 (https://pensaas.com/contact) Educational Tool' }
        });
        
        if (extractResponse.ok) {
          const extractData = await extractResponse.json() as any;
          const extractText = extractData.query?.pages?.[pageId]?.extract || '';
          if (extractText.length > cleanText.length) {
            cleanText = extractText;
            console.log(`✅ Fallback extracts utilisé: ${cleanText.length} caractères`);
          }
        }
      }
      
      // Limiter la longueur finale pour éviter les problèmes de mémoire
      if (cleanText.length > 200000) {
        console.log(`⚠️ Article très long (${cleanText.length} chars), troncature à 200K`);
        cleanText = cleanText.substring(0, 200000) + "\n\n[Article tronqué pour optimisation]";
      }
      
      console.log(`📄 Article "${pageInfo.title}" récupéré: ${cleanText.length} caractères`);

      return {
        title: pageInfo.title,
        pageid: pageInfo.pageid,
        extract: cleanText,
        url: pageInfo.fullurl || `https://fr.wikipedia.org/wiki/${encodeURIComponent(pageInfo.title)}`
      };
    } catch (error) {
      console.error(`❌ Erreur récupération article ${pageId}:`, error);
      return null;
    }
  }

  /**
   * 🆕 PHASE 1: Assistant intelligent recherche et analyse Wikipedia pour créer un document sur mesure
   * NOUVELLE APPROCHE: Utilise l'API Wikipedia directe + analyse IA pour 6500 caractères adaptés au niveau
   */
  private async searchDocumentForSubject(subject: any): Promise<{
    success: boolean;
    document?: any;
    error?: string;
  }> {
    try {
      console.log(`🔍 Assistant documentaire intelligent pour: "${subject.title}" (niveau ${subject.preset})`);
      
      // NOUVEAU SYSTÈME IA UNIFIÉ - Utilise la fonction generate_subject_with_documents
      console.log(`🚀 Assistant IA unifié pour: "${subject.title}"`);
      
      const threadId = await createAssistantThread();
      
      // Extraction du nom de matière propre pour l'IA
      const subjectName = subject.title.replace(/^(BREVET|BAC|PARTIELS)\s*-\s*/, '').trim();
      
      // Prompt ultra-strict avec format de commande
      const prompt = `INSTRUCTION UNIQUE ET OBLIGATOIRE:

Appelle IMMÉDIATEMENT la fonction "generate_subject_with_documents" avec ces paramètres:

title: "${subject.title}"
description: "Sujet éducatif ${subjectName} niveau ${subject.preset}"
documentTopics: ["${subjectName}"]
questionDistribution: {"facile": 40, "moyen": 40, "difficile": 20}
targetLevel: "${subject.preset}"
specificCompetencies: ["analyse", "synthèse", "connaissances"]
useFileUpload: false

AUCUNE autre action n'est autorisée. N'écris aucun texte. Utilise uniquement la fonction.`;

      await addMessageToThread(threadId, prompt);
      const runId = await runAssistantOnThread(threadId, this.assistantId1);
      const result = await waitForRunCompletion(threadId, runId, 120); // 2 minutes pour analyse complète
      
      if (!result) {
        throw new Error('Aucune réponse de l\'assistant documentaire');
      }

      // Le nouveau workflow : l'assistant fait tout et retourne le résultat complet
      let documentData;
      try {
        // L'assistant a terminé et retourne result.subject avec documents et questions
        if (result.subject && result.subject.documents && result.subject.documents.length > 0) {
          const bestDocument = result.subject.documents[0]; // Le meilleur document sélectionné par l'IA
          documentData = {
            title: bestDocument.title,
            content: bestDocument.content,
            source: bestDocument.source,
            adaptation_level: result.subject.targetLevel,
            sections_used: ["ai_unified_system"],
            content_analysis: `Document IA: ${bestDocument.selectionMethod || 'Sélection automatique'}`,
            articles_analyzed: 1
          };
          console.log('✅ Document récupéré du résultat final:', documentData.title);
        } 
        // Fallback : chercher dans functionResults (ancien système)
        else if (result.functionResults && result.functionResults.length > 0) {
          const docResult = result.functionResults.find((fr: any) => 
            fr.name === 'generate_subject_with_documents'
          );
          
          if (docResult && docResult.result) {
            const functionResult = typeof docResult.result === 'string' 
              ? JSON.parse(docResult.result) 
              : docResult.result;
            
            if (functionResult.subject && functionResult.subject.documents && functionResult.subject.documents.length > 0) {
              const bestDocument = functionResult.subject.documents[0];
              documentData = {
                title: bestDocument.title || functionResult.subject.title,
                content: bestDocument.content,
                source: bestDocument.source || bestDocument.url,
                adaptation_level: functionResult.subject.targetLevel,
                sections_used: ["function_call_legacy"],
                content_analysis: `Document via function call pour ${functionResult.subject.title}`,
                articles_analyzed: functionResult.subject.documents.length
              };
              console.log('✅ Document récupéré via function call (legacy):', documentData.title);
            } else {
              throw new Error('Aucun document trouvé dans le résultat de function call');
            }
          } else {
            throw new Error('Aucun résultat de generate_subject_with_documents trouvé dans functionResults');
          }
        } else {
          throw new Error('Aucun document trouvé ni dans result.subject ni dans functionResults');
        }
      } catch (parseError) {
        console.error('❌ Erreur parsing réponse assistant:', parseError);
        console.error('📊 Détails result:', JSON.stringify(result, null, 2));
        throw new Error('Réponse de l\'assistant non parsable');
      }

      // Validation du document créé (seuil réduit pour l'IA)
      if (!documentData.content || documentData.content.length < 1000) {
        throw new Error(`Document trop court: ${documentData.content?.length || 0} caractères`);
      }
      
      if (documentData.content.length >= 3000) {
        console.log(`✅ Document IA de bonne qualité: ${documentData.content.length} caractères`);
      } else {
        console.log(`⚠️ Document IA court mais utilisable: ${documentData.content.length} caractères`);
      }

      if (documentData.content.length > 7000) {
        console.log(`⚠️ Document trop long (${documentData.content.length} chars), troncature à 6500...`);
        documentData.content = documentData.content.substring(0, 6500);
      }

      const finalDocument = {
        id: `wiki_ai_${Date.now()}`,
        title: documentData.title,
        content: documentData.content,
        source: documentData.source,
        topic: subject.title,
        similarity: 1.0, // Document créé sur mesure
        adaptation_level: documentData.adaptation_level,
        sections_used: documentData.sections_used,
        content_analysis: documentData.content_analysis,
        articles_analyzed: documentData.articles_analyzed,
        generated_by_ai: true,
        wikipedia_api_source: true,
        creation_timestamp: new Date().toISOString()
      };

      console.log(`✅ Document Wikipedia IA créé: "${finalDocument.title}"`);
      console.log(`📊 Longueur: ${finalDocument.content.length} chars, adapté pour ${subject.preset}`);
      console.log(`🔬 Articles analysés: ${finalDocument.articles_analyzed}`);
      console.log(`🎯 Analyse: ${finalDocument.content_analysis}`);
      
      return {
        success: true,
        document: finalDocument
      };

    } catch (error) {
      console.error(`❌ Erreur assistant documentaire pour ${subject.title}:`, error);
      
      // FALLBACK: Utiliser l'ancienne méthode en cas d'échec
      console.log(`🔄 Fallback vers recherche documentaire classique...`);
      try {
        const { documentSearchService } = await import('../documentSearchService.js');
        const searchResult = await documentSearchService.searchDocuments({
          query: subject.title,
          limit: 1,
          similarity_threshold: 0.5,
          topics: subject.documentTopics
        });

        if (searchResult.chunks && searchResult.chunks.length > 0) {
          const fallbackDoc = searchResult.chunks[0];
          console.log(`✅ Fallback réussi: ${fallbackDoc.title} (${fallbackDoc.content.length} chars)`);
          return {
            success: true,
            document: fallbackDoc
          };
        }
      } catch (fallbackError) {
        console.error(`❌ Fallback échoué:`, fallbackError);
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  /**
   * 🆕 GÉNÈRE DES QUESTIONS AVEC DOCUMENTS + GRAPHIQUES avec un assistant spécifique
   */
  private async generateQuestionsWithDocumentsAndGraphics(
    subject: any,
    document: any,
    numQuestions: number,
    assistantName: 'assistant1' | 'assistant2',
    assistantId: string
  ): Promise<{
    success: boolean;
    questions: any[];
    error?: string;
  }> {
    try {
      console.log(`🤖 ${assistantName} génère ${numQuestions} questions avec documents + graphiques sur "${subject.title}"`);
      
      const threadId = await createAssistantThread();
      
      // Prompt pour génération avec documents ET graphiques
      const prompt = `Génère exactement ${numQuestions} questions de niveau ${subject.preset} sur "${subject.title}".

DOCUMENT WIKIPEDIA DISPONIBLE:
"${document.title}"
${document.content}

INSTRUCTIONS:
1. Utilise OBLIGATOIREMENT generate_graphic pour créer des graphiques pédagogiques pertinents
2. Utilise generate_questions_array pour créer ${numQuestions} questions variées:
   - 50% basées sur les GRAPHIQUES générés
   - 50% basées sur le DOCUMENT Wikipedia
3. Assure-toi que les questions sont cohérentes avec le niveau ${subject.preset}
4. Variété de types: QCM, Vrai/Faux, Questions ouvertes, Appariement
5. Les questions graphiques doivent référencer les graphiques créés

Niveau de difficulté: ${subject.difficulty || 'moyen'}`;

      await addMessageToThread(threadId, prompt);
      const runId = await runAssistantOnThread(threadId, assistantId);
      const result = await waitForRunCompletion(threadId, runId, 90); // 1.5 minutes
      
      if (!result || !result.questions || !Array.isArray(result.questions)) {
        throw new Error(`Réponse invalide de ${assistantName}: questions manquantes ou format incorrect`);
      }

      // Marquer les questions
      const questions = result.questions.map((q: any, index: number) => ({
        ...q,
        id: `${assistantName}_${subject.id}_docs_graphics_${index + 1}`,
        basedOnDocument: true,
        documentReference: document.title,
        hasGraphics: true,
        generatedBy: assistantName
      }));

      console.log(`✅ ${assistantName} a généré ${questions.length} questions avec documents + graphiques`);
      
      return {
        success: true,
        questions
      };

    } catch (error) {
      console.error(`❌ Erreur génération questions ${assistantName} (docs+graphiques):`, error);
      return {
        success: false,
        questions: [],
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  /**
   * 🆕 GÉNÈRE DES QUESTIONS AVEC GRAPHIQUES SEULEMENT avec un assistant spécifique
   */
  private async generateQuestionsWithGraphicsOnly(
    subject: any,
    numQuestions: number,
    assistantName: 'assistant1' | 'assistant2',
    assistantId: string
  ): Promise<{
    success: boolean;
    questions: any[];
    error?: string;
  }> {
    try {
      console.log(`🤖 ${assistantName} génère ${numQuestions} questions avec graphiques sur "${subject.title}"`);
      
      const threadId = await createAssistantThread();
      
      // Prompt pour génération avec graphiques uniquement
      const prompt = `Génère exactement ${numQuestions} questions de niveau ${subject.preset} sur "${subject.title}".

INSTRUCTIONS:
1. Utilise OBLIGATOIREMENT generate_graphic pour créer des graphiques pédagogiques pertinents
2. Utilise generate_questions_array pour créer ${numQuestions} questions:
   - 80% basées sur les GRAPHIQUES générés
   - 20% questions théoriques générales
3. Assure-toi que les questions sont cohérentes avec le niveau ${subject.preset}
4. Variété de types: QCM, Vrai/Faux, Questions ouvertes, Appariement
5. Les questions graphiques doivent référencer les graphiques créés
6. Crée des graphiques variés et éducatifs (courbes, histogrammes, schémas, etc.)

Niveau de difficulté: ${subject.difficulty || 'moyen'}`;

      await addMessageToThread(threadId, prompt);
      const runId = await runAssistantOnThread(threadId, assistantId);
      const result = await waitForRunCompletion(threadId, runId, 75); // 1.25 minutes
      
      if (!result || !result.questions || !Array.isArray(result.questions)) {
        throw new Error(`Réponse invalide de ${assistantName}: questions manquantes ou format incorrect`);
      }

      // Marquer les questions
      const questions = result.questions.map((q: any, index: number) => ({
        ...q,
        id: `${assistantName}_${subject.id}_graphics_${index + 1}`,
        basedOnDocument: false,
        documentReference: null,
        hasGraphics: true,
        generatedBy: assistantName
      }));

      console.log(`✅ ${assistantName} a généré ${questions.length} questions avec graphiques`);
      
      return {
        success: true,
        questions
      };

    } catch (error) {
      console.error(`❌ Erreur génération questions ${assistantName} (graphiques):`, error);
      return {
        success: false,
        questions: [],
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  /**
   * 🆕 GÉNÈRE DES QUESTIONS SANS DOCUMENTS avec un assistant spécifique
   */
  private async generateQuestionsWithoutDocument(
    subject: any,
    numQuestions: number,
    assistantName: 'assistant1' | 'assistant2',
    assistantId: string
  ): Promise<{
    success: boolean;
    questions: any[];
    error?: string;
  }> {
    try {
      console.log(`🤖 ${assistantName} génère ${numQuestions} questions de connaissances générales sur "${subject.title}"`);
      
      const threadId = await createAssistantThread();
      
      // Prompt pour la génération de questions sans documents
      const prompt = `Génère exactement ${numQuestions} questions de niveau ${subject.preset} sur "${subject.title}".

INSTRUCTIONS:
1. Utilise generate_questions_array pour créer ${numQuestions} questions variées
2. Base tes questions sur les connaissances générales du programme ${subject.preset}
3. Assure-toi que les questions sont cohérentes avec le niveau ${subject.preset}
4. Couvre différents aspects du sujet "${subject.title}"

Niveau de difficulté: ${subject.difficulty || 'moyen'}
${subject.questionTypes && subject.questionTypes.length > 0 ? 
  `🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${subject.questionTypes.join(', ')}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur` : 
  '📝 Types de questions : Variété de types (QCM, Vrai/Faux, Questions ouvertes, Appariement)'
}`;

      await addMessageToThread(threadId, prompt);
      const runId = await runAssistantOnThread(threadId, assistantId);
      const result = await waitForRunCompletion(threadId, runId, 60); // 1 minute max
      
      if (!result || !result.questions || !Array.isArray(result.questions)) {
        throw new Error(`Réponse invalide de ${assistantName}: questions manquantes ou format incorrect`);
      }

      // Marquer les questions avec l'assistant qui les a générées
      const questions = result.questions.map((q: any, index: number) => ({
        ...q,
        id: `${assistantName}_${subject.id}_knowledge_${index + 1}`,
        basedOnDocument: false,
        documentReference: null,
        generatedBy: assistantName,
        knowledgeBased: true
      }));

      console.log(`✅ ${assistantName} a généré ${questions.length} questions de connaissances générales`);
      
      return {
        success: true,
        questions
      };

    } catch (error) {
      console.error(`❌ Erreur génération questions ${assistantName} sans documents:`, error);
      return {
        success: false,
        questions: [],
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  /**
   * 🆕 PHASE 3: Génère des questions à partir d'une partie de document avec un assistant spécifique
   */
  private async generateQuestionsFromDocumentPart(
    subject: any,
    documentPart: any,
    numQuestions: number,
    assistantName: 'assistant1' | 'assistant2',
    assistantId: string
  ): Promise<{
    success: boolean;
    questions: any[];
    error?: string;
  }> {
    try {
      console.log(`🤖 ${assistantName} génère ${numQuestions} questions sur ${documentPart.partInfo} (${documentPart.content.length} chars)`);
      
      const threadId = await createAssistantThread();
      
      // Prompt spécialisé pour la génération de questions sur une partie de document
      const prompt = `Génère exactement ${numQuestions} questions de niveau ${subject.preset} sur "${subject.title}".

DOCUMENT SOURCE (${documentPart.partInfo}):
"${documentPart.title}"

CONTENU À ANALYSER:
${documentPart.content}

INSTRUCTIONS:
1. Utilise generate_questions_array pour créer ${numQuestions} questions variées
2. Base tes questions UNIQUEMENT sur le contenu fourni ci-dessus
3. Assure-toi que les questions sont cohérentes avec le niveau ${subject.preset}
4. Variété de types: QCM, Vrai/Faux, Questions ouvertes, Appariement
5. Toutes les questions doivent pouvoir être répondues avec le contenu fourni

Niveau de difficulté: ${subject.difficulty || 'moyen'}`;

      await addMessageToThread(threadId, prompt);
      const runId = await runAssistantOnThread(threadId, assistantId);
      const result = await waitForRunCompletion(threadId, runId, 60); // 10 minutes max
      
      if (!result || !result.questions || !Array.isArray(result.questions)) {
        throw new Error(`Réponse invalide de ${assistantName}: questions manquantes ou format incorrect`);
      }

      // Marquer les questions avec l'assistant qui les a générées
      const questions = result.questions.map((q: any, index: number) => ({
        ...q,
        id: `${assistantName}_${subject.id}_${index + 1}`,
        basedOnDocument: true,
        documentReference: documentPart.title,
        documentPart: documentPart.partInfo,
        generatedBy: assistantName
      }));

      console.log(`✅ ${assistantName} a généré ${questions.length} questions sur ${documentPart.partInfo}`);
      
      return {
        success: true,
        questions
      };

    } catch (error) {
      console.error(`❌ Erreur génération questions ${assistantName}:`, error);
      return {
        success: false,
        questions: [],
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  /**
   * Génère des quiz pour un assistant spécifique (ANCIENNE MÉTHODE - conservée pour fallback)
   */
  private async generateWithAssistant(
    subjects: Array<any>, 
    assistantName: 'assistant1' | 'assistant2',
    assistantId: string
  ): Promise<Array<{
    subject: string;
    quiz: any;
    generatedBy: 'assistant1' | 'assistant2';
    generationTime: number;
    error?: string;
  }>> {
    
    if (subjects.length === 0) {
      return [];
    }

    console.log(`🤖 ${assistantName} génère ${subjects.length} quiz...`);
    
    const results = await Promise.all(
      subjects.map(async (subject) => {
        const startTime = Date.now();
        
        try {
          const quiz = await this.generateSingleQuiz(subject, assistantId);
          const generationTime = Date.now() - startTime;
          
          console.log(`✅ ${assistantName} terminé: "${subject.title}" en ${generationTime}ms`);
          
          return {
            subject: subject.title,
            quiz,
            generatedBy: assistantName,
            generationTime
          };
          
        } catch (error) {
          const generationTime = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          console.error(`❌ ${assistantName} échec: "${subject.title}" - ${errorMessage}`);
          
          return {
            subject: subject.title,
            quiz: null,
            generatedBy: assistantName,
            generationTime,
            error: errorMessage
          };
        }
      })
    );

    const successCount = results.filter(r => !r.error).length;
    console.log(`🏁 ${assistantName} terminé: ${successCount}/${subjects.length} réussis`);
    
    return results;
  }

  /**
   * Génère un quiz pour un sujet donné avec un assistant spécifique
   */
  private async generateSingleQuiz(subject: any, assistantId: string): Promise<any> {
    const threadId = await createAssistantThread();
    
    // Construire le prompt selon le type de quiz demandé
    let prompt = this.buildQuizPrompt(subject);
    
    await addMessageToThread(threadId, prompt);
    const runId = await runAssistantOnThread(threadId, assistantId);
    
    // Timeout adapté (plus court car parallèle)
    const result = await waitForRunCompletion(threadId, runId, 90); // 90 * 10s = 15min
    
    // Post-traitement pour assurer la compatibilité
    return this.processQuizResult(result, subject);
  }

  /**
   * Construit le prompt optimisé selon le type de quiz
   */
  private buildQuizPrompt(subject: any): string {
    const {
      title,
      preset,
      numQuestions = 10,
      difficulty = 'moyen',
      questionTypes,
      includeGraphics,
      includeDocuments,
      documentTopics
    } = subject;

    let prompt = `Génère un quiz COMPLET pour ${preset} sur "${title}".`;

    // Type de génération selon les options
    if (includeDocuments && includeGraphics) {
      // Quiz complet (documents + graphiques)
      prompt += `\n\n1. Utilise generate_subject_with_documents pour enrichir avec documents Wikipedia`;
      if (documentTopics && documentTopics.length > 0) {
        prompt += ` (topics: ${documentTopics.join(', ')})`;
      }
      prompt += `\n   IMPORTANT: Recherche 1-2 documents longs de minimum 6000 caractères chacun`;
      prompt += `\n   Préfère la qualité et la profondeur à la quantité`;
      prompt += `\n2. Utilise generate_graphic pour créer des graphiques pédagogiques`;
      prompt += `\n3. Utilise generate_questions_array pour ${numQuestions} questions:`;
      prompt += `\n   - 30% basées sur graphiques`;
      prompt += `\n   - 40% basées sur documents`;
      prompt += `\n   - 30% connaissances générales`;
      
    } else if (includeDocuments) {
      // Quiz documentaire
      prompt += `\n\n1. Utilise generate_subject_with_documents pour enrichir avec documents Wikipedia`;
      if (documentTopics && documentTopics.length > 0) {
        prompt += ` (topics: ${documentTopics.join(', ')})`;
      }
      prompt += `\n   IMPORTANT: Recherche 1-2 documents longs de minimum 6000 caractères chacun`;
      prompt += `\n   Préfère la qualité et la profondeur à la quantité`;
      prompt += `\n   Si possible, trouve des articles complets plutôt que des extraits courts`;
      prompt += `\n2. Utilise generate_questions_array pour ${numQuestions} questions:`;
      prompt += `\n   - 60% basées sur documents`;
      prompt += `\n   - 40% connaissances générales`;
      
    } else if (includeGraphics) {
      // Quiz avec graphiques
      prompt += `\n\n1. Utilise generate_graphic pour créer des graphiques pédagogiques`;
      prompt += `\n2. Utilise generate_questions_array pour ${numQuestions} questions basées sur les graphiques`;
      
    } else {
      // Quiz standard
      prompt += `\n\nUtilise generate_questions_array pour créer ${numQuestions} questions de connaissances générales.`;
    }

    // Options communes
    prompt += `\nNiveau de difficulté: ${difficulty}`;
    
    if (questionTypes && questionTypes.length > 0) {
      prompt += `\n🚨 TYPES DE QUESTIONS OBLIGATOIRES : Utilise EXCLUSIVEMENT ces types : ${questionTypes.join(', ')}\n⛔ INTERDIT : Tout autre type de question non spécifié par l'utilisateur`;
    } else {
      prompt += `\n📝 Types de questions : Utilise la répartition par défaut du system prompt`;
    }

    prompt += `\n\nCrée un quiz pédagogique et progressif adapté au niveau ${preset}.`;

    return prompt;
  }

  /**
   * Post-traite le résultat pour assurer la compatibilité
   */
  private processQuizResult(result: any, subject: any): any {
    if (!result) {
      throw new Error('Aucun résultat de l\'assistant');
    }

    // Assurer la structure subjects pour les presets
    if (result.subject && result.subject.questions && !result.subjects) {
      result.subjects = [result.subject];
      result.subjectBased = true;
    }

    // Transformer documents en sourceDocuments si nécessaire
    if (result.documents && result.documents.length > 0 && !result.sourceDocuments) {
      result.sourceDocuments = result.documents;
      result.hasDocuments = true;
    }

    // Ajouter metadata de génération parallèle
    result.parallelGeneration = {
      generatedInParallel: true,
      subjectTitle: subject.title,
      preset: subject.preset,
      timestamp: new Date().toISOString()
    };

    return result;
  }

  /**
   * 🆕 GÉNÉRATION PARALLÈLE POUR UN SEUL SUJET (20 questions = 10+10)
   * Méthode spécialement ajoutée pour diviser le travail entre 2 assistants sur 1 sujet
   */
  async generateSingleSubjectParallel(subject: {
    id: string;
    title: string;
    preset: 'BREVET' | 'BAC' | 'PARTIELS';
    numQuestions?: number;
    difficulty?: 'facile' | 'moyen' | 'difficile';
    questionTypes?: string[];
    includeGraphics?: boolean;
    includeDocuments?: boolean;
    documentTopics?: string[];
  }): Promise<{
    success: boolean;
    quiz?: any;
    error?: string;
    parallelInfo?: {
      assistant1_questions: number;
      assistant2_questions: number;
      generation_method: string;
      total_questions: number;
    };
  }> {
    
    const startTime = Date.now();
    console.log(`⚡ GÉNÉRATION PARALLÈLE INDIVIDUELLE: "${subject.title}" (${subject.numQuestions || 10} questions divisées entre 2 assistants)`);
    
    try {
      const totalQuestions = subject.numQuestions || 10;
      const questionsPerAssistant = Math.ceil(totalQuestions / 2);
      
      // 1. DÉTERMINER LE TYPE DE GÉNÉRATION SELON LES FLAGS
      if (subject.includeDocuments && subject.includeGraphics) {
        // CAS 1: DOCUMENTS + GRAPHIQUES
        console.log(`🔍📊 Génération individuelle parallèle avec documents ET graphiques`);
        const documentSearchResult = await this.searchDocumentForSubject(subject);
        
        if (!documentSearchResult.success) {
          return {
            success: false,
            error: `Recherche documentaire échouée: ${documentSearchResult.error}`
          };
        }

        const document = documentSearchResult.document;
        console.log(`✅ Document trouvé: ${document.title} (${document.content.length} caractères)`);

        // Les 2 assistants génèrent en parallèle avec le même document
        const [result1, result2] = await Promise.all([
          this.generateQuestionsWithDocumentsAndGraphics(subject, document, questionsPerAssistant, 'assistant1', this.assistantId1),
          this.generateQuestionsWithDocumentsAndGraphics(subject, document, questionsPerAssistant, 'assistant2', this.assistantId2)
        ]);

        if (result1.success && result2.success) {
          const combinedQuiz = {
            title: `Quiz ${subject.preset}: ${subject.title}`,
            sourceDocuments: [document],
            hasDocuments: true,
            hasGraphics: true,
            questions: [...result1.questions, ...result2.questions],
            subjectBased: true,
            subjects: [{
              id: subject.id,
              title: subject.title,
              questions: [...result1.questions, ...result2.questions],
              instructions: `Questions basées sur documents Wikipedia et graphiques pour ${subject.title}`
            }],
            parallelGeneration: {
              method: 'single_subject_docs_graphics_parallel',
              assistant1_questions: result1.questions.length,
              assistant2_questions: result2.questions.length,
              total_questions: result1.questions.length + result2.questions.length,
              with_documents: true,
              with_graphics: true,
              generation_time: Date.now() - startTime
            }
          };

          console.log(`✅ Quiz individuel parallèle généré: ${result1.questions.length + result2.questions.length} questions (docs+graphiques)`);
          
          return {
            success: true,
            quiz: combinedQuiz,
            parallelInfo: {
              assistant1_questions: result1.questions.length,
              assistant2_questions: result2.questions.length,
              generation_method: 'docs_graphics_parallel',
              total_questions: result1.questions.length + result2.questions.length
            }
          };
        }

      } else if (subject.includeDocuments) {
        // CAS 2: DOCUMENTS SEULEMENT
        console.log(`🔍 Génération individuelle parallèle avec documents uniquement`);
        const documentSearchResult = await this.searchDocumentForSubject(subject);
        
        if (!documentSearchResult.success) {
          return {
            success: false,
            error: `Recherche documentaire échouée: ${documentSearchResult.error}`
          };
        }

        const document = documentSearchResult.document;
        console.log(`✅ Document trouvé: ${document.title} (${document.content.length} caractères)`);

        // Diviser le document en 2 parties pour les 2 assistants
        const midPoint = Math.floor(document.content.length / 2);
        let cutPoint = midPoint;
        for (let i = midPoint; i < midPoint + 200 && i < document.content.length; i++) {
          if (document.content[i] === '.' || document.content[i] === '!' || document.content[i] === '?') {
            cutPoint = i + 1;
            break;
          }
        }

        const part1 = {
          ...document,
          content: document.content.substring(0, cutPoint),
          partInfo: `Partie 1/2 (0-${Math.round((cutPoint / document.content.length) * 100)}%)`
        };
        
        const part2 = {
          ...document,
          content: document.content.substring(cutPoint),
          partInfo: `Partie 2/2 (${Math.round((cutPoint / document.content.length) * 100)}-100%)`
        };

        console.log(`✂️ Document divisé pour génération parallèle: Partie 1 (${part1.content.length} chars) | Partie 2 (${part2.content.length} chars)`);

        // Les 2 assistants génèrent en parallèle sur leur partie
        const [result1, result2] = await Promise.all([
          this.generateQuestionsFromDocumentPart(subject, part1, questionsPerAssistant, 'assistant1', this.assistantId1),
          this.generateQuestionsFromDocumentPart(subject, part2, questionsPerAssistant, 'assistant2', this.assistantId2)
        ]);

        if (result1.success && result2.success) {
          const combinedQuiz = {
            title: `Quiz ${subject.preset}: ${subject.title}`,
            sourceDocuments: [document],
            hasDocuments: true,
            questions: [...result1.questions, ...result2.questions],
            subjectBased: true,
            subjects: [{
              id: subject.id,
              title: subject.title,
              questions: [...result1.questions, ...result2.questions],
              instructions: `Questions basées sur le document Wikipedia: "${document.title}"`
            }],
            parallelGeneration: {
              method: 'single_subject_document_split_parallel',
              assistant1_part: part1.partInfo,
              assistant2_part: part2.partInfo,
              total_questions: result1.questions.length + result2.questions.length,
              document_length: document.content.length,
              generation_time: Date.now() - startTime
            }
          };

          console.log(`✅ Quiz individuel parallèle généré: ${result1.questions.length + result2.questions.length} questions (documents divisés)`);
          
          return {
            success: true,
            quiz: combinedQuiz,
            parallelInfo: {
              assistant1_questions: result1.questions.length,
              assistant2_questions: result2.questions.length,
              generation_method: 'document_split_parallel',
              total_questions: result1.questions.length + result2.questions.length
            }
          };
        }

      } else if (subject.includeGraphics) {
        // CAS 3: GRAPHIQUES SEULEMENT  
        console.log(`📊 Génération individuelle parallèle avec graphiques uniquement`);
        
        // Les 2 assistants génèrent des questions avec graphiques
        const [result1, result2] = await Promise.all([
          this.generateQuestionsWithGraphicsOnly(subject, questionsPerAssistant, 'assistant1', this.assistantId1),
          this.generateQuestionsWithGraphicsOnly(subject, questionsPerAssistant, 'assistant2', this.assistantId2)
        ]);

        if (result1.success && result2.success) {
          const combinedQuiz = {
            title: `Quiz ${subject.preset}: ${subject.title}`,
            sourceDocuments: [],
            hasDocuments: false,
            hasGraphics: true,
            questions: [...result1.questions, ...result2.questions],
            subjectBased: true,
            subjects: [{
              id: subject.id,
              title: subject.title,
              questions: [...result1.questions, ...result2.questions],
              instructions: `Questions avec graphiques pour ${subject.title}`
            }],
            parallelGeneration: {
              method: 'single_subject_graphics_parallel',
              assistant1_questions: result1.questions.length,
              assistant2_questions: result2.questions.length,
              total_questions: result1.questions.length + result2.questions.length,
              with_graphics: true,
              generation_time: Date.now() - startTime
            }
          };

          console.log(`✅ Quiz individuel parallèle généré: ${result1.questions.length + result2.questions.length} questions (graphiques)`);
          
          return {
            success: true,
            quiz: combinedQuiz,
            parallelInfo: {
              assistant1_questions: result1.questions.length,
              assistant2_questions: result2.questions.length,
              generation_method: 'graphics_parallel',
              total_questions: result1.questions.length + result2.questions.length
            }
          };
        }

      } else {
        // CAS 4: PAS DE DOCUMENTS NI GRAPHIQUES - CONNAISSANCES GÉNÉRALES
        console.log(`⚡ Génération individuelle parallèle sans documents (connaissances générales)`);
        
        // Les 2 assistants génèrent des questions en parallèle SANS documents
        const [result1, result2] = await Promise.all([
          this.generateQuestionsWithoutDocument(subject, questionsPerAssistant, 'assistant1', this.assistantId1),
          this.generateQuestionsWithoutDocument(subject, questionsPerAssistant, 'assistant2', this.assistantId2)
        ]);

        if (result1.success && result2.success) {
          const combinedQuiz = {
            title: `Quiz ${subject.preset}: ${subject.title}`,
            sourceDocuments: [],
            hasDocuments: false,
            questions: [...result1.questions, ...result2.questions],
            subjectBased: true,
            subjects: [{
              id: subject.id,
              title: subject.title,
              questions: [...result1.questions, ...result2.questions],
              instructions: `Questions de connaissances générales sur ${subject.title}`
            }],
            parallelGeneration: {
              method: 'single_subject_knowledge_parallel',
              assistant1_questions: result1.questions.length,
              assistant2_questions: result2.questions.length,
              total_questions: result1.questions.length + result2.questions.length,
              without_documents: true,
              generation_time: Date.now() - startTime
            }
          };

          console.log(`✅ Quiz individuel parallèle généré: ${result1.questions.length + result2.questions.length} questions (connaissances générales)`);
          
          return {
            success: true,
            quiz: combinedQuiz,
            parallelInfo: {
              assistant1_questions: result1.questions.length,
              assistant2_questions: result2.questions.length,
              generation_method: 'knowledge_parallel',
              total_questions: result1.questions.length + result2.questions.length
            }
          };
        }
      }

      // Si aucun cas n'a réussi, fallback vers un seul assistant
      console.log(`⚠️ Fallback: génération avec un seul assistant...`);
      const fallbackResult = await this.generateSingleQuiz(subject, this.assistantId1);
      
      return {
        success: true,
        quiz: fallbackResult,
        parallelInfo: {
          assistant1_questions: fallbackResult.questions?.length || 0,
          assistant2_questions: 0,
          generation_method: 'fallback_single_assistant',
          total_questions: fallbackResult.questions?.length || 0
        }
      };

    } catch (error) {
      console.error(`❌ Erreur génération parallèle individuelle pour ${subject.title}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  /**
   * Méthode de test pour vérifier les deux assistants
   */
  async testBothAssistants(): Promise<{
    assistant1: boolean;
    assistant2: boolean;
    bothWorking: boolean;
  }> {
    console.log('🧪 Test des deux assistants...');
    
    const [test1, test2] = await Promise.all([
      this.testSingleAssistant(this.assistantId1, 'assistant1'),
      this.testSingleAssistant(this.assistantId2, 'assistant2')
    ]);

    const result = {
      assistant1: test1,
      assistant2: test2,
      bothWorking: test1 && test2
    };

    console.log('🧪 Résultat test assistants:', result);
    return result;
  }

  /**
   * Teste un assistant individuel
   */
  private async testSingleAssistant(assistantId: string, name: string): Promise<boolean> {
    try {
      const threadId = await createAssistantThread();
      await addMessageToThread(threadId, 'Test ping - réponds juste "pong"');
      const runId = await runAssistantOnThread(threadId, assistantId);
      
      // Test rapide - on n'attend pas la completion complète
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log(`✅ ${name} (${assistantId.substring(0, 20)}...) - Test OK`);
      return true;
    } catch (error) {
      console.error(`❌ ${name} (${assistantId.substring(0, 20)}...) - Test échoué:`, error);
      return false;
    }
  }

  /**
   * Génère un quiz simple pour test (non-parallèle)
   */
  async generateTestQuiz(
    preset: 'BREVET' | 'BAC' | 'PARTIELS',
    subject: string
  ): Promise<any> {
    console.log(`🧪 Test génération simple: ${preset} - ${subject}`);
    
    const testSubject = {
      id: 'test',
      title: subject,
      preset,
      numQuestions: 3, // Minimal pour test rapide
      difficulty: 'moyen' as const
    };

    return this.generateSingleQuiz(testSubject, this.assistantId1);
  }
}