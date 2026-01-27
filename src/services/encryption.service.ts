/**
 * 🔐 SERVICE DE CHIFFREMENT AES-256-GCM
 *
 * Chiffre les données sensibles (thinking, intermediateThinkingBlocks) dans la base de données.
 * Utilise AES-256-GCM avec authentification pour garantir confidentialité et intégrité.
 *
 * SÉCURITÉ:
 * - Algorithme: AES-256-GCM (authentifié)
 * - Clé: 32 bytes (256 bits) depuis variable d'environnement
 * - IV: 16 bytes aléatoires (renouvelés à chaque chiffrement)
 * - Format de sortie: {iv}:{authTag}:{encrypted} (base64)
 */

import crypto from "crypto";

export class EncryptionService {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly IV_LENGTH = 16; // 128 bits
  private static readonly AUTH_TAG_LENGTH = 16; // 128 bits
  private static readonly KEY_LENGTH = 32; // 256 bits

  /**
   * Récupère la clé de chiffrement depuis l'environnement
   * La clé doit être un string hexadécimal de 64 caractères (32 bytes)
   */
  private static getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;

    if (!key) {
      throw new Error(
        "🔴 ENCRYPTION_KEY manquante dans .env - Chiffrement impossible",
      );
    }

    // Vérifier que la clé est bien en hexadécimal et fait 64 caractères
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error(
        "🔴 ENCRYPTION_KEY invalide - Doit être 64 caractères hexadécimaux (32 bytes)",
      );
    }

    return Buffer.from(key, "hex");
  }

  /**
   * Chiffre une chaîne de caractères avec AES-256-GCM
   *
   * @param plaintext - Texte en clair à chiffrer
   * @returns Format: {iv}:{authTag}:{encrypted} (base64)
   */
  static encrypt(plaintext: string | null | undefined): string | null {
    if (!plaintext) {
      return null;
    }

    try {
      const key = this.getEncryptionKey();

      // Générer un IV aléatoire pour chaque chiffrement (sécurité)
      const iv = crypto.randomBytes(this.IV_LENGTH);

      // Créer le cipher
      const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

      // Chiffrer les données
      let encrypted = cipher.update(plaintext, "utf8", "base64");
      encrypted += cipher.final("base64");

      // Récupérer le tag d'authentification
      const authTag = cipher.getAuthTag();

      // Format: {iv}:{authTag}:{encrypted} (tous en base64)
      const result = `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;

      return result;
    } catch (error) {
      console.error("❌ [ENCRYPTION] Erreur lors du chiffrement:", error);
      throw new Error("Échec du chiffrement des données sensibles");
    }
  }

  /**
   * Déchiffre une chaîne chiffrée avec AES-256-GCM
   *
   * @param encrypted - Format: {iv}:{authTag}:{encrypted} (base64)
   * @returns Texte en clair
   */
  static decrypt(encrypted: string | null | undefined): string | null {
    if (!encrypted) {
      return null;
    }

    // ✅ DÉTECTION AUTOMATIQUE : Vérifier si les données sont chiffrées ou en clair
    // Le format chiffré est : {iv}:{authTag}:{encrypted} (3 parties séparées par :)
    const parts = encrypted.split(":");
    if (parts.length !== 3) {
      console.log(
        "⚠️ [ENCRYPTION] Données en clair détectées, pas de déchiffrement nécessaire",
      );
      return encrypted; // Retourner tel quel si ce n'est pas le bon format
    }

    try {
      const key = this.getEncryptionKey();

      const iv = Buffer.from(parts[0], "base64");
      const authTag = Buffer.from(parts[1], "base64");
      const encryptedData = parts[2];

      // Créer le decipher
      const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      // Déchiffrer les données
      let decrypted = decipher.update(encryptedData, "base64", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      console.error("❌ [ENCRYPTION] Erreur lors du déchiffrement:", error);
      console.error(
        "❌ [ENCRYPTION] Données corrompues ou clé invalide — déchiffrement impossible",
      );
      return null;
    }
  }

  /**
   * Chiffre un objet JSON (pour intermediateThinkingBlocks)
   *
   * @param data - Objet à chiffrer
   * @returns Chaîne chiffrée ou null
   */
  static encryptJSON(data: any | null | undefined): string | null {
    if (!data) {
      return null;
    }

    try {
      const jsonString = JSON.stringify(data);
      return this.encrypt(jsonString);
    } catch (error) {
      console.error("❌ [ENCRYPTION] Erreur lors du chiffrement JSON:", error);
      throw new Error("Échec du chiffrement des données JSON");
    }
  }

  /**
   * Déchiffre un objet JSON
   *
   * @param encrypted - Chaîne chiffrée, objet ou null
   * @returns Objet déchiffré ou null
   */
  static decryptJSON<T = any>(encrypted: any): T | null {
    // Cas 1 : null ou undefined
    if (!encrypted) {
      return null;
    }

    // Cas 2 : Déjà un objet (données en clair stockées comme objet)
    if (typeof encrypted === "object") {
      console.log("⚠️ [ENCRYPTION] Données JSON en clair (objet) détectées");
      return encrypted as T;
    }

    // Cas 3 : String (peut être chiffré ou JSON en clair)
    if (typeof encrypted !== "string") {
      console.error(
        "❌ [ENCRYPTION] Type de données invalide:",
        typeof encrypted,
      );
      return null;
    }

    try {
      // Essayer de déchiffrer (si format iv:authTag:encrypted)
      const decrypted = this.decrypt(encrypted);

      if (!decrypted) {
        return null;
      }

      // Parser le JSON déchiffré
      return JSON.parse(decrypted) as T;
    } catch (error) {
      // Si le déchiffrement ou le parsing échoue,
      // essayer de parser directement (JSON en clair)
      try {
        console.log(
          "⚠️ [ENCRYPTION] Tentative de parsing JSON en clair (string)",
        );
        return JSON.parse(encrypted) as T;
      } catch (parseError) {
        console.error("❌ [ENCRYPTION] Erreur parsing JSON:", parseError);
        return null;
      }
    }
  }

  /**
   * Génère une nouvelle clé de chiffrement AES-256 (32 bytes en hex)
   * Utile pour générer ENCRYPTION_KEY lors de l'installation
   *
   * @returns Clé hexadécimale de 64 caractères
   */
  static generateKey(): string {
    return crypto.randomBytes(this.KEY_LENGTH).toString("hex");
  }

  /**
   * Vérifie si le chiffrement est configuré correctement
   *
   * @returns true si ENCRYPTION_KEY est configurée et valide
   */
  static isConfigured(): boolean {
    try {
      this.getEncryptionKey();
      return true;
    } catch {
      return false;
    }
  }
}
