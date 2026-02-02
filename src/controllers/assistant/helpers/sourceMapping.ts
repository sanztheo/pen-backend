/**
 * 🔧 SOURCE MAPPING HELPER
 * Convertit les IDs inventés du frontend en vrais UUIDs de la DB
 */

import { logger } from "../../../utils/logger.js";
import { prisma } from "../../../lib/prisma.js";
import { prismaEmbeddings } from "../../../lib/prismaEmbeddings.js";

export interface RagSourceInput {
  id?: string | number;
  title: string;
  type?: string;
}

export interface MappedSource {
  id: string;
  title: string;
  type: string;
}

/**
 * Page object from workspace with basic properties
 */
interface PageObject {
  id: string;
  title: string;
}

/**
 * Attachment object with optional RAG source reference
 */
interface AttachmentObject {
  ragSourceId?: string;
  fileName?: string;
  name?: string;
}

/**
 * Map les sources RAG du frontend vers les vrais UUIDs de la DB
 * @param ragSources Sources reçues du frontend (avec IDs inventés comme "wiki_7266")
 * @returns Sources avec vrais UUIDs de la DB
 */
export async function mapRagSourcesToRealUUIDs(
  ragSources: RagSourceInput[],
): Promise<MappedSource[]> {
  if (!ragSources || ragSources.length === 0) {
    return [];
  }

  // Extraire les titres (c'est la seule donnée fiable du frontend)
  const titles = ragSources.map((s) => s.title).filter(Boolean);

  if (titles.length === 0) {
    logger.log(
      `⚠️ [SOURCE-MAPPING] Aucun titre valide trouvé dans ragSources`,
    );
    return [];
  }

  logger.log(
    `🔍 [SOURCE-MAPPING] Recherche de ${titles.length} sources en DB par titre...`,
  );

  // Rechercher les sources dans la DB par titre
  const dbSources = await prismaEmbeddings.rAGSource.findMany({
    where: {
      title: { in: titles },
      sourceType: "WIKIPEDIA",
      status: "COMPLETED",
    },
    select: {
      id: true,
      title: true,
      sourceType: true,
    },
  });

  logger.log(
    `✅ [SOURCE-MAPPING] ${dbSources.length}/${titles.length} sources trouvées en DB`,
  );

  // Logger les sources non trouvées pour debug
  if (dbSources.length < titles.length) {
    const foundTitles = new Set(dbSources.map((s) => s.title));
    const notFound = titles.filter((t) => !foundTitles.has(t));
    logger.log(
      `⚠️ [SOURCE-MAPPING] Sources non trouvées: ${notFound.join(", ")}`,
    );
  }

  // Mapper vers le format attendu avec vrais UUIDs
  return dbSources.map((s) => ({
    id: s.id, // ✅ Vrai UUID de la DB
    title: s.title,
    type: s.sourceType,
  }));
}

/**
 * Map les sources avec support des pièces jointes et pages
 * @param ragSources Sources RAG Wikipedia
 * @param pageObjects Pages workspace (déjà indexées)
 * @param attachments Pièces jointes uploadées
 * @returns Toutes les sources mappées avec vrais UUIDs
 */
export async function mapAllSourcesToRealUUIDs(
  ragSources: RagSourceInput[] = [],
  pageObjects: PageObject[] = [],
  attachments: AttachmentObject[] = [],
): Promise<MappedSource[]> {
  const mappedSources: MappedSource[] = [];

  // 1. Wikipedia sources (besoin de mapping DB)
  if (ragSources.length > 0) {
    const wikipediaSources = await mapRagSourcesToRealUUIDs(ragSources);
    mappedSources.push(...wikipediaSources);
    logger.log(
      `✅ [SOURCE-MAPPING] ${wikipediaSources.length} Wikipedia sources mappées`,
    );
  }

  // 2. Pages workspace (déjà avec vrais UUIDs)
  if (pageObjects.length > 0) {
    const pageSources = pageObjects.map((p) => ({
      id: p.id, // Déjà un vrai UUID
      title: p.title,
      type: "PAGE",
    }));
    mappedSources.push(...pageSources);
    logger.log(
      `✅ [SOURCE-MAPPING] ${pageSources.length} pages workspace ajoutées`,
    );
  }

  // 3. Pièces jointes (déjà avec vrais UUIDs si indexées)
  if (attachments.length > 0) {
    const attachmentSources = attachments
      .filter(
        (a): a is AttachmentObject & { ragSourceId: string } =>
          typeof a.ragSourceId === "string" && a.ragSourceId.length > 0,
      ) // Seulement si déjà indexé en RAG
      .map((a) => ({
        id: a.ragSourceId, // UUID de la RAGSource correspondante
        title: a.fileName || a.name || "Attachment",
        type: "FILE",
      }));
    mappedSources.push(...attachmentSources);
    logger.log(
      `✅ [SOURCE-MAPPING] ${attachmentSources.length} pièces jointes ajoutées`,
    );
  }

  logger.log(
    `📊 [SOURCE-MAPPING] Total: ${mappedSources.length} sources mappées`,
  );
  return mappedSources;
}
