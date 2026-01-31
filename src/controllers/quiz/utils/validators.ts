// Interface pour les détails de validation
interface ValidationDetails {
  message: string;
  provided?: number;
  limit?: number;
  documentSize?: number;
  totalSize?: number;
}

// 🛡️ Fonction utilitaire pour valider sourceDocuments
export const validateSourceDocuments = (
  sourceDocuments: unknown,
): { valid: boolean; error?: string; details?: ValidationDetails } => {
  if (!sourceDocuments) return { valid: true };

  if (!Array.isArray(sourceDocuments)) {
    return { valid: false, error: "sourceDocuments doit être un tableau" };
  }

  // Limiter le nombre de documents
  if (sourceDocuments.length > 50) {
    return {
      valid: false,
      error: "Trop de documents sources",
      details: {
        message: "Maximum 50 documents sources autorisés",
        provided: sourceDocuments.length,
        limit: 50,
      },
    };
  }

  // Calculer la taille totale des documents
  let totalSize = 0;
  for (const doc of sourceDocuments) {
    if (typeof doc === "string") {
      totalSize += doc.length;
    } else if (
      doc &&
      typeof doc === "object" &&
      typeof doc.content === "string"
    ) {
      totalSize += doc.content.length;
    } else if (doc && typeof doc === "object" && typeof doc.text === "string") {
      totalSize += doc.text.length;
    }

    // Limite par document individuel (500KB)
    const docSize =
      typeof doc === "string"
        ? doc.length
        : doc?.content?.length || doc?.text?.length || 0;
    if (docSize > 500000) {
      return {
        valid: false,
        error: "Document source trop volumineux",
        details: {
          message: "Taille maximale par document: 500KB",
          documentSize: docSize,
          limit: 500000,
        },
      };
    }
  }

  // Limite globale de taille (5MB total)
  if (totalSize > 5000000) {
    return {
      valid: false,
      error: "Documents sources trop volumineux",
      details: {
        message: "Taille totale maximale: 5MB",
        totalSize,
        limit: 5000000,
      },
    };
  }

  return { valid: true };
};
