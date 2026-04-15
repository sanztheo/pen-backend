import { Mistral } from "@mistralai/mistralai";
import type { OCRPageObject } from "@mistralai/mistralai/models/components/ocrpageobject.js";
import { logger } from "../../utils/logger.js";
import { uploadImageBuffer } from "../upload/cloudinary.js";

const MODEL = "mistral-ocr-latest";
const TIMEOUT_MS = 90_000;
const MIN_MARKDOWN_LENGTH = 10;
const IMAGE_MIN_SIZE_PX = 100;

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

/**
 * Upload toutes les images extraites par l'OCR vers Cloudinary en parallèle.
 * Retourne une map imageId → URL Cloudinary.
 * Les images qui échouent sont ignorées (le texte reste intact).
 */
async function uploadOcrImages(
  ocrPages: OCRPageObject[],
  userId: string,
  fileName: string,
): Promise<Map<string, string>> {
  // Déduplique par ID (une image peut apparaître sur plusieurs pages)
  const seen = new Map<string, { base64: string; mimetype: string }>();
  for (const page of ocrPages) {
    for (const img of page.images ?? []) {
      if (!img.imageBase64 || seen.has(img.id)) continue;

      // Mistral retourne une data URL complète: "data:image/jpeg;base64,/9j/..."
      // Il faut extraire le type MIME et le base64 pur séparément.
      let rawBase64 = img.imageBase64;
      let mimetype = "image/jpeg";
      if (rawBase64.startsWith("data:")) {
        const commaIdx = rawBase64.indexOf(",");
        if (commaIdx !== -1) {
          mimetype = rawBase64.slice(5, commaIdx).split(";")[0];
          rawBase64 = rawBase64.slice(commaIdx + 1);
        }
      } else {
        const ext = img.id.split(".").pop()?.toLowerCase() ?? "jpeg";
        mimetype = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      }

      seen.set(img.id, { base64: rawBase64, mimetype });
    }
  }

  if (seen.size === 0) return new Map();

  logger.log(`📸 [MISTRAL-OCR] Uploading ${seen.size} image(s) from "${fileName}"`);

  const entries = Array.from(seen.entries());
  const results = await Promise.all(
    entries.map(async ([id, { base64, mimetype }]) => {
      const buffer = Buffer.from(base64, "base64");
      try {
        const url = await uploadImageBuffer(buffer, mimetype, id, userId);
        return { id, url };
      } catch (error) {
        logger.warn(`[MISTRAL-OCR] Image upload failed for ${id}:`, error);
        return null;
      }
    }),
  );

  const map = new Map<string, string>();
  for (const r of results) {
    if (r) map.set(r.id, r.url);
  }

  logger.log(`✅ [MISTRAL-OCR] ${map.size}/${seen.size} image(s) uploaded to Cloudinary`);
  return map;
}

/**
 * Remplace les références d'images OCR (ex: `![img-0.jpeg](img-0.jpeg)`)
 * par leurs URLs Cloudinary définitives.
 */
function replaceImageRefs(markdown: string, imageMap: Map<string, string>): string {
  if (imageMap.size === 0) return markdown;
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    const url = imageMap.get(src);
    return url ? `![${alt}](${url})` : match;
  });
}

/**
 * Extrait le contenu d'un PDF via Mistral OCR.
 * Si `userId` est fourni, les images extraites sont uploadées sur Cloudinary
 * et leurs références dans le markdown sont remplacées par des URLs permanentes.
 */
export async function extractPdf(
  buffer: Buffer,
  fileName: string,
  userId?: string,
): Promise<ExtractedPdf> {
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
        includeImageBase64: true,
        imageMinSize: IMAGE_MIN_SIZE_PX,
      },
      { fetchOptions: { signal: AbortSignal.timeout(TIMEOUT_MS) } },
    );

    const ocrPages = response.pages ?? [];

    // Upload images en parallèle si userId fourni
    const imageMap =
      userId && ocrPages.length > 0
        ? await uploadOcrImages(ocrPages, userId, fileName)
        : new Map<string, string>();

    const pages = ocrPages.map((page, index) => ({
      pageNumber: page.index ?? index + 1,
      content: replaceImageRefs(page.markdown ?? "", imageMap),
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
