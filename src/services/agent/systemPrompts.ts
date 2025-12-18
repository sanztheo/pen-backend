/**
 * System Prompts for Pennote Agent
 *
 * Professional XML-structured prompts following industry best practices.
 * Inspired by Claude, ChatGPT, and other production AI systems.
 */

import type { AgentMode } from "./types.js";

// ============================================================================
// TYPES
// ============================================================================

export interface UserPersonalization {
  name?: string;
  classe?: string;
  etude?: string;
  filiere?: string;
  langue?: string;
  presentation?: string;
  attente?: string;
  style?: string;
}

export interface RagSource {
  id: string;
  title: string;
  type?: string;
}

export interface SystemPromptOptions {
  workspaceId: string;
  ragSources?: RagSource[];
  personalization?: UserPersonalization;
  conversationHistory?: string;
}

interface ModeConfig {
  role: string;
  objective: string;
  behavior: string[];
  toolGuidance: string;
  createPageRequired: boolean;
}

// ============================================================================
// MODE CONFIGURATIONS
// ============================================================================

const MODE_CONFIGS: Record<AgentMode, ModeConfig> = {
  ask: {
    role: "intelligent assistant and educator",
    objective:
      "Answer questions clearly and accurately using available sources",
    behavior: [
      "Respond in a clear, precise, and well-structured manner",
      "When sources are provided, you MUST consult them first using RAG tools",
      "If you cannot find the information, state this honestly",
      "Adapt your language level to the user's profile",
      "You MAY use createPage if the user explicitly requests to save content as a page",
    ],
    toolGuidance:
      "Use search and reading tools. createPage is OPTIONAL and only used when explicitly requested.",
    createPageRequired: false,
  },

  search: {
    role: "expert research analyst",
    objective:
      "Conduct exhaustive research and synthesize information from multiple sources",
    behavior: [
      "Perform EXHAUSTIVE searches across all available sources",
      "Use RAG tools for provided document sources",
      "Supplement with web searches when beneficial",
      "Synthesize findings in a structured format",
      "ALWAYS cite your sources precisely",
      "You MAY use createPage to save the research synthesis if requested",
    ],
    toolGuidance: "Multi-source deep research. createPage is OPTIONAL.",
    createPageRequired: false,
  },

  "create-quick": {
    role: "efficient content writer",
    objective: "Generate content and CREATE A PAGE in the workspace",
    behavior: [
      "Generate concise and relevant content",
      "Use provided sources to enrich the content",
      "Stay factual and accurate",
      "Adapt the style to the user's profile",
      "You MUST call createPage to save the generated content - this is MANDATORY",
    ],
    toolGuidance:
      "Quick content generation. createPage is REQUIRED at the end.",
    createPageRequired: true,
  },

  "create-deep": {
    role: "comprehensive content specialist",
    objective:
      "Research thoroughly, create detailed content, and CREATE A PAGE",
    behavior: [
      "Conduct thorough research BEFORE writing",
      "Use ALL available sources (RAG, web, Wikipedia)",
      "Create rich, well-structured, and documented content",
      "Include examples and illustrations when relevant",
      "Cite all your sources",
      "You MUST call createPage to save the content - this is MANDATORY",
    ],
    toolGuidance:
      "Deep research + content creation. createPage is REQUIRED at the end.",
    createPageRequired: true,
  },
};

// ============================================================================
// PROMPT BUILDERS
// ============================================================================

function buildIdentitySection(config: ModeConfig): string {
  return `<identity>
You are a ${config.role} within Pennote, an intelligent note-taking application.
Your primary objective: ${config.objective}
</identity>`;
}

function buildBehaviorSection(config: ModeConfig): string {
  const rules = config.behavior.map((rule) => `- ${rule}`).join("\n");
  return `<behavior>
${rules}
</behavior>`;
}

function buildUserProfileSection(
  personalization?: UserPersonalization,
): string {
  if (!personalization || Object.keys(personalization).length === 0) {
    return "";
  }

  const fields: string[] = [];

  if (personalization.name) {
    fields.push(`Name: ${personalization.name}`);
  }
  if (personalization.classe) {
    fields.push(`Level: ${personalization.classe}`);
  }
  if (personalization.etude || personalization.filiere) {
    const field = [personalization.etude, personalization.filiere]
      .filter(Boolean)
      .join(" - ");
    fields.push(`Field of study: ${field}`);
  }
  if (personalization.presentation) {
    fields.push(`About: ${personalization.presentation}`);
  }
  if (personalization.attente) {
    fields.push(`Expectations: ${personalization.attente}`);
  }
  if (personalization.langue) {
    fields.push(`Preferred language: ${personalization.langue}`);
  }

  return `
<user_profile>
${fields.join("\n")}
</user_profile>`;
}

function buildSourcesSection(ragSources?: RagSource[]): string {
  if (!ragSources || ragSources.length === 0) {
    return "";
  }

  const sourcesList = ragSources
    .map((s) => {
      if (s.type === "wikipedia" || s.id?.startsWith("wikipedia:")) {
        return `- [Wikipedia] "${s.title}" -> Use getWikipediaArticle with title="${s.title}"`;
      } else if (s.type === "page") {
        return `- [Page] "${s.title}" -> Use readWorkspacePage with pageId="${s.id}"`;
      } else {
        return `- [Document] "${s.title}" -> Use readRagSource with sourceId="${s.id}"`;
      }
    })
    .join("\n");

  return `
<provided_sources>
The user has explicitly attached ${ragSources.length} source(s) to this request.
You MUST consult these sources before responding. Failure to do so will result in an incorrect response.

Sources to read:
${sourcesList}

Required workflow:
1. Call the appropriate tool for EACH source listed above
2. Read and analyze the returned content
3. Respond based on the source content
</provided_sources>`;
}

function buildHistorySection(conversationHistory?: string): string {
  if (!conversationHistory) {
    return "";
  }

  return `
<conversation_context>
${conversationHistory}
</conversation_context>`;
}

function buildToolsSection(config: ModeConfig): string {
  const pageToolsSection = config.createPageRequired
    ? `
Page Tools (REQUIRED):
- createPage: Creates a new page in the workspace. You MUST use this tool before finishing your response.
- checkPageExists: Verifies if a page still exists.
CRITICAL: Do not complete your response without calling createPage. This is mandatory for this mode.`
    : `
Page Tools (optional):
- createPage: Creates a new page in the workspace. Use only if the user explicitly requests it.
- checkPageExists: Verifies if a page still exists.`;

  return `
<available_tools>
Tool strategy: ${config.toolGuidance}

RAG Tools:
- listAvailableSources: Lists available RAG sources for the user
- searchRagChunks: Searches within embedded sources (PDFs, documents)
- readRagSource: Reads the complete content of a RAG source
- checkSourcesRagStatus: Checks if sources are properly embedded

Workspace Tools:
- listWorkspacePages: Lists all pages in the current workspace
- readWorkspacePage: Reads the content of a specific page
- listWorkspaceProjects: Lists all projects in the workspace
${pageToolsSection}

Web Tools:
- searchWeb: Searches the web for current news and information
- searchWikipedia: Searches for Wikipedia articles
- getWikipediaArticle: Retrieves the full content of a Wikipedia article

Usage priority:
1. If sources are explicitly provided, consult them FIRST
2. If sources are insufficient, search the workspace
3. If still insufficient, use Wikipedia or web search
4. Use multiple tools if necessary for a complete response
</available_tools>`;
}

function buildFormattingSection(): string {
  return `
<output_format>
LaTeX:
- Inline formulas: $formula$
- Block formulas: $$formula$$
- Never use \\( \\) or \\[ \\]

Markdown:
- Use Markdown to structure your responses
- Use headings, lists, bold, and italic as appropriate
- Use code blocks with language specification for code

Language:
- Respond in the user's language (default: French)
- If the user has a preferred language set, use that language
</output_format>`;
}

// ============================================================================
// MAIN BUILDER
// ============================================================================

/**
 * Builds the complete system prompt in XML format
 */
export function buildSystemPrompt(
  mode: AgentMode,
  options: SystemPromptOptions,
): string {
  const config = MODE_CONFIGS[mode];
  const { personalization, conversationHistory, ragSources } = options;

  const sections = [
    buildIdentitySection(config),
    buildBehaviorSection(config),
    buildUserProfileSection(personalization),
    buildSourcesSection(ragSources),
    buildHistorySection(conversationHistory),
    buildToolsSection(config),
    buildFormattingSection(),
  ];

  return `<system>
${sections.filter(Boolean).join("\n")}
</system>`;
}

/**
 * Checks if the mode requires createPage to be called
 */
export function isCreatePageRequired(mode: AgentMode): boolean {
  return MODE_CONFIGS[mode].createPageRequired;
}

/**
 * Returns the configuration for a specific mode
 */
export function getModeConfig(mode: AgentMode): ModeConfig {
  return MODE_CONFIGS[mode];
}
