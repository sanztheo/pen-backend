import { Router, Request, Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import { authenticateToken } from "../middlewares/auth.js";
import { logger } from "../utils/logger.js";
import { extractPdf } from "../services/ocr/mistralOcr.js";
import { AICreditsService } from "../services/credits/aiCreditsService.js";
import { pdfExtractRateLimit } from "../middlewares/rateLimiting.js";
import { redis } from "../lib/redis.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const CREDITS_PER_PAGE = 1;
const PDF_MAGIC_BYTES = "%PDF-";
const ACTION = "pdf_ocr_extraction";
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_PREFIX = "pdf-ocr:result";

interface CachedExtraction {
  markdown: string;
  totalPages: number;
  pages: { pageNumber: number; content: string }[];
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

const safeFileName = (name: string): string => name.replace(/[^\w.\- ]/g, "_").slice(0, 64);

const countPdfPages = async (buffer: Buffer): Promise<number> => {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return pdf.getPageCount();
};

const hashBuffer = (buffer: Buffer): string =>
  crypto.createHash("sha256").update(buffer).digest("hex");

const cacheKeyFor = (userId: string, hash: string): string => `${CACHE_PREFIX}:${userId}:${hash}`;

const readCache = async (userId: string, hash: string): Promise<CachedExtraction | null> => {
  try {
    const raw = await redis.get(cacheKeyFor(userId, hash));
    if (!raw) return null;
    return JSON.parse(raw) as CachedExtraction;
  } catch (error) {
    logger.warn("[PDF-EXTRACT] Cache read failed:", error);
    return null;
  }
};

const writeCache = async (userId: string, hash: string, value: CachedExtraction): Promise<void> => {
  try {
    await redis.setex(cacheKeyFor(userId, hash), CACHE_TTL_SECONDS, JSON.stringify(value));
  } catch (error) {
    logger.warn("[PDF-EXTRACT] Cache write failed:", error);
  }
};

export const pdfRouter = Router();

pdfRouter.post(
  "/extract",
  authenticateToken,
  pdfExtractRateLimit,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier fourni" });
    }
    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Le fichier doit être un PDF" });
    }

    const header = req.file.buffer.subarray(0, 5).toString("ascii");
    if (header !== PDF_MAGIC_BYTES) {
      return res.status(400).json({ error: "Le fichier n'est pas un PDF valide" });
    }

    const fileName = safeFileName(req.file.originalname);
    const contentHash = hashBuffer(req.file.buffer);

    // 💾 Dédup cache — même PDF déjà extrait dans les dernières 24h → zéro crédit
    const cached = await readCache(userId, contentHash);
    if (cached) {
      logger.log(
        `♻️ [PDF-EXTRACT] Cache hit for user ${userId} "${fileName}" (${cached.totalPages}p, 0 credits)`,
      );
      return res.json({ ...cached, fileName, cached: true });
    }

    let pageCount: number;
    try {
      pageCount = await countPdfPages(req.file.buffer);
    } catch (error) {
      logger.warn(`[PDF-EXTRACT] Failed to parse PDF structure for user ${userId}:`, error);
      return res.status(400).json({ error: "PDF illisible ou corrompu" });
    }

    if (pageCount <= 0) {
      return res.status(400).json({ error: "PDF vide" });
    }
    if (pageCount > MAX_PDF_PAGES) {
      return res.status(413).json({
        error: `PDF trop volumineux: ${pageCount} pages (max ${MAX_PDF_PAGES})`,
      });
    }

    const cost = pageCount * CREDITS_PER_PAGE;
    const deduction = await AICreditsService.deductCredits(userId, cost, ACTION);
    if (!deduction.success) {
      logger.warn(
        `[PDF-EXTRACT] Credits insufficient for user ${userId} (needed ${cost}, remaining ${deduction.remainingCredits ?? "?"})`,
      );
      return res.status(403).json({
        error: "Crédits IA insuffisants",
        code: "INSUFFICIENT_CREDITS",
        required: cost,
        remaining: deduction.remainingCredits,
      });
    }

    logger.log(
      `📄 [PDF-EXTRACT] User ${userId} uploaded "${fileName}" (${req.file.size}B, ${pageCount}p, ${cost} credits)`,
    );

    try {
      const { markdown, totalPages, pages } = await extractPdf(req.file.buffer, fileName);
      const result: CachedExtraction = { markdown, totalPages, pages };
      await writeCache(userId, contentHash, result);
      return res.json({ ...result, fileName });
    } catch (error) {
      logger.error(
        `[PDF-EXTRACT] OCR failed for user ${userId}, refunding ${cost} credits:`,
        error,
      );
      await AICreditsService.refundCredits(userId, cost, `${ACTION}_refund`).catch((refundError) =>
        logger.error("[PDF-EXTRACT] Refund failed:", refundError),
      );
      return res.status(502).json({ error: "Échec de l'extraction PDF" });
    }
  },
);
