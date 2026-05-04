import { v2 as cloudinary } from "cloudinary";
import sharp from "sharp";
import { logger } from "../../utils/logger.js";

// Configuration Cloudinary depuis CLOUDINARY_URL
if (!process.env.CLOUDINARY_URL) {
  throw new Error("❌ CLOUDINARY_URL manquant dans .env");
}

cloudinary.config({
  cloudinary_url: process.env.CLOUDINARY_URL,
  secure: true,
});

// 🎯 Configuration upload
const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  COMPRESSION_QUALITY: 85,
  MAX_WIDTH: 2048,
  MAX_HEIGHT: 2048,
  FOLDER: "pennote/notes",
} as const;

// 🛡️ Types
export interface UploadResult {
  url: string;
  publicId: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

export interface UploadError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ✅ Validation du fichier
function validateFile(buffer: Buffer, mimetype: string): UploadError | null {
  // Vérifier la taille
  if (buffer.length > UPLOAD_CONFIG.MAX_FILE_SIZE) {
    return {
      code: "FILE_TOO_LARGE",
      message: `Fichier trop volumineux. Maximum: ${UPLOAD_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB`,
      details: { size: buffer.length, maxSize: UPLOAD_CONFIG.MAX_FILE_SIZE },
    };
  }

  // Vérifier le type MIME
  if (!isAllowedMimeType(mimetype)) {
    return {
      code: "INVALID_FILE_TYPE",
      message: `Type de fichier non supporté. Types acceptés: ${UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES.join(", ")}`,
      details: {
        receivedType: mimetype,
        allowedTypes: UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES,
      },
    };
  }

  return null;
}

// Type guard pour vérifier les types MIME valides
type AllowedMimeType = (typeof UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES)[number];

function isAllowedMimeType(mimetype: string): mimetype is AllowedMimeType {
  return UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES.includes(mimetype as AllowedMimeType);
}

// 🗜️ Compression intelligente avec Sharp
async function compressImage(buffer: Buffer, mimetype: string): Promise<Buffer> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Calculer nouvelles dimensions si nécessaire
    let width = metadata.width || UPLOAD_CONFIG.MAX_WIDTH;
    let height = metadata.height || UPLOAD_CONFIG.MAX_HEIGHT;

    if (width > UPLOAD_CONFIG.MAX_WIDTH || height > UPLOAD_CONFIG.MAX_HEIGHT) {
      const ratio = Math.min(UPLOAD_CONFIG.MAX_WIDTH / width, UPLOAD_CONFIG.MAX_HEIGHT / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    // Compression selon le type
    let compressed = image.resize(width, height, {
      fit: "inside",
      withoutEnlargement: true,
    });

    // Format de sortie optimisé
    if (mimetype === "image/png") {
      compressed = compressed.png({
        quality: UPLOAD_CONFIG.COMPRESSION_QUALITY,
        compressionLevel: 9,
        adaptiveFiltering: true,
      });
    } else if (mimetype === "image/gif") {
      // GIF converti en WebP pour meilleure compression
      compressed = compressed.webp({
        quality: UPLOAD_CONFIG.COMPRESSION_QUALITY,
        effort: 6,
      });
    } else {
      // JPEG/WebP
      compressed = compressed.jpeg({
        quality: UPLOAD_CONFIG.COMPRESSION_QUALITY,
        progressive: true,
        mozjpeg: true,
      });
    }

    return await compressed.toBuffer();
  } catch (error: unknown) {
    logger.error("❌ Erreur compression Sharp:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Échec compression: ${errorMessage}`);
  }
}

// 📤 Upload vers Cloudinary
export async function uploadToCloudinary(
  buffer: Buffer,
  mimetype: string,
  filename: string,
  userId: string,
): Promise<UploadResult> {
  // 1. Validation
  const validationError = validateFile(buffer, mimetype);
  if (validationError) {
    throw new Error(`${validationError.code}: ${validationError.message}`);
  }

  try {
    // 2. Compression
    logger.log("🗜️ Compression image...", {
      originalSize: buffer.length,
      filename,
    });

    const compressedBuffer = await compressImage(buffer, mimetype);

    logger.log("✅ Compression réussie", {
      originalSize: buffer.length,
      compressedSize: compressedBuffer.length,
      reduction: `${((1 - compressedBuffer.length / buffer.length) * 100).toFixed(1)}%`,
    });

    // 3. Upload vers Cloudinary
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: UPLOAD_CONFIG.FOLDER,
          public_id: `${userId}_${Date.now()}`,
          resource_type: "image",
          overwrite: false,
          unique_filename: true,
          // Optimisations Cloudinary
          quality: "auto:good",
          fetch_format: "auto",
          flags: "progressive",
          // Métadonnées
          context: {
            userId,
            originalFilename: filename,
            uploadedAt: new Date().toISOString(),
          },
        },
        (error, result) => {
          if (error) {
            logger.error("❌ Erreur upload Cloudinary:", error);
            reject(new Error(`Upload échoué: ${error.message}`));
            return;
          }

          if (!result) {
            reject(new Error("Upload échoué: pas de résultat"));
            return;
          }

          logger.log("✅ Upload Cloudinary réussi:", {
            publicId: result.public_id,
            url: result.secure_url,
            bytes: result.bytes,
          });

          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
          });
        },
      );

      uploadStream.end(compressedBuffer);
    });
  } catch (error: unknown) {
    logger.error("❌ Erreur uploadToCloudinary:", error);
    throw error;
  }
}

/**
 * 📸 Upload interne pour les images extraites de PDFs (OCR pipeline).
 * Bypasse la validation taille/type — les données viennent de Mistral OCR, pas d'un input utilisateur.
 * Retourne directement l'URL Cloudinary.
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  mimetype: string,
  filename: string,
  userId: string,
): Promise<string> {
  const compressedBuffer = await compressImage(buffer, mimetype);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: UPLOAD_CONFIG.FOLDER,
        public_id: `${userId}_ocr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        resource_type: "image",
        overwrite: false,
        unique_filename: true,
        quality: "auto:good",
        fetch_format: "auto",
        flags: "progressive",
        context: {
          userId,
          originalFilename: filename,
          uploadedAt: new Date().toISOString(),
          source: "pdf_ocr",
        },
      },
      (error, result) => {
        if (error) reject(new Error(`OCR image upload failed: ${error.message}`));
        else if (!result) reject(new Error("OCR image upload failed: no result"));
        else resolve(result.secure_url);
      },
    );
    uploadStream.end(compressedBuffer);
  });
}

// 🗑️ Suppression d'image (optionnel, pour nettoyage)
export async function deleteFromCloudinary(publicId: string): Promise<void> {
  logger.log("🗑️ [Cloudinary Service] Début suppression:", {
    publicId,
    timestamp: new Date().toISOString(),
  });

  try {
    const result = await cloudinary.uploader.destroy(publicId);

    logger.log("✅ [Cloudinary Service] Réponse Cloudinary:", {
      publicId,
      result: result.result, // "ok" si réussi, "not found" si introuvable
      rawResult: result,
      timestamp: new Date().toISOString(),
    });

    // Vérifier si la suppression a vraiment réussi
    if (result.result === "ok") {
      logger.log("✅ [Cloudinary Service] Image SUPPRIMÉE avec succès de Cloudinary");
    } else if (result.result === "not found") {
      logger.warn("⚠️ [Cloudinary Service] Image déjà supprimée ou introuvable sur Cloudinary");
    } else {
      logger.warn("⚠️ [Cloudinary Service] Statut suppression inattendu:", result.result);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error("❌ [Cloudinary Service] ÉCHEC suppression Cloudinary:", {
      publicId,
      error: errorMessage,
      stack: errorStack,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Suppression échouée: ${errorMessage}`);
  }
}

/**
 * 🧹 GDPR cascade: delete every Cloudinary asset owned by `userId`.
 *
 * The publicId convention (see `routes/upload.ts`) is:
 *   pennote/notes/${userId}_<timestamp>...
 *   pennote/notes/${userId}/...
 *
 * Cloudinary's `delete_resources_by_prefix` walks both forms when given
 * the prefix `pennote/notes/${userId}` (it does prefix matching, not
 * exact). We loop with `next_cursor` to handle users with > 100 assets.
 *
 * Throws on Cloudinary failure — the caller is expected to wrap in a
 * try/catch + audit log so the rest of the deletion proceeds.
 */
export async function deleteUserCloudinaryAssets(userId: string): Promise<{
  deletedCount: number;
}> {
  if (!userId) throw new Error("[Cloudinary] deleteUserCloudinaryAssets: userId required");

  const prefix = `${UPLOAD_CONFIG.FOLDER}/${userId}`;
  let deletedCount = 0;
  let nextCursor: string | undefined;

  do {
    const result: { deleted?: Record<string, string>; next_cursor?: string } =
      await cloudinary.api.delete_resources_by_prefix(prefix, {
        resource_type: "image",
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
      });

    deletedCount += Object.keys(result.deleted ?? {}).length;
    nextCursor = result.next_cursor;
  } while (nextCursor);

  logger.log("🧹 [Cloudinary Service] User assets purged:", { userId, deletedCount });
  return { deletedCount };
}

export { UPLOAD_CONFIG };
