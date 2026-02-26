/**
 * 🛡️ UNIFIED VALIDATION UTILITIES
 * Utilitaires de validation partagés entre tous les handlers
 */

/**
 * RAG source input structure (can be from various sources)
 * Title is optional at input but required after validation
 */
interface RagSourceInput {
  title: string;
  id?: string;
  type?: string;
  [key: string]: unknown;
}

export class ValidationUtils {
  /**
   * Valide et filtre les UUIDs pour Prisma
   * FIXE: Redondance entre askStream:55-64 et searchStream:149-157
   */
  static validatePageIds(pageIds: (string | number)[]): string[] {
    return pageIds
      .map((id) => String(id))
      .filter((id) => {
        // Validation UUID (32 chars + 4 hyphens = 36 chars total)
        return id.length === 36 && id.includes("-") && id.match(/^[0-9a-f-]{36}$/i);
      });
  }

  /**
   * Valide les paramètres de requête communs
   */
  static validateCommonParams(params: {
    query?: string;
    workspaceId?: string;
    pageIds?: (string | number)[];
    useWeb?: boolean;
    ragSources?: RagSourceInput[];
  }) {
    const { query, workspaceId, pageIds = [], useWeb = false, ragSources = [] } = params;

    const errors: string[] = [];

    if (!query || query.trim().length === 0) {
      errors.push("query requis");
    }

    if (!workspaceId || workspaceId.trim().length === 0) {
      errors.push("workspaceId requis");
    }

    return {
      errors,
      sanitized: {
        query: query?.trim() || "",
        workspaceId: workspaceId?.trim() || "",
        pageIds: this.validatePageIds(pageIds),
        useWeb: Boolean(useWeb),
        ragSources: Array.isArray(ragSources) ? ragSources : [],
      },
    };
  }

  /**
   * Valide les sources RAG
   */
  static validateRagSources(
    ragSources: unknown[],
  ): Array<{ title: string; id?: string; type?: string }> {
    if (!Array.isArray(ragSources)) return [];

    return ragSources
      .filter(
        (source): source is RagSourceInput =>
          source !== null &&
          typeof source === "object" &&
          "title" in source &&
          typeof (source as RagSourceInput).title === "string" &&
          ((source as RagSourceInput).title ?? "").trim().length > 0,
      )
      .map((source) => ({
        title: (source.title ?? "").trim(),
        id: source.id,
        type: source.type ?? "UNKNOWN",
      }));
  }
}
