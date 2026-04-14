import { Mistral } from "@mistralai/mistralai";
import { logger } from "../../utils/logger.js";

const MODEL = "mistral-ocr-latest";
const TIMEOUT_MS = 90_000;
const MIN_MARKDOWN_LENGTH = 10;

let client: Mistral | null = null;

function getClient(): Mistral {
  if (!process.env.MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY is required for PDF extraction");
  }
  if (!client) {
    client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
  }
  return client;
}

/**
 * Fail-fast: appelé au démarrage du backend pour crasher immédiatement si la
 * clé Mistral manque, au lieu de découvrir le bug au premier upload utilisateur.
 */
export function validateMistralConfig(): void {
  if (!process.env.MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY is required (needed for PDF extraction via Mistral OCR)");
  }
  logger.log("✅ [MISTRAL-OCR] API key configured");
}

export interface ExtractedPdf {
  markdown: string;
  totalPages: number;
  pages: { pageNumber: number; content: string }[];
}

export async function extractPdf(buffer: Buffer, fileName: string): Promise<ExtractedPdf> {
  const t0 = Date.now();
  logger.log(`📄 [MISTRAL-OCR] Extraction: "${fileName}" (${buffer.length} bytes)`);

  const base64 = buffer.toString("base64");
  const dataUrl = `data:application/pdf;base64,${base64}`;

  try {
    const response = await getClient().ocr.process(
      {
        model: MODEL,
        document: {
          type: "document_url",
          documentUrl: dataUrl,
        },
      },
      { fetchOptions: { signal: AbortSignal.timeout(TIMEOUT_MS) } },
    );

    const pages = (response.pages ?? []).map((page, index) => ({
      pageNumber: page.index ?? index + 1,
      content: page.markdown ?? "",
    }));

    const markdown = pages
      .map((p) => p.content)
      .filter(Boolean)
      .join("\n\n---\n\n");

    if (markdown.trim().length < MIN_MARKDOWN_LENGTH) {
      throw new Error(`Empty or too short markdown extracted from "${fileName}"`);
    }

    logger.log(
      `✅ [MISTRAL-OCR] "${fileName}" → ${pages.length} pages, ${markdown.length} chars in ${Date.now() - t0}ms`,
    );

    return { markdown, totalPages: pages.length, pages };
  } catch (error) {
    logger.error(
      `❌ [MISTRAL-OCR] Extraction failed for "${fileName}":`,
      error instanceof Error ? error.message : error,
    );
    throw new Error(
      `Mistral OCR extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

export async function extractPdfMarkdown(buffer: Buffer, fileName: string): Promise<string> {
  const { markdown } = await extractPdf(buffer, fileName);
  return markdown;
}
