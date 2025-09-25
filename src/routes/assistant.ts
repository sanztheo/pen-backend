import { Router } from 'express';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - type packages may be missing in dev
import { authenticateToken } from '../middlewares/auth.js';
import { requireAICredits } from '../middlewares/requireAICredits.js';
import { assistantAsk, assistantSearch, assistantCreate, assistantAskStream, assistantSearchStream, assistantCreateStream, assistantClearMemory, wikipediaSearch, wikipediaGetArticle, wikipediaGetEnrichedArticles } from '../controllers/assistant.js';
// @ts-ignore - type packages may be missing in dev
import multer from 'multer';
import { prisma } from '../lib/prisma.js';

const router = Router();

router.use(authenticateToken);

// 🛡️ ROUTES ASSISTANT SÉCURISÉES - Contrôle des crédits IA obligatoire
router.post('/ask', requireAICredits({ cost: 0.5, action: 'assistant_ask' }), assistantAsk);
router.post('/search', requireAICredits({ cost: 0.3, action: 'assistant_search' }), assistantSearch);
router.post('/create', requireAICredits({ cost: 1.0, action: 'assistant_create' }), assistantCreate);
router.post('/ask/stream', requireAICredits({ cost: 0.5, action: 'assistant_ask_stream' }), assistantAskStream);
router.post('/search/stream', requireAICredits({ cost: 0.3, action: 'assistant_search_stream' }), assistantSearchStream);
router.post('/create/stream', requireAICredits({ cost: 1.0, action: 'assistant_create_stream' }), assistantCreateStream);
router.post('/clear-memory', requireAICredits({ cost: 0.1, action: 'assistant_clear_memory' }), assistantClearMemory);

// Routes Wikipedia
router.get('/wikipedia/search', wikipediaSearch);
router.get('/wikipedia/article', wikipediaGetArticle);
router.post('/wikipedia/enriched', wikipediaGetEnrichedArticles);

// Routes de nettoyage RAG
router.post('/rag/preview-cleanup', async (req: any, res) => {
  try {
    const { cleanupService } = await import('../services/rag/cleanup.js');
    const { maxAge = 7, includeUserSources = false } = req.body;
    
    const preview = await cleanupService.previewCleanup(maxAge, includeUserSources);
    res.json({ success: true, ...preview });
  } catch (error) {
    console.error('🚨 Erreur preview cleanup:', error);
    res.status(500).json({ error: 'Erreur lors du preview' });
  }
});

router.post('/rag/cleanup', async (req: any, res) => {
  try {
    const { cleanupService } = await import('../services/rag/cleanup.js');
    const { maxAge = 7, dryRun = true, includeUserSources = false } = req.body;
    
    const stats = await cleanupService.cleanupUnusedSources({
      maxAge,
      dryRun,
      includeUserSources,
      batchSize: 100
    });
    
    res.json({ success: true, ...stats });
  } catch (error) {
    console.error('🚨 Erreur cleanup:', error);
    res.status(500).json({ error: 'Erreur lors du nettoyage' });
  }
});

router.get('/rag/stats', async (req: any, res) => {
  try {
    const { cleanupService } = await import('../services/rag/cleanup.js');
    const stats = await cleanupService.getStorageStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('🚨 Erreur stats:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des stats' });
  }
});

// Route RAG Context Builder
router.post('/rag/context', async (req: any, res) => {
  try {
    const { ragSystem } = await import('../services/rag/index.js');
    const { sessionMemory } = await import('../services/rag/sessionMemory.js');
    const { query, workspaceId, sessionKey, selectedSources } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`🔍 [RAG-DEBUG] Analyse de la query: "${query}"`);
    
    // 🔥 NOUVEAU: Construire le contexte des sources pour l'IA
    let sourcesContext = '';
    if (selectedSources) {
      const { wikipediaSources = [], mentionedPages = [], sourcesScope } = selectedSources;
      if (wikipediaSources.length > 0) {
        sourcesContext += `\nSources Wikipedia sélectionnées: ${wikipediaSources.map((s: { title: string }) => s.title).join(', ')}`;
      }
      if (mentionedPages.length > 0) {
        sourcesContext += `\nPages mentionnées: ${mentionedPages.map((p: { title: string }) => p.title).join(', ')}`;
      }
      if (sourcesScope) {
        sourcesContext += `\nPortée des sources: ${sourcesScope === 'all' ? 'toutes les sources' : 'sources sélectionnées uniquement'}`;
      }
    }

    // 1. Intelligence de requête - Décider si on doit faire du RAG
    // NOUVEAU: Si des sources sont sélectionnées, forcer l'utilisation du RAG
    const hasSelectedSources = selectedSources && (
      (selectedSources.wikipediaSources && selectedSources.wikipediaSources.length > 0) ||
      (selectedSources.mentionedPages && selectedSources.mentionedPages.length > 0) ||
      selectedSources.sourcesScope === 'all'
    );

    // 🔥 NOUVEAU: Si pas de sources sélectionnées, vérifier si une session active existe
    let hasActiveSession = false;
    let activeSessionSources = null;
    if (!hasSelectedSources && req.user) {
      try {
        console.log(`🔍 [RAG-DEBUG] Pas de sources sélectionnées, vérification session active pour userId: ${req.user.id}`);
        const { sessionMemory } = await import('../services/rag/sessionMemory.js');
        const activeSession = await sessionMemory.getActiveSession(req.user.id, workspaceId);

        if (activeSession) {
          hasActiveSession = true;
          activeSessionSources = await sessionMemory.getSessionSources(activeSession.id);
          console.log(`🔍 [RAG-DEBUG] Session RAG active trouvée avec ${activeSessionSources?.length || 0} sources`);
          if (activeSessionSources && activeSessionSources.length > 0) {
            console.log(`🔍 [RAG-DEBUG] Sources de session:`, activeSessionSources.map(s => s.title));
          }
        } else {
          console.log(`🔍 [RAG-DEBUG] Aucune session RAG active trouvée`);
        }
      } catch (error) {
        console.error(`🔍 [RAG-DEBUG] Erreur vérification session:`, error);
      }
    }

    let shouldUseRAG = false;
    if (hasSelectedSources) {
      shouldUseRAG = true;
      console.log(`🔍 [RAG-DEBUG] RAG forcé car des sources sont sélectionnées`);
    } else if (hasActiveSession && activeSessionSources && activeSessionSources.length > 0) {
      shouldUseRAG = true;
      console.log(`🔍 [RAG-DEBUG] RAG forcé car session active avec ${activeSessionSources.length} sources`);
    } else {
      shouldUseRAG = await ragSystem.shouldUseRAG(query);
      console.log(`🔍 [RAG-DEBUG] Analyse IA de la query: ${shouldUseRAG}`);
    }

    console.log(`🔍 [RAG-DEBUG] Doit utiliser RAG: ${shouldUseRAG}`);

    if (!shouldUseRAG) {
      // Pas de RAG pour cette query
      return res.json({
        success: true,
        ragContext: '',
        sessionMemory: '',
        sessionId: null,
        sourcesUsed: [],
        searchResults: [],
        searchResultsCount: 0,
        skipReason: 'Query trop simple/générale pour RAG'
      });
    }

    // 2. Créer ou récupérer la session
    console.log(`🔍 [RAG-DEBUG] SESSION - Création/récupération session pour userId: ${req.user.id}, workspaceId: ${workspaceId}, sessionKey: ${sessionKey}`);
    const sessionId = await sessionMemory.getOrCreateSession(
      req.user.id,
      workspaceId,
      sessionKey
    );
    console.log(`🔍 [RAG-DEBUG] SESSION - Session obtenue: ${sessionId}`);

    // 3. Recherche RAG intelligente
    console.log(`🔍 [RAG-DEBUG] Recherche RAG pour userId: ${req.user.id}, workspaceId: ${workspaceId}, query: "${query}"`);

    // 🔥 NOUVEAU: Si des sources Wikipedia sont sélectionnées OU une session active, récupérer leurs IDs RAG
    let specificSourceIds: string[] = [];
    let sourcesToProcess = [];

    // Sources explicitement sélectionnées
    if (selectedSources && selectedSources.wikipediaSources && selectedSources.wikipediaSources.length > 0) {
      sourcesToProcess = selectedSources.wikipediaSources.map((s: { title: string }) => ({ title: s.title }));
      console.log(`🔍 [RAG-DEBUG] Recherche des IDs pour les sources Wikipedia sélectionnées:`, sourcesToProcess.map((s: { title: string }) => s.title));
    }
    // Sources de session active
    else if (activeSessionSources && activeSessionSources.length > 0) {
      sourcesToProcess = activeSessionSources;
      console.log(`🔍 [RAG-DEBUG] Recherche des IDs pour les sources de session:`, sourcesToProcess.map(s => s.title));
    }

    if (sourcesToProcess.length > 0) {
      const { prisma } = await import('../lib/prisma.js');

      for (const source of sourcesToProcess) {
        try {
          const sourceRecord = await prisma.rAGSource.findFirst({
            where: {
              title: source.title,
              isGlobal: true,
              status: 'COMPLETED'
            },
            select: { id: true }
          });
          if (sourceRecord) {
            specificSourceIds.push(sourceRecord.id);
            console.log(`🔍 [RAG-DEBUG] Source "${source.title}" trouvée avec ID: ${sourceRecord.id}`);
          } else {
            console.warn(`🔍 [RAG-DEBUG] Source "${source.title}" non trouvée dans la base RAG`);
          }
        } catch (error) {
          console.error(`🔍 [RAG-DEBUG] Erreur recherche source "${source.title}":`, error);
        }
      }
      console.log(`🔍 [RAG-DEBUG] IDs sources finaux:`, specificSourceIds);
    }

    let searchResults;
    if (specificSourceIds.length > 0) {
      // 🔥 NOUVEAU: Force une distribution équitable entre les sources sélectionnées
      console.log(`🔍 [RAG-DEBUG] Distribution équitable forcée entre ${specificSourceIds.length} sources`);

      const allResults = [];
      const chunksPerSource = Math.ceil(12 / specificSourceIds.length); // Répartir équitablement

      for (const sourceId of specificSourceIds) {
        console.log(`🔍 [RAG-DEBUG] Recherche ${chunksPerSource} chunks pour source: ${sourceId}`);
        const sourceResults = await ragSystem.intelligentSearch(query, {
          userId: req.user.id,
          workspaceId,
          limit: chunksPerSource,
          specificSourceIds: [sourceId] // Une seule source à la fois
        });
        console.log(`🔍 [RAG-DEBUG] Trouvé ${sourceResults.length} chunks pour source: ${sourceId}`);
        allResults.push(...sourceResults);
      }

      // Mélanger les résultats pour éviter l'ordre par source
      searchResults = allResults.sort(() => Math.random() - 0.5);
      console.log(`🔍 [RAG-DEBUG] Total final: ${searchResults.length} chunks mélangés de ${specificSourceIds.length} sources`);

    } else {
      // Recherche normale si pas de sources spécifiques
      searchResults = await ragSystem.intelligentSearch(query, {
        userId: req.user.id,
        workspaceId,
        limit: 12
      });
    }
    console.log(`🔍 [RAG-DEBUG] Résultats trouvés: ${searchResults.length}`);

    // 4. Construire le contexte optimisé
    const optimizedContext = await ragSystem.buildOptimizedContext(query, searchResults);

    // 5. Récupérer la mémoire de session récente
    const sessionMemoryText = await sessionMemory.getRecentMemory(sessionId, 5);

    // 6. 🔥 NOUVEAU: Sauvegarder les sources utilisées dans la session pour persistance
    console.log(`🔍 [RAG-DEBUG] DIAGNOSTIC - sessionId: ${sessionId}, searchResults.length: ${searchResults.length}`);
    console.log(`🔍 [RAG-DEBUG] DIAGNOSTIC - searchResults types:`, searchResults.map(r => `${r.source.title}(${r.source.sourceType})`));

    if (sessionId && searchResults.length > 0) {
      try {
        console.log(`🔍 [RAG-DEBUG] Sauvegarde des sources dans la session: ${sessionId}`);

        // 🔧 DÉDUPLICATION: Ne sauvegarder que les sources uniques, pas tous les chunks
        const allSources = searchResults.map(r => ({
          id: r.source.id,
          title: r.source.title,
          type: r.source.sourceType || 'wikipedia'
        }));

        // Déduplication par ID source
        const uniqueSourcesMap = new Map();
        allSources.forEach(source => {
          uniqueSourcesMap.set(source.id, source);
        });
        const sourcesToSave = Array.from(uniqueSourcesMap.values());

        console.log(`🔍 [RAG-DEBUG] Sources dédupliquées: ${allSources.length} → ${sourcesToSave.length}`);
        console.log(`🔍 [RAG-DEBUG] Sources à sauvegarder:`, sourcesToSave);

        const saved = await sessionMemory.saveSessionSources(sessionId, sourcesToSave);
        console.log(`🔍 [RAG-DEBUG] Sauvegarde ${saved ? 'réussie' : 'échouée'}: ${searchResults.map(r => r.source.title).join(', ')}`);
      } catch (error) {
        console.error(`🔍 [RAG-DEBUG] Erreur sauvegarde sources session:`, error);
      }
    } else {
      console.log(`🔍 [RAG-DEBUG] Sauvegarde SKIPPÉE - sessionId: ${sessionId ? 'OK' : 'NULL'}, searchResults: ${searchResults.length}`);
    }

    res.json({
      success: true,
      ragContext: optimizedContext,
      sessionMemory: sessionMemoryText,
      sessionId: sessionId,
      sourcesUsed: searchResults.map(r => r.source.title),
      searchResults: searchResults,
      searchResultsCount: searchResults.length
    });

  } catch (error) {
    console.error('Erreur RAG context:', error);
    res.status(500).json({ 
      error: 'Erreur interne du serveur',
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

// Route RAG Wikipedia
router.post('/wikipedia/rag-process', async (req: any, res) => {
  try {
    const { wikipediaRAG } = await import('../services/rag/wikipedia.js');
    const { pageIds, query = 'Articles Wikipedia sélectionnés', mode = 'search', reflection = 'rapide', workspaceId } = req.body;
    
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return res.status(400).json({ error: 'pageIds must be a non-empty array' });
    }

    // Traitement RAG enrichi
    const enrichedResult = await wikipediaRAG.enrichWikipediaContent(
      pageIds,
      query,
      mode,
      reflection
    );

    // Si workspaceId est fourni, sauvegarder les articles comme sources RAG
    if (workspaceId && enrichedResult.articles.length > 0) {
      const articles = enrichedResult.articles.map((article: any, index: number) => ({
        pageid: pageIds[index] || Math.random(),
        title: article.title,
        extract: article.fullContent.slice(0, 500) + '...',
        fullContent: article.fullContent,
        categories: article.categories,
        url: article.url
      }));

      try {
        await wikipediaRAG.processWikipediaArticles(
          req.user.id,
          workspaceId,
          articles
        );
      } catch (error) {
        console.warn('Erreur sauvegarde articles RAG:', error);
      }
    }

    res.json({
      success: true,
      articles: enrichedResult.articles,
      totalTokens: enrichedResult.totalTokens,
      processedForRAG: !!workspaceId
    });

  } catch (error) {
    console.error('Erreur Wikipedia RAG:', error);
    res.status(500).json({ 
      error: 'Erreur interne du serveur',
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

// Route RAG User Pages - Vérification d'embedding existant
router.post('/user-pages/check-embedding', async (req: any, res) => {
  try {
    const { pageId, workspaceId } = req.body;
    
    if (!pageId || !workspaceId) {
      return res.status(400).json({ error: 'pageId and workspaceId are required' });
    }
    
    console.log(`🔍 [USER-PAGES-CHECK] Vérification embedding pageId: ${pageId}, workspaceId: ${workspaceId}`);

    // Récupérer les détails de la page
    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        workspaceId: workspaceId,
        isArchived: false
      },
      select: {
        id: true,
        title: true,
        updatedAt: true
      }
    });

    if (!page) {
      return res.json({
        alreadyEmbedded: false,
        upToDate: false,
        message: 'Page not found'
      });
    }

    try {
      const { userPagesRAG } = await import('../services/rag/userPages.js');
      const existingSource = await userPagesRAG.findExistingSource(
        pageId,
        req.user.id,
        workspaceId
      );
      
      if (!existingSource) {
        return res.json({
          alreadyEmbedded: false,
          upToDate: false,
          message: 'No existing embedding found'
        });
      }
      
      const isUpToDate = new Date(existingSource.updatedAt) >= new Date(page.updatedAt) && 
                         existingSource.status === 'COMPLETED';
      
      res.json({
        alreadyEmbedded: true,
        upToDate: isUpToDate,
        message: isUpToDate 
          ? `Page "${page.title}" already embedded and up-to-date`
          : `Page "${page.title}" embedded but outdated`
      });

    } catch (error) {
      console.error('🧠 [RAG] Service user pages non disponible:', error);
      res.json({
        alreadyEmbedded: false,
        upToDate: false,
        message: 'RAG service unavailable'
      });
    }

  } catch (error) {
    console.error('🚨 Erreur User Pages Check:', error);
    res.status(500).json({ 
      error: 'Erreur interne du serveur',
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

// Route RAG User Pages - Embedding immédiat à la sélection
router.post('/user-pages/rag-process', async (req: any, res) => {
  try {
    const { pageIds, workspaceId } = req.body;
    
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return res.status(400).json({ error: 'pageIds must be a non-empty array' });
    }
    
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    console.log(`🔥 [USER-PAGES-RAG] ENTRÉE - userId: ${req.user.id}, workspaceId: ${workspaceId}, pageIds: [${pageIds.join(', ')}]`);

    // Récupérer les pages sélectionnées
    const selectedPages = await prisma.page.findMany({
      where: {
        id: { in: pageIds },
        workspaceId: workspaceId,
        isArchived: false
      },
      select: {
        id: true,
        title: true,
        blockNoteContent: true,
        updatedAt: true
      }
    });

    console.log(`🔥 [USER-PAGES-RAG] Pages trouvées: ${selectedPages.length}/${pageIds.length}`);

    if (selectedPages.length === 0) {
      return res.json({ 
        success: true, 
        message: 'Aucune page valide trouvée',
        processedPages: []
      });
    }

    // Traitement RAG des pages utilisateur
    try {
      const { userPagesRAG } = await import('../services/rag/userPages.js');
      const processedPages = [];

      for (const page of selectedPages) {
        if (page.title) {
          // Extraire le contenu texte depuis blockNoteContent si disponible
          let textContent = page.title;
          try {
            if (page.blockNoteContent) {
              const content = typeof page.blockNoteContent === 'string' 
                ? JSON.parse(page.blockNoteContent) 
                : page.blockNoteContent;
              
              // Extraction basique du texte depuis BlockNote content
              if (content && Array.isArray(content)) {
                const textParts = content
                  .filter((block: any) => block?.type === 'paragraph' && block?.content)
                  .map((block: any) => 
                    Array.isArray(block.content) 
                      ? block.content.map((item: any) => item?.text || '').join('')
                      : ''
                  )
                  .filter(Boolean);
                
                if (textParts.length > 0) {
                  textContent = page.title + '\n\n' + textParts.join('\n\n');
                }
              }
            }
          } catch (error) {
            console.error(`🧠 [RAG] Erreur extraction contenu page "${page.title}":`, error);
          }

          // Embedding immédiat et synchrone
          console.log(`🧠 [RAG] Traitement immédiat page: "${page.title}" (${textContent.length} chars)`);
          
          const sourceId = await userPagesRAG.processUserPage({
            id: page.id,
            title: page.title,
            content: textContent,
            userId: req.user!.id,
            workspaceId: workspaceId,
            updatedAt: page.updatedAt
          });

          if (sourceId) {
            processedPages.push({
              pageId: page.id,
              title: page.title,
              sourceId: sourceId,
              contentLength: textContent.length
            });
            console.log(`✅ [RAG] Page "${page.title}" → sourceId: ${sourceId}`);
          }
        } else {
          console.warn(`⚠️ [RAG] Page sans titre ignorée`);
        }
      }

      console.log(`🔥 [USER-PAGES-RAG] RÉSULTAT: ${processedPages.length}/${selectedPages.length} pages traitées`);

      res.json({
        success: true,
        message: `${processedPages.length} page(s) traitée(s) avec RAG`,
        processedPages: processedPages,
        totalPages: selectedPages.length
      });

    } catch (error) {
      console.error('🧠 [RAG] Service user pages non disponible:', error);
      res.status(500).json({ 
        error: 'Service RAG non disponible',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }

  } catch (error) {
    console.error('🚨 Erreur User Pages RAG:', error);
    res.status(500).json({ 
      error: 'Erreur interne du serveur',
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

// Upload route: parse pdf/txt and return extracted text (not persisted)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
router.post('/upload', upload.array('files', 5), async (req: any, res) => {
  try {
    const files = (req.files as any[]) || [];
    const results: Array<{ name: string; mimetype: string; size: number; text: string }> = [];
    for (const f of files) {
      let text = '';
      if (f.mimetype === 'application/pdf') {
        try {
          let pdfParseFn: any;
          try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore - untyped module
            const mod = await import('pdf-parse/lib/pdf-parse.js');
            // Support default or named export shapes
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pdfParseFn = (mod as any).default || (mod as any);
          } catch {
            // Fallback to main entry if submodule path not found
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore - untyped module
            const mod = await import('pdf-parse');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pdfParseFn = (mod as any).default || (mod as any);
          }
          const data = await pdfParseFn(f.buffer);
          text = (data && data.text) ? data.text : '';
        } catch {
          text = '';
        }
      } else if (f.mimetype === 'text/plain') {
        text = f.buffer.toString('utf-8');
      }
      results.push({ name: f.originalname, mimetype: f.mimetype, size: f.size, text });
    }
    res.json({ files: results });
  } catch (e) {
    console.error('upload error', e);
    res.status(500).json({ error: 'Erreur upload fichiers' });
  }
});

export default router;