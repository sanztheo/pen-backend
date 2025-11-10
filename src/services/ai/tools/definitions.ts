/**
 * 🔧 FUNCTION CALLING TOOLS DEFINITIONS
 * Définitions des tooels disponibles pour l'IA (OpenAI Function Calling)
 */

export const FUNCTION_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_available_sources",
      description: "Liste toutes les sources RAG disponibles pour l'utilisateur (pages, fichiers, notes, Wikipedia). Retourne les informations essentielles pour décider quelles sources utiliser.",
      parameters: {
        type: "object",
        properties: {
          workspaceId: { 
            type: "string", 
            description: "UUID du workspace (fourni dans le contexte)" 
          },
          limit: { 
            type: "number", 
            description: "Nombre maximum de sources à lister (par défaut: 20, max: 50)" 
          }
        },
        required: ["workspaceId"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "list_global_wikipedia_sources",
      description: "Liste toutes les sources Wikipedia GLOBALES partagées entre tous les utilisateurs (déjà indexées et disponibles). Utilise ce tool avant de passer au search_web pour vérifier si une Wikipedia pertinente existe déjà.",
      parameters: {
        type: "object",
        properties: {
          limit: { 
            type: "number", 
            description: "Nombre maximum de sources à lister (par défaut: 20, max: 50)" 
          }
        },
        required: []
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "select_relevant_sources",
      description: "IA sélectionne les sources pertinentes pour répondre à une question spécifique. Utilise la fonction select_sources_tool avec les IDs sélectionnés.",
      parameters: {
        type: "object",
        properties: {
          question: { 
            type: "string", 
            description: "La question de l'utilisateur" 
          },
          availableSources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                sourceType: { type: "string" }
              }
            },
            description: "Liste des sources disponibles (obtenue via list_available_sources)"
          },
          maxResults: { 
            type: "number", 
            description: "Nombre maximum de sources à sélectionner (par défaut: 5)" 
          }
        },
        required: ["question", "availableSources"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "check_sources_rag_status",
      description: "Vérifie le statut RAG des sources sélectionnées (lesquelles ont des chunks indexés vs lesquelles besoin de RAG).",
      parameters: {
        type: "object",
        properties: {
          sourceIds: { 
            type: "array",
            items: { type: "string" },
            description: "Array d'IDs de sources à vérifier" 
          }
        },
        required: ["sourceIds"]
      }
    }
  },
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
              enum: ["PDF", "TEXT_FILE", "WIKIPEDIA", "WORKSPACE_PAGE", "USER_NOTES"] 
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
      description: "Recherche sur le web via OpenAI pour obtenir des informations actuelles, récentes ou externes aux sources disponibles. Utilise ce tool SEULEMENT si les sources RAG ne suffisent pas ou pour des informations très récentes.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Requête de recherche web claire et précise"
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

