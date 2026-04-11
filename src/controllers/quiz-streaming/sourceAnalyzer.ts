import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";

export interface SourceAnalysisResult {
  textContent: string;
  wordCount: number;
  summary: string;
  topics: string[];
  hasFormulas: boolean;
  hasDefinitions: boolean;
}

/**
 * Analyse le contenu des sources BlockNote pour extraire les metadonnees
 * utilisees par le quiz preprocessor.
 */
export async function analyzeSourceContent(
  userId: string,
  pageProjectIds: string[],
): Promise<SourceAnalysisResult> {
  let allText = "";
  const topics: Set<string> = new Set();
  let hasFormulas = false;
  let hasDefinitions = false;

  if (pageProjectIds.length > 0) {
    const pages = await prisma.page.findMany({
      where: {
        id: { in: pageProjectIds },
        workspace: {
          members: { some: { userId } },
        },
        isArchived: false,
      },
      select: {
        title: true,
        blockNoteContent: true,
      },
      take: 30,
    });

    for (const page of pages) {
      allText += `${page.title}\n`;
      topics.add(page.title);

      try {
        const content =
          typeof page.blockNoteContent === "string"
            ? JSON.parse(page.blockNoteContent)
            : page.blockNoteContent;

        if (content && Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "paragraph" && block?.content) {
              const text = Array.isArray(block.content)
                ? block.content.map((item: Record<string, unknown>) => item?.text || "").join("")
                : "";
              allText += text + "\n";
            }
            if (block?.type === "latex" || block?.type === "latexBlock") {
              hasFormulas = true;
            }
            if (block?.type === "heading") {
              hasDefinitions = true;
            }
          }
        }
      } catch (error) {
        logger.warn("[SOURCE-ANALYZER] Erreur parsing BlockNote:", error);
      }
    }
  }

  const wordCount = allText.split(/\s+/).filter(Boolean).length;
  const topicsList = Array.from(topics).slice(0, 10);
  const words = allText.split(/\s+/).filter(Boolean);
  const summary = words.slice(0, 200).join(" ");

  return {
    textContent: allText,
    wordCount,
    summary,
    topics: topicsList,
    hasFormulas,
    hasDefinitions,
  };
}
