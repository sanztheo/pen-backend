/**
 * 🔧 FUNCTION CALLING TOOLS DEFINITIONS
 * Définitions des tools disponibles pour l'IA (OpenAI Function Calling)
 */

export const FUNCTION_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "read_rag_source",
      description: "Lit le contenu d'une source RAG spécifique (PDF, fichier texte, Wikipedia). Retourne les chunks les plus pertinents pour répondre à la question. UTILISE CE TOOL si l'utilisateur a joint un fichier ou mentionné une source Wikipedia spécifique.",
      parameters: {
        type: "object",
        properties: {
          sourceId: { 
            type: "string", 
            description: "UUID de la source RAG à lire (fourni dans la liste des sources disponibles)" 
          },
          query: { 
            type: "string", 
            description: "Question ou contexte pour filtrer les chunks les plus pertinents de cette source" 
          },
          limit: { 
            type: "number", 
            description: "Nombre maximum de chunks à retourner (par défaut: 3, max: 10)" 
          }
        },
        required: ["sourceId", "query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_rag_chunks",
      description: "Recherche sémantique dans toutes les sources RAG disponibles (fichiers joints, Wikipedia, pages du workspace). Utilise ce tool pour des recherches larges quand tu ne sais pas quelle source consulter.",
      parameters: {
        type: "object",
        properties: {
          query: { 
            type: "string", 
            description: "Requête de recherche sémantique" 
          },
          sourceTypes: { 
            type: "array", 
            items: { 
              type: "string", 
              enum: ["PDF", "TEXT_FILE", "WIKIPEDIA", "WORKSPACE_PAGE"] 
            },
            description: "Types de sources à inclure dans la recherche (optionnel, par défaut: tous)" 
          },
          limit: { 
            type: "number", 
            description: "Nombre maximum de résultats à retourner (par défaut: 5, max: 15)" 
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_web",
      description: "Recherche sur le web via Tavily pour obtenir des informations actuelles, récentes ou externes aux sources disponibles. Utilise ce tool SEULEMENT si les sources RAG ne suffisent pas ou pour des informations très récentes.",
      parameters: {
        type: "object",
        properties: {
          query: { 
            type: "string", 
            description: "Requête de recherche web claire et précise" 
          },
          maxResults: { 
            type: "number", 
            description: "Nombre maximum de résultats web (par défaut: 3, max: 5)" 
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "read_workspace_page",
      description: "Lit le contenu complet d'une page spécifique du workspace de l'utilisateur. Utilise ce tool si l'utilisateur mentionne une page particulière ou si tu as besoin du contenu détaillé d'une page identifiée.",
      parameters: {
        type: "object",
        properties: {
          pageId: { 
            type: "string", 
            description: "UUID de la page à lire (obtenu via list_workspace_pages ou fourni par l'utilisateur)" 
          }
        },
        required: ["pageId"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "list_workspace_pages",
      description: "Liste les pages récentes disponibles dans le workspace de l'utilisateur (titres et IDs). Utilise ce tool si tu as besoin de trouver une page spécifique ou d'explorer les pages disponibles.",
      parameters: {
        type: "object",
        properties: {
          workspaceId: { 
            type: "string", 
            description: "UUID du workspace (fourni dans le contexte)" 
          },
          limit: { 
            type: "number", 
            description: "Nombre maximum de pages à lister (par défaut: 10, max: 20)" 
          }
        },
        required: ["workspaceId"]
      }
    }
  }
];

