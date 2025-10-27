/**
 * 🔧 FUNCTION CALLING TOOLS EXECUTORS
 * Implémentation de l'exécution de chaque tool
 */

import { prisma } from '../../../lib/prisma.js';

export interface ToolContext {
  userId: string;
  workspaceId: string;
}

export class ToolExecutor {
  /**
   * Point d'entrée principal pour exécuter un tool call
   */
  static async executeToolCall(
    toolName: string,
    args: any,
    context: ToolContext
  ): Promise<string> {
    console.log(`🔧 [TOOL-CALL] Exécution: ${toolName}`, { args, context });

    try {
      switch (toolName) {
        case 'list_available_sources':
          return await this.listAvailableSources(args, context);

        case 'list_global_wikipedia_sources':
          return await this.listGlobalWikipediaSources(args);

        case 'select_relevant_sources':
          return await this.selectRelevantSources(args, context);

        case 'check_sources_rag_status':
          return await this.checkSourcesRagStatus(args, context);

        case 'read_rag_source':
          return await this.readRAGSource(args, context);

        case 'search_rag_chunks':
          return await this.searchRAGChunks(args, context);

        case 'search_web':
          return await this.searchWeb(args);

        case 'read_workspace_page':
          return await this.readWorkspacePage(args, context);

        case 'list_workspace_pages':
          return await this.listWorkspacePages(args, context);

        default:
          throw new Error(`Tool inconnu: ${toolName}`);
      }
    } catch (error) {
      console.error(`❌ [TOOL-CALL] Erreur ${toolName}:`, error);
      return `Erreur lors de l'exécution du tool ${toolName}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }

  /**
   * Liste toutes les sources RAG disponibles pour l'utilisateur
   */
  private static async listAvailableSources(
    args: { workspaceId: string; limit?: number },
    context: ToolContext
  ): Promise<string> {
    const { workspaceId, limit = 20 } = args;

    console.log(`📋 [LIST-SOURCES] Listing sources pour workspace: ${workspaceId}`);

    try {
      const sources = await prisma.rAGSource.findMany({
        where: {
          workspaceId,
          userId: context.userId
        },
        select: {
          id: true,
          title: true,
          sourceType: true,
          totalChunks: true,
          lastUsedAt: true,
          status: true
        },
        take: Math.min(limit, 50),
        orderBy: { lastUsedAt: 'desc' }
      });

      if (sources.length === 0) {
        return `Aucune source RAG trouvée dans ce workspace`;
      }

      let result = `📋 Sources RAG disponibles (${sources.length} source(s)):\n\n`;

      sources.forEach((source, i) => {
        const statusEmoji = source.status === 'COMPLETED' ? '✅' : source.status === 'PROCESSING' ? '⏳' : '❌';
        const lastUsed = source.lastUsedAt 
          ? new Date(source.lastUsedAt).toLocaleDateString('fr-FR')
          : 'Jamais';
        
        result += `${i + 1}. [${statusEmoji}] ${source.title}\n`;
        result += `   Type: ${source.sourceType}\n`;
        result += `   Chunks: ${source.totalChunks}\n`;
        result += `   ID: ${source.id}\n`;
        result += `   Dernière utilisation: ${lastUsed}\n\n`;
      });

      console.log(`✅ [LIST-SOURCES] ${sources.length} sources listées`);

      return result;
    } catch (error) {
      console.error(`❌ [LIST-SOURCES] Erreur:`, error);
      return `Erreur lors de la récupération des sources: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }

  /**
   * Liste toutes les sources Wikipedia GLOBALES partagées (déjà indexées)
   */
  private static async listGlobalWikipediaSources(
    args: { limit?: number }
  ): Promise<string> {
    const { limit = 20 } = args;

    console.log(`🌍 [LIST-GLOBAL-WIKI] Listing sources Wikipedia globales`);

    try {
      const wikiSources = await prisma.rAGSource.findMany({
        where: {
          isGlobal: true,
          sourceType: 'WIKIPEDIA',
          status: 'COMPLETED'  // Seulement les sources complètement indexées
        },
        select: {
          id: true,
          title: true,
          sourceType: true,
          totalChunks: true,
          lastUsedAt: true,
          status: true
        },
        take: Math.min(limit, 50),
        orderBy: { lastUsedAt: 'desc' }
      });

      if (wikiSources.length === 0) {
        return `🌍 Aucune source Wikipedia globale disponible actuellement`;
      }

      let result = `🌍 Sources Wikipedia GLOBALES partagées (${wikiSources.length} source(s)):\n\n`;

      wikiSources.forEach((source, i) => {
        const lastUsed = source.lastUsedAt 
          ? new Date(source.lastUsedAt).toLocaleDateString('fr-FR')
          : 'Jamais';
        
        result += `${i + 1}. 📚 ${source.title}\n`;
        result += `   Chunks indexés: ${source.totalChunks}\n`;
        result += `   ID: ${source.id}\n`;
        result += `   Dernière utilisation: ${lastUsed}\n\n`;
      });

      console.log(`✅ [LIST-GLOBAL-WIKI] ${wikiSources.length} sources Wikipedia listées`);

      return result;
    } catch (error) {
      console.error(`❌ [LIST-GLOBAL-WIKI] Erreur:`, error);
      return `Erreur lors de la récupération des sources Wikipedia globales: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }

  /**
   * IA sélectionne les sources pertinentes (utilise function calling d'OpenAI)
   */
  private static async selectRelevantSources(
    args: { question: string; availableSources: any[]; maxResults?: number },
    context: ToolContext
  ): Promise<string> {
    const { question, availableSources, maxResults = 5 } = args;

    // 🔥 DEFENSIVE: Check if required arguments are provided
    if (!question || !Array.isArray(availableSources) || availableSources.length === 0) {
      console.warn(`⚠️ [SELECT-SOURCES] Arguments incomplets:`, { 
        hasQuestion: !!question, 
        hasSources: Array.isArray(availableSources), 
        sourceCount: availableSources?.length || 0 
      });
      
      // 🔥 FALLBACK: Try to fetch sources from database
      try {
        const dbSources = await prisma.rAGSource.findMany({
          where: {
            workspaceId: context.workspaceId,
            userId: context.userId
          },
          select: {
            id: true,
            title: true,
            sourceType: true,
            totalChunks: true,
            status: true
          },
          take: 20,
          orderBy: { lastUsedAt: 'desc' }
        });

        if (dbSources.length === 0) {
          return `❌ Erreur: Aucune source disponible à sélectionner`;
        }

        console.log(`🔄 [SELECT-SOURCES] Utilisation des sources de la BD (${dbSources.length} sources)`);
        
        // 🔥 Use all sources if we fetched them from DB
        const sourcesInfo = dbSources.map((s: any) => ({
          id: s.id,
          title: s.title,
          type: s.sourceType
        }));

        // 🔥 If question is still missing, use a generic prompt
        const fallbackQuestion = question || "Sélectionne les sources pertinentes";
        
        const { AIService } = await import('../base.js');
        const openai = AIService.getOpenAI();

        const systemPrompt = `Tu es un expert en sélection de sources. Analyse les sources disponibles et sélectionne UNIQUEMENT les meilleures.
        
RÈGLES:
- Sélectionne UN MAXIMUM de ${maxResults} sources
- Priorise les sources complètes (status COMPLETED) et avec chunks
- Si aucune source n'est pertinente, retourne une liste vide

RÉPONSE: Retourne UNIQUEMENT un JSON valide:
{
  "selected_source_ids": ["id1", "id2"]
}`;

        const userPrompt = `Question: "${fallbackQuestion}"

Sources disponibles:
${JSON.stringify(sourcesInfo, null, 2)}

Sélectionne les sources pertinentes (max ${maxResults}):`;

        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 200,
          response_format: { type: 'json_object' }
        });

        const content = response.choices[0]?.message?.content || '{}';
        const selection = JSON.parse(content);
        const selectedIds = selection.selected_source_ids || [];

        const validIds = selectedIds.filter((id: string) =>
          dbSources.some((s: any) => s.id === id)
        );

        if (validIds.length === 0) {
          return `Aucune source pertinente trouvée`;
        }

        let result = `✅ Sources sélectionnées (${validIds.length}):\n\n`;
        validIds.forEach((id: string, i: number) => {
          const source = dbSources.find((s: any) => s.id === id);
          if (source) {
            result += `${i + 1}. ${source.title} (${source.sourceType})\n`;
            result += `   ID: ${id}\n\n`;
          }
        });

        console.log(`✅ [SELECT-SOURCES] ${validIds.length} sources sélectionnées (from DB fallback)`);
        return result;
      } catch (dbError) {
        console.error(`❌ [SELECT-SOURCES] Erreur fallback BD:`, dbError);
        return `❌ Erreur: Arguments invalides et impossible de récupérer les sources depuis la BD`;
      }
    }

    console.log(`🎯 [SELECT-SOURCES] Sélection sources pour: "${question}"`);

    try {
      const { AIService } = await import('../base.js');
      const openai = AIService.getOpenAI();

      // Créer la liste des sources avec leurs informations
      const sourcesInfo = availableSources.map((s: any) => ({
        id: s.id,
        title: s.title,
        type: s.sourceType
      }));

      const systemPrompt = `Tu es un expert en sélection de sources. Analyse la question et sélectionne les sources potentiellement utiles.
      
RÈGLES:
- Sélectionne UN MAXIMUM de ${maxResults} sources
- Sois INCLUSIF: sélectionne une source si elle peut être utile même partiellement
- Priorise les sources directement liées au sujet, mais accepte aussi les sources connexes
- Si la question mentionne un thème général ("théorèmes"), sélectionne TOUTES les sources sur ce thème
- Si la question est vague ou mal formulée, interprète-la généreusement
- Ne retourne une liste vide QUE si AUCUNE source n'a le moindre rapport avec la question

RÉPONSE: Retourne UNIQUEMENT un JSON valide, sans aucun texte:
{
  "selected_source_ids": ["id1", "id2"],
  "reasoning": "courte explication de ton choix"
}`;

      const userPrompt = `Question: "${question}"

Sources disponibles:
${JSON.stringify(sourcesInfo, null, 2)}

Sélectionne les sources pertinentes (max ${maxResults}):`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content || '{}';
      console.log(`🧠 [SELECT-SOURCES] Réponse IA brute:`, content);
      
      const selection = JSON.parse(content);
      const selectedIds = selection.selected_source_ids || [];
      const reasoning = selection.reasoning || 'Pas de raisonnement fourni';

      console.log(`🧠 [SELECT-SOURCES] Raisonnement IA: ${reasoning}`);
      console.log(`🧠 [SELECT-SOURCES] IDs sélectionnés:`, selectedIds);

      // Valider que les IDs existent dans la liste disponible
      const validIds = selectedIds.filter((id: string) =>
        availableSources.some((s: any) => s.id === id)
      );

      if (validIds.length === 0) {
        console.warn(`⚠️ [SELECT-SOURCES] Aucune source sélectionnée! Sources disponibles:`, sourcesInfo);
        console.warn(`⚠️ [SELECT-SOURCES] Raisonnement de l'IA: ${reasoning}`);
        
        // 🔥 FALLBACK: Si l'IA ne sélectionne rien, prendre toutes les sources
        const allIds = availableSources.map((s: any) => s.id).slice(0, maxResults);
        console.log(`🔄 [SELECT-SOURCES] FALLBACK: Sélection automatique de ${allIds.length} sources`);
        
        let result = `⚠️ L'IA n'a sélectionné aucune source (Raison: ${reasoning}). Sélection automatique de toutes les sources disponibles:\n\n`;
        allIds.forEach((id: string, i: number) => {
          const source = availableSources.find((s: any) => s.id === id);
          if (source) {
            result += `${i + 1}. ${source.title} (${source.sourceType})\n`;
            result += `   ID: ${id}\n\n`;
          }
        });
        
        return result;
      }

      let result = `✅ Sources sélectionnées (${validIds.length}):\n`;
      result += `🧠 Raisonnement: ${reasoning}\n\n`;
      
      validIds.forEach((id: string, i: number) => {
        const source = availableSources.find((s: any) => s.id === id);
        if (source) {
          result += `${i + 1}. ${source.title} (${source.sourceType})\n`;
          result += `   ID: ${id}\n\n`;
        }
      });

      console.log(`✅ [SELECT-SOURCES] ${validIds.length} sources sélectionnées avec succès`);

      return result;
    } catch (error) {
      console.error(`❌ [SELECT-SOURCES] Erreur:`, error);
      return `Erreur lors de la sélection des sources: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }

  /**
   * Vérifie le statut RAG des sources (lesquelles ont chunks vs lesquelles besoin de RAG)
   */
  private static async checkSourcesRagStatus(
    args: { sourceIds?: string[]; sourceId?: string },
    context: ToolContext
  ): Promise<string> {
    // 🔥 Handle both sourceIds (array) and sourceId (string) for compatibility
    let ids = args.sourceIds || [];
    if (args.sourceId && !args.sourceIds) {
      ids = [args.sourceId];
    }

    if (!ids || ids.length === 0) {
      return `❌ Erreur: Aucun ID de source fourni. Utilisez "sourceIds" (array) ou "sourceId" (string).`;
    }

    console.log(`🔍 [CHECK-RAG-STATUS] Vérification de ${ids.length} sources`);

    try {
      const sources = await prisma.rAGSource.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          title: true,
          status: true,
          totalChunks: true
        }
      });

      const sourcesWithChunks: any[] = [];
      const sourcesNeedingRAG: any[] = [];

      sources.forEach(source => {
        if (source.status === 'COMPLETED' && source.totalChunks > 0) {
          sourcesWithChunks.push(source);
        } else {
          sourcesNeedingRAG.push(source);
        }
      });

      let result = `🔍 Statut RAG des sources:\n\n`;

      if (sourcesWithChunks.length > 0) {
        result += `✅ Sources indexées (${sourcesWithChunks.length}):\n`;
        sourcesWithChunks.forEach((s, i) => {
          result += `${i + 1}. ${s.title} (${s.totalChunks} chunks)\n`;
        });
        result += '\n';
      }

      if (sourcesNeedingRAG.length > 0) {
        result += `⏳ Sources nécessitant RAG (${sourcesNeedingRAG.length}):\n`;
        sourcesNeedingRAG.forEach((s, i) => {
          result += `${i + 1}. ${s.title} (Statut: ${s.status})\n`;
        });
        result += '\n';
      }

      result += `📊 Résumé: ${sourcesWithChunks.length} indexées, ${sourcesNeedingRAG.length} à indexer\n`;

      console.log(`✅ [CHECK-RAG-STATUS] Vérification complétée`);

      return result;
    } catch (error) {
      console.error(`❌ [CHECK-RAG-STATUS] Erreur:`, error);
      return `Erreur lors de la vérification du statut: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
    }
  }

  /**
   * Lit une source RAG spécifique et retourne ses chunks pertinents
   */
  private static async readRAGSource(
    args: { sourceId?: string; query: string; limit?: number },
    context: ToolContext
  ): Promise<string> {
    const { sourceId, query, limit = 3 } = args;

    // 🔥 VALIDATION: Vérifier que sourceId est présent
    if (!sourceId || sourceId === 'undefined' || sourceId === 'null') {
      console.error(`❌ [READ-RAG-SOURCE] sourceId manquant ou invalide:`, { sourceId, query });
      return `❌ Erreur: Impossible de lire la source RAG - ID de source manquant ou invalide.\n\nL'IA doit d'abord sélectionner des sources pertinentes avant de les lire.`;
    }

    console.log(`📖 [READ-RAG-SOURCE] sourceId: ${sourceId}, limit: ${limit}`);

    const { ragSystem } = await import('../../rag/index.js');

    const chunks = await ragSystem.intelligentSearch(query, {
      userId: context.userId,
      workspaceId: context.workspaceId,
      limit: Math.min(limit, 10), // Max 10 chunks
      specificSourceIds: [sourceId]
    });

    if (chunks.length === 0) {
      return `Aucun contenu pertinent trouvé dans la source ${sourceId} pour la question: "${query}"`;
    }

    // Récupérer les informations de la source
    const source = await prisma.rAGSource.findUnique({
      where: { id: sourceId },
      select: { title: true, sourceType: true }
    });

    const sourceTitle = source?.title || 'Source inconnue';
    const sourceType = source?.sourceType || 'UNKNOWN';

    let result = `📄 Source: ${sourceTitle} (Type: ${sourceType})\n`;
    result += `✅ ${chunks.length} chunk(s) pertinent(s) trouvé(s)\n\n`;

    chunks.forEach((chunk, i) => {
      result += `--- Chunk ${i + 1} ---\n`;
      result += `${chunk.content}\n\n`;
    });

    console.log(`✅ [READ-RAG-SOURCE] ${chunks.length} chunks retournés pour ${sourceTitle}`);

    return result;
  }

  /**
   * Recherche sémantique dans toutes les sources RAG
   */
  private static async searchRAGChunks(
    args: { query: string; sourceTypes?: string[]; limit?: number },
    context: ToolContext
  ): Promise<string> {
    const { query, sourceTypes, limit = 5 } = args;

    console.log(`🔍 [SEARCH-RAG-CHUNKS] query: "${query}", types: ${sourceTypes?.join(', ') || 'tous'}, limit: ${limit}`);

    const { ragSystem } = await import('../../rag/index.js');

    const chunks = await ragSystem.intelligentSearch(query, {
      userId: context.userId,
      workspaceId: context.workspaceId,
      limit: Math.min(limit, 15) // Max 15 chunks
    });

    if (chunks.length === 0) {
      return `Aucun résultat trouvé dans les sources RAG pour: "${query}"`;
    }

    // Grouper par source
    const groupedBySource = new Map<string, typeof chunks>();
    chunks.forEach(chunk => {
      const sourceTitle = chunk.source.title;
      if (!groupedBySource.has(sourceTitle)) {
        groupedBySource.set(sourceTitle, []);
      }
      groupedBySource.get(sourceTitle)!.push(chunk);
    });

    let result = `🔍 Recherche RAG: "${query}"\n`;
    result += `✅ ${chunks.length} résultat(s) trouvé(s) dans ${groupedBySource.size} source(s)\n\n`;

    groupedBySource.forEach((sourceChunks, sourceTitle) => {
      result += `📄 Source: ${sourceTitle}\n`;
      sourceChunks.forEach((chunk, i) => {
        const content = chunk.content || '';
        result += `  ${i + 1}. ${content.slice(0, 300)}${content.length > 300 ? '...' : ''}\n`;
      });
      result += '\n';
    });

    console.log(`✅ [SEARCH-RAG-CHUNKS] ${chunks.length} résultats de ${groupedBySource.size} sources`);

    return result;
  }

  /**
   * Recherche web via Tavily
   */
  private static async searchWeb(
    args: { query: string; maxResults?: number }
  ): Promise<string> {
    const { query, maxResults = 3 } = args;

    // 🔥 VALIDATION: Vérifier que query est bien fourni et valide
    if (!query || typeof query !== 'string') {
      console.error(`❌ [SEARCH-WEB] Arguments invalides:`, args);
      return `❌ Erreur: Le tool search_web nécessite un argument 'query' de type string. Arguments reçus: ${JSON.stringify(args)}`;
    }

    console.log(`🌐 [SEARCH-WEB] query: "${query}", maxResults: ${maxResults}`);

    const { tavilySearch } = await import('../../../controllers/assistant/helpers/web.js');

    const results = await tavilySearch(query);

    if (!results || results.trim().length === 0) {
      return `Aucun résultat web trouvé pour: "${query}"`;
    }

    console.log(`✅ [SEARCH-WEB] Résultats web obtenus pour "${query}"`);

    return `🌐 Résultats web pour: "${query}"\n\n${results}`;
  }

  /**
   * Lit le contenu d'une page du workspace
   */
  private static async readWorkspacePage(
    args: { pageId: string },
    context: ToolContext
  ): Promise<string> {
    const { pageId } = args;

    console.log(`📄 [READ-WORKSPACE-PAGE] pageId: ${pageId}`);

    const page = await prisma.page.findFirst({
      where: {
        id: pageId,
        workspaceId: context.workspaceId
      },
      select: {
        title: true,
        blockNoteContent: true,
        updatedAt: true
      }
    });

    if (!page) {
      return `Page ${pageId} non trouvée dans le workspace`;
    }

    // Extraire le texte du blockNoteContent
    const text = this.extractTextFromBlockNote(page.blockNoteContent);

    const result = `📄 Page: ${page.title}\n` +
      `📅 Dernière modification: ${page.updatedAt.toLocaleDateString('fr-FR')}\n\n` +
      `${text}`;

    console.log(`✅ [READ-WORKSPACE-PAGE] Page "${page.title}" lue (${text.length} caractères)`);

    return result;
  }

  /**
   * Liste les pages du workspace
   */
  private static async listWorkspacePages(
    args: { workspaceId: string; limit?: number },
    context: ToolContext
  ): Promise<string> {
    const { workspaceId, limit = 10 } = args;

    console.log(`📋 [LIST-WORKSPACE-PAGES] workspaceId: ${workspaceId}, limit: ${limit}`);

    const pages = await prisma.page.findMany({
      where: { workspaceId },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        icon: true
      },
      take: Math.min(limit, 20), // Max 20 pages
      orderBy: { updatedAt: 'desc' }
    });

    if (pages.length === 0) {
      return `Aucune page trouvée dans ce workspace`;
    }

    let result = `📋 Pages disponibles dans le workspace (${pages.length} page(s)):\n\n`;

    pages.forEach((page, i) => {
      const icon = page.icon || '📄';
      const date = page.updatedAt.toLocaleDateString('fr-FR');
      result += `${i + 1}. ${icon} ${page.title}\n`;
      result += `   ID: ${page.id}\n`;
      result += `   Modifié: ${date}\n\n`;
    });

    console.log(`✅ [LIST-WORKSPACE-PAGES] ${pages.length} pages listées`);

    return result;
  }

  /**
   * Extrait le texte d'un blockNoteContent
   */
  private static extractTextFromBlockNote(content: any): string {
    if (!content) return '';

    try {
      // Le content est un tableau de blocks BlockNote
      if (Array.isArray(content)) {
        return content
          .map((block: any) => this.extractTextFromBlock(block))
          .filter(Boolean)
          .join('\n\n');
      }

      return JSON.stringify(content);
    } catch (error) {
      console.error('Erreur extraction texte BlockNote:', error);
      return '';
    }
  }

  /**
   * Extrait le texte d'un block BlockNote récursivement
   */
  private static extractTextFromBlock(block: any): string {
    if (!block) return '';

    let text = '';

    // Texte du block
    if (block.content) {
      if (Array.isArray(block.content)) {
        text = block.content
          .map((item: any) => {
            if (typeof item === 'string') return item;
            if (item.text) return item.text;
            return '';
          })
          .join('');
      } else if (typeof block.content === 'string') {
        text = block.content;
      }
    }

    // Enfants récursifs
    if (block.children && Array.isArray(block.children)) {
      const childrenText = block.children
        .map((child: any) => this.extractTextFromBlock(child))
        .filter(Boolean)
        .join('\n');
      
      if (childrenText) {
        text += (text ? '\n' : '') + childrenText;
      }
    }

    return text;
  }
}

