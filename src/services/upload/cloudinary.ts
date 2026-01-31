import { v2 as cloudinary } from "cloudinary";
import sharp from "sharp";

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
  return UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES.includes(
    mimetype as AllowedMimeType,
  );
}

// 🗜️ Compression intelligente avec Sharp
async function compressImage(
  buffer: Buffer,
  mimetype: string,
): Promise<Buffer> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Calculer nouvelles dimensions si nécessaire
    let width = metadata.width || UPLOAD_CONFIG.MAX_WIDTH;
    let height = metadata.height || UPLOAD_CONFIG.MAX_HEIGHT;

    if (width > UPLOAD_CONFIG.MAX_WIDTH || height > UPLOAD_CONFIG.MAX_HEIGHT) {
      const ratio = Math.min(
        UPLOAD_CONFIG.MAX_WIDTH / width,
        UPLOAD_CONFIG.MAX_HEIGHT / height,
      );
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
    console.error("❌ Erreur compression Sharp:", error);
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
    console.log("🗜️ Compression image...", {
      originalSize: buffer.length,
      filename,
    });

    const compressedBuffer = await compressImage(buffer, mimetype);

    console.log("✅ Compression réussie", {
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
            console.error("❌ Erreur upload Cloudinary:", error);
            reject(new Error(`Upload échoué: ${error.message}`));
            return;
          }

          if (!result) {
            reject(new Error("Upload échoué: pas de résultat"));
            return;
          }

          console.log("✅ Upload Cloudinary réussi:", {
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
    console.error("❌ Erreur uploadToCloudinary:", error);
    throw error;
  }
}

// 🗑️ Suppression d'image (optionnel, pour nettoyage)
export async function deleteFromCloudinary(publicId: string): Promise<void> {
  console.log("🗑️ [Cloudinary Service] Début suppression:", {
    publicId,
    timestamp: new Date().toISOString(),
  });

  try {
    const result = await cloudinary.uploader.destroy(publicId);

    console.log("✅ [Cloudinary Service] Réponse Cloudinary:", {
      publicId,
      result: result.result, // "ok" si réussi, "not found" si introuvable
      rawResult: result,
      timestamp: new Date().toISOString(),
    });

    // Vérifier si la suppression a vraiment réussi
    if (result.result === "ok") {
      console.log(
        "✅ [Cloudinary Service] Image SUPPRIMÉE avec succès de Cloudinary",
      );
    } else if (result.result === "not found") {
      console.warn(
        "⚠️ [Cloudinary Service] Image déjà supprimée ou introuvable sur Cloudinary",
      );
    } else {
      console.warn(
        "⚠️ [Cloudinary Service] Statut suppression inattendu:",
        result.result,
      );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("❌ [Cloudinary Service] ÉCHEC suppression Cloudinary:", {
      publicId,
      error: errorMessage,
      stack: errorStack,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Suppression échouée: ${errorMessage}`);
  }
}

export { UPLOAD_CONFIG };
