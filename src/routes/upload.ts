import { Router, Request, Response } from "express";
import multer, { FileFilterCallback } from "multer";
import { authenticateToken } from "../middlewares/auth.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  UPLOAD_CONFIG,
} from "../services/upload/cloudinary.js";

const router = Router();

// 🛡️ Extension de Request pour inclure le fichier multer
declare module "express-serve-static-core" {
  interface Request {
    file?: Express.Multer.File;
  }
}

// 🎯 Configuration Multer (mémoire temporaire)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: UPLOAD_CONFIG.MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback,
  ) => {
    // Validation stricte du type MIME
    if (UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES.includes(file.mimetype as any)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non supporté: ${file.mimetype}`));
    }
  },
});

// 📤 Route POST /api/upload
router.post(
  "/",
  authenticateToken,
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      // Validation: fichier présent
      if (!req.file) {
        return res.status(400).json({
          error: "Aucun fichier fourni",
          code: "NO_FILE",
        });
      }

      // Validation: utilisateur authentifié
      if (!req.user) {
        return res.status(401).json({
          error: "Utilisateur non authentifié",
          code: "UNAUTHORIZED",
        });
      }

      const { buffer, mimetype, originalname } = req.file;
      const userId = req.user.id;

      console.log("📤 Upload demandé:", {
        userId,
        filename: originalname,
        mimetype,
        size: buffer.length,
      });

      // Upload vers Cloudinary avec compression
      const result = await uploadToCloudinary(
        buffer,
        mimetype,
        originalname,
        userId,
      );

      // Réponse succès
      return res.status(200).json({
        success: true,
        url: result.url,
        data: {
          publicId: result.publicId,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        },
      });
    } catch (error: any) {
      console.error("❌ Erreur upload:", error);

      // Gestion erreurs spécifiques
      if (error.message.includes("FILE_TOO_LARGE")) {
        return res.status(413).json({
          error: "Fichier trop volumineux",
          code: "FILE_TOO_LARGE",
          maxSize: `${UPLOAD_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB`,
        });
      }

      if (error.message.includes("INVALID_FILE_TYPE")) {
        return res.status(415).json({
          error: "Type de fichier non supporté",
          code: "INVALID_FILE_TYPE",
          allowedTypes: UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES,
        });
      }

      // Erreur générique
      return res.status(500).json({
        error: "Échec de l'upload",
        code: "UPLOAD_FAILED",
      });
    }
  },
);

// 🗑️ Route DELETE /api/upload/:publicId - Supprimer une image de Cloudinary
router.delete(
  "/:publicId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const startTime = Date.now();
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🗑️ [Route DELETE] NOUVELLE REQUÊTE DE SUPPRESSION");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    try {
      const { publicId } = req.params;

      console.log("📝 [Route DELETE] Paramètres reçus:", {
        publicIdRaw: req.params.publicId,
        publicIdDecoded: decodeURIComponent(publicId),
        headers: {
          authorization: req.headers.authorization ? "Present" : "Missing",
          contentType: req.headers["content-type"],
        },
      });

      // Validation: publicId présent
      if (!publicId) {
        console.log("❌ [Route DELETE] Échec: publicId manquant");
        return res.status(400).json({
          error: "publicId requis",
          code: "MISSING_PUBLIC_ID",
        });
      }

      // Validation: utilisateur authentifié
      if (!req.user) {
        console.log("❌ [Route DELETE] Échec: utilisateur non authentifié");
        return res.status(401).json({
          error: "Utilisateur non authentifié",
          code: "UNAUTHORIZED",
        });
      }

      // 🛡️ SÉCURITÉ: Vérifier que le publicId appartient bien à cet utilisateur
      // Format attendu: pennote/notes/userId_timestamp ou pennote/notes/userId/...
      const userId = req.user.id;

      // Extraction du segment après pennote/notes/ pour vérification stricte
      const expectedPrefix = `pennote/notes/${userId}_`;
      const expectedPrefixAlt = `pennote/notes/${userId}/`;
      const isOwner =
        publicId.startsWith(expectedPrefix) ||
        publicId.startsWith(expectedPrefixAlt);

      console.log("🔐 [Route DELETE] Vérification ownership:", {
        userId,
        publicId,
        isOwner,
      });

      if (!isOwner) {
        console.log("❌ [Route DELETE] Échec: ownership refusé");
        return res.status(403).json({
          error: "Accès refusé: cette image ne vous appartient pas",
          code: "FORBIDDEN",
        });
      }

      console.log(
        "✅ [Route DELETE] Validation réussie, appel service Cloudinary...",
      );

      // Suppression de Cloudinary
      await deleteFromCloudinary(publicId);

      const duration = Date.now() - startTime;
      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`✅ [Route DELETE] SUCCÈS - Durée: ${duration}ms`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return res.status(200).json({
        success: true,
        message: "Image supprimée avec succès",
        publicId,
        duration: `${duration}ms`,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error(`❌ [Route DELETE] ÉCHEC - Durée: ${duration}ms`);
      console.error("Erreur:", error.message);
      console.error("Stack:", error.stack);
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return res.status(500).json({
        error: "Échec de la suppression",
        code: "DELETE_FAILED",
      });
    }
  },
);

// 📊 Route GET /api/upload/config (optionnel, pour debug)
router.get("/config", (_req: Request, res: Response) => {
  return res.status(200).json({
    maxFileSize: UPLOAD_CONFIG.MAX_FILE_SIZE,
    maxFileSizeMB: UPLOAD_CONFIG.MAX_FILE_SIZE / 1024 / 1024,
    allowedTypes: UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES,
    compressionQuality: UPLOAD_CONFIG.COMPRESSION_QUALITY,
    maxDimensions: {
      width: UPLOAD_CONFIG.MAX_WIDTH,
      height: UPLOAD_CONFIG.MAX_HEIGHT,
    },
  });
});

export default router;
