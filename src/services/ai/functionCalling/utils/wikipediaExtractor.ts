/**
 * 📚 WIKIPEDIA LICENSE EXTRACTOR
 * Extraction des sources Wikipedia depuis les tool calls pour attribution de licence
 */

import { prisma } from '../../../../lib/prisma.js';
import { prismaEmbeddings } from "../../../../lib/prismaEmbeddings.js";
import type { ToolCallRecord, WikipediaSource } from '../types/index.js';

/**
 * Extrait les sources Wikipedia depuis les tool calls
 *
 * @param toolCalls - Liste des appels de tools exécutés
 * @returns Liste des sources Wikipedia avec leurs métadonnées
 */
export async function extractWikipediaSourcesFromToolCalls(
  toolCalls: ToolCallRecord[]
): Promise<WikipediaSource[]> {
  const wikipediaSources: WikipediaSource[] = [];
  const seenPageIds = new Set<number>();

  console.log(`🔍 [WIKIPEDIA-EXTRACTOR] Analyse de ${toolCalls.length} tool calls`);

  for (const toolCall of toolCalls) {
    try {
      // Cas 1: read_rag_source ou search_rag_chunks
      if (toolCall.name === 'read_rag_source' || toolCall.name === 'search_rag_chunks') {
        const sourceIds = extractSourceIdsFromToolCall(toolCall);

        if (sourceIds.length > 0) {
          console.log(`📖 [WIKIPEDIA-EXTRACTOR] ${toolCall.name} - ${sourceIds.length} sources trouvées`);

          // Récupérer les métadonnées depuis la base de données
          // Filtrer les IDs valides (UUID uniquement, pas wiki_*)
          const validUUIDs = sourceIds.filter(id => {
            // UUID format: 8-4-4-4-12 caractères hexadécimaux
            return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
          });

          if (validUUIDs.length > 0) {
            const sources = await prismaEmbeddings.rAGSource.findMany({
              where: {
                id: { in: validUUIDs },
                sourceType: 'WIKIPEDIA'
              },
              select: {
                title: true,
                originalUrl: true,
                metadata: true
              }
            });

            for (const source of sources) {
              const pageid = (source.metadata as any)?.pageid;
              const url = source.originalUrl || `https://fr.wikipedia.org/wiki/${encodeURIComponent(source.title)}`;

              if (pageid && !seenPageIds.has(pageid)) {
                wikipediaSources.push({
                  title: source.title,
                  url,
                  pageid
                });
                seenPageIds.add(pageid);
                console.log(`✅ [WIKIPEDIA-EXTRACTOR] Ajout: ${source.title}`);
              }
            }
          }
        }
      }

      // Cas 2: list_global_wikipedia_sources
      if (toolCall.name === 'list_global_wikipedia_sources') {
        // Le résultat contient déjà les informations formatées
        // On pourrait parser le résultat mais c'est plus simple de récupérer depuis la DB
        console.log(`🌍 [WIKIPEDIA-EXTRACTOR] list_global_wikipedia_sources détecté`);
      }
    } catch (error) {
      console.error(`❌ [WIKIPEDIA-EXTRACTOR] Erreur extraction ${toolCall.name}:`, error);
    }
  }

  console.log(`📊 [WIKIPEDIA-EXTRACTOR] Total: ${wikipediaSources.length} sources Wikipedia uniques`);
  return wikipediaSources;
}

/**
 * Extrait les sources Wikipedia directement depuis ragSources
 * (utilisé quand l'IA ne décide pas d'utiliser les tools)
 *
 * @param ragSources - Sources RAG passées par le frontend
 * @returns Liste des sources Wikipedia avec leurs métadonnées
 */
export async function extractWikipediaSourcesFromRagSources(
  ragSources: Array<{ id?: string; title: string; type?: string }>
): Promise<WikipediaSource[]> {
  const wikipediaSources: WikipediaSource[] = [];
  const seenPageIds = new Set<number>();

  console.log(`🔍 [WIKIPEDIA-RAG-EXTRACTOR] Analyse de ${ragSources.length} sources RAG`);

  // Filtrer les sources Wikipedia
  const wikiSources = ragSources.filter(s => s.type === 'WIKIPEDIA');

  if (wikiSources.length === 0) {
    console.log(`⚠️ [WIKIPEDIA-RAG-EXTRACTOR] Aucune source Wikipedia dans ragSources`);
    return [];
  }

  console.log(`📚 [WIKIPEDIA-RAG-EXTRACTOR] ${wikiSources.length} sources Wikipedia détectées`);

  // Récupérer par titre (les sources globales Wikipedia)
  const titles = wikiSources.map(s => s.title);

  try {
    const sources = await prismaEmbeddings.rAGSource.findMany({
      where: {
        title: { in: titles },
        sourceType: 'WIKIPEDIA',
        isGlobal: true,
        status: 'COMPLETED'
      },
      select: {
        title: true,
        originalUrl: true,
        metadata: true
      }
    });

    for (const source of sources) {
      const pageid = (source.metadata as any)?.pageid;
      const url = source.originalUrl || `https://fr.wikipedia.org/wiki/${encodeURIComponent(source.title)}`;

      if (pageid && !seenPageIds.has(pageid)) {
        wikipediaSources.push({
          title: source.title,
          url,
          pageid
        });
        seenPageIds.add(pageid);
        console.log(`✅ [WIKIPEDIA-RAG-EXTRACTOR] Ajout: ${source.title}`);
      }
    }
  } catch (error) {
    console.error(`❌ [WIKIPEDIA-RAG-EXTRACTOR] Erreur DB:`, error);
  }

  console.log(`📊 [WIKIPEDIA-RAG-EXTRACTOR] Total: ${wikipediaSources.length} sources Wikipedia`);
  return wikipediaSources;
}

/**
 * Extrait les IDs de sources depuis un tool call
 */
function extractSourceIdsFromToolCall(toolCall: ToolCallRecord): string[] {
  const sourceIds: string[] = [];

  try {
    // Extraire depuis les arguments
    if (toolCall.arguments?.sourceId) {
      sourceIds.push(toolCall.arguments.sourceId);
    }
    if (toolCall.arguments?.sourceIds && Array.isArray(toolCall.arguments.sourceIds)) {
      sourceIds.push(...toolCall.arguments.sourceIds);
    }

    // Extraire depuis le résultat (parsing du texte retourné)
    // Le résultat contient souvent "ID: xxx"
    const idMatches = toolCall.result.match(/ID:\s*([a-f0-9-]+)/gi);
    if (idMatches) {
      for (const match of idMatches) {
        const id = match.replace(/ID:\s*/i, '').trim();
        if (id && !sourceIds.includes(id)) {
          sourceIds.push(id);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Erreur extraction IDs:`, error);
  }

  return sourceIds;
}

/**
 * Construit le footer de licence Wikipedia
 *
 * @param wikipediaSources - Sources Wikipedia à inclure
 * @returns Footer formaté en Markdown
 */
export function buildWikipediaLicenseFooter(wikipediaSources: WikipediaSource[]): string {
  if (wikipediaSources.length === 0) {
    return '';
  }

  console.log(`📝 [WIKIPEDIA-LICENSE] Génération footer pour ${wikipediaSources.length} sources`);

  const header = '\n\n---\n📚 **Sources Wikipedia** (CC BY-SA 3.0):';
  const sourcesList = wikipediaSources
    .map(source => `- [${source.title}](${source.url})`)
    .join('\n');
  const licenseText = '\n\n*Contenu sous licence [Creative Commons Attribution-ShareAlike 3.0](https://creativecommons.org/licenses/by-sa/3.0/)*';

  return `${header}\n${sourcesList}${licenseText}`;
}
