import { prisma } from "../../../lib/prisma.js";
import { extractTextFromBlockNote } from "./blocknote.js";
import { keywordScore } from "./scoring.js";

/**
 * BlockNote block node structure
 */
interface BlockNoteNode {
  type?: string;
  content?: Array<{ type: string; text?: string }>;
  children?: BlockNoteNode[];
}

export async function buildPagesContext(
  workspaceId: string,
  pageIds?: string[],
  limit: number = 10,
  maxCharsPerPage?: number,
): Promise<string> {
  const pages = await prisma.page.findMany({
    where: {
      workspaceId,
      isArchived: false,
      ...(pageIds && pageIds.length ? { id: { in: pageIds } } : {}),
    },
    select: { id: true, title: true, blockNoteContent: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: pageIds && pageIds.length ? pageIds.length : limit,
  });

  const entries: string[] = [];
  for (const p of pages) {
    const text = Array.isArray(p.blockNoteContent)
      ? extractTextFromBlockNote(p.blockNoteContent as BlockNoteNode[])
      : "";
    const slice =
      typeof maxCharsPerPage === "number"
        ? maxCharsPerPage
        : pageIds && pageIds.length
          ? 8000
          : 1500;
    const excerpt = text.substring(0, slice);
    entries.push(`• ${p.title}\n${excerpt}`);
  }
  return entries.length
    ? `Contexte des pages du workspace:\n\n${entries.join("\n\n")}`
    : "";
}

export function extractParagraphsFromBlockNote(
  blocks: BlockNoteNode[],
): string[] {
  const paragraphs: string[] = [];
  const walk = (nodes: BlockNoteNode[]): void => {
    for (const n of nodes || []) {
      let text = "";
      if (Array.isArray(n?.content)) {
        for (const c of n.content) {
          if (c.type === "text" && typeof c.text === "string") text += c.text;
        }
      }
      if (text) {
        paragraphs.push(text.trim());
      }
      if (Array.isArray(n?.children) && n.children.length > 0) walk(n.children);
    }
  };
  walk(blocks);
  return paragraphs.filter(Boolean);
}

export function chunkParagraphs(
  paragraphs: string[],
  maxCharsPerChunk: number = 1600,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + (current ? "\n" : "") + p).length > maxCharsPerChunk) {
      if (current) chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function buildPagesContextChunked(
  workspaceId: string,
  pageIds: string[] = [],
  pagesLimit: number = 10,
  query: string = "",
  maxChunksTotal: number = 10,
): Promise<string> {
  const pages = await prisma.page.findMany({
    where: {
      workspaceId,
      isArchived: false,
      ...(pageIds && pageIds.length ? { id: { in: pageIds } } : {}),
    },
    select: { id: true, title: true, blockNoteContent: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: pageIds && pageIds.length ? pageIds.length : pagesLimit,
  });

  type ScoredChunk = { score: number; text: string; title: string };
  const pool: ScoredChunk[] = [];

  for (const p of pages) {
    const blocks = Array.isArray(p.blockNoteContent)
      ? (p.blockNoteContent as BlockNoteNode[])
      : [];
    const paras = extractParagraphsFromBlockNote(blocks);
    const chunks = chunkParagraphs(paras, 1800);
    for (const ch of chunks) {
      pool.push({ score: keywordScore(ch, query), text: ch, title: p.title });
    }
  }

  // Si l'utilisateur n'a pas sélectionné de pages ET que la requête est trop générique
  // ou que les scores sont nuls, éviter d'injecter du contexte bruyant.
  const hasSelectedPages = Array.isArray(pageIds) && pageIds.length > 0;
  const meaningfulTokens = query
    .toLowerCase()
    .split(/[^a-zàâçéèêëîïôûùüÿñæœ0-9]+/)
    .filter(Boolean)
    .filter(
      (w) =>
        w.length >= 3 &&
        ![
          "bonjour",
          "salut",
          "coucou",
          "hello",
          "hey",
          "yo",
          "merci",
          "svp",
          "stp",
          "ok",
          "okay",
          "yes",
          "no",
        ].includes(w),
    );

  pool.sort((a, b) => b.score - a.score);
  const bestScore = pool[0]?.score ?? 0;

  if (!hasSelectedPages && (!meaningfulTokens.length || bestScore <= 0)) {
    return "";
  }

  const top = pool.slice(0, Math.min(maxChunksTotal, Math.max(1, pool.length)));
  if (!top.length) return "";

  const entries: string[] = top.map((ch) => `• ${ch.title}\n${ch.text}`);
  return `Contexte des pages du workspace (sélection de passages pertinents):\n\n${entries.join("\n\n")}`;
}
