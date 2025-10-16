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
   * Lit une source RAG spécifique et retourne ses chunks pertinents
   */
  private static async readRAGSource(
    args: { sourceId: string; query: string; limit?: number },
    context: ToolContext
  ): Promise<string> {
    const { sourceId, query, limit = 3 } = args;

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
        result += `  ${i + 1}. ${chunk.content.slice(0, 300)}${chunk.content.length > 300 ? '...' : ''}\n`;
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

