import { prisma } from '../../../lib/prisma.js';

/**
 * 🔧 Helper - Indexe les pages mentionnées et retourne les sources RAG
 * Utilisé par askStream et searchStream pour éviter la duplication
 */
export async function indexAndPreparePagesForAI(
  pageObjects: Array<{ id: string; title: string }>,
  userId: string,
  workspaceId: string
): Promise<Array<{ id: string; title: string; type: string }>> {
  const { userPagesRAG } = await import('../../../services/rag/userPages.js');
  
  const pageContents = await Promise.all(
    pageObjects.map(async (p: any) => {
      try {
        // Récupérer le contenu de la page
        const pageData = await prisma.page.findUnique({
          where: { id: p.id },
          select: { title: true, blockNoteContent: true, updatedAt: true }
        });
        
        if (pageData) {
          let textContent = pageData.title || '';
          try {
            if (pageData.blockNoteContent) {
              const content = typeof pageData.blockNoteContent === 'string'
                ? JSON.parse(pageData.blockNoteContent)
                : pageData.blockNoteContent;
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
                  textContent = (pageData.title || '') + '\n\n' + textParts.join('\n\n');
                }
              }
            }
          } catch (e) {
            console.log(`⚠️ Erreur extraction contenu page: ${e}`);
          }
          
          // Indexer la page si pas déjà fait
          const ragSourceId = await userPagesRAG.processUserPage({
            id: p.id,
            title: pageData.title || 'Sans titre',
            content: textContent,
            userId,
            workspaceId,
            updatedAt: pageData.updatedAt
          });
          
          return { 
            id: ragSourceId || p.id,
            title: pageData.title || p.title || 'Page sans titre',
            type: 'WORKSPACE_PAGE'
          };
        }
        return { id: p.id, title: p.title, type: 'WORKSPACE_PAGE' };
      } catch (error) {
        console.log(`⚠️ Erreur traitement page "${p.title}": ${error}`);
        return { id: p.id, title: p.title, type: 'WORKSPACE_PAGE' };
      }
    })
  );
  
  return pageContents.filter(Boolean);
}
