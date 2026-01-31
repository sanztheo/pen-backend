/**
 * Agent Workflows for Pennote
 *
 * Implements advanced workflow patterns from Vercel AI SDK:
 * - Parallel Processing: Multiple searches run simultaneously
 * - Evaluator-Optimizer: Quality assessment and iteration
 * - Orchestrator-Worker: Main agent coordinates specialized workers
 *
 * @see https://ai-sdk.dev/docs/agents/workflows
 */

import { generateText, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createRagTools } from "./tools/ragTools.js";

// Créer le provider Google avec la clé API explicite
const google = createGoogleGenerativeAI({
  apiKey:
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});
import { createWebTools } from "./tools/webTools.js";
import { createWorkspaceTools } from "./tools/workspaceTools.js";
import { createPageTools } from "./tools/pageTools.js";
import type { AgentRequest } from "./types.js";
import {
  buildSystemPrompt,
  type RagSource,
  type UserPersonalization,
} from "./systemPrompts.js";

// ============================================================================
// TYPES
// ============================================================================

interface WorkflowContext {
  userId: string;
  workspaceId: string;
  ragSources?: RagSource[];
  personalization?: UserPersonalization;
}

interface SearchResult {
  source: "rag" | "web" | "wikipedia" | "workspace";
  query: string;
  content: string;
  relevance: number;
}

interface ResearchResults {
  searches: SearchResult[];
  summary: string;
  sources: string[];
}

interface EvaluationResult {
  score: number;
  feedback: string;
  passesThreshold: boolean;
  suggestions: string[];
}

interface ContentDraft {
  title: string;
  content: string;
  iteration: number;
}

// ============================================================================
// MODELS
// ============================================================================

const MODELS = {
  fast: google("gemini-2.0-flash"),
  thinking: google("gemini-3-flash"),
} as const;

// ============================================================================
// HELPER: Extract tool output
// ============================================================================

/**
 * Represents a tool result item from AI SDK step results
 */
interface ToolResultItem {
  output?: unknown;
  result?: unknown;
}

function extractToolOutput(toolResults: ToolResultItem[] | undefined): string {
  if (!toolResults || toolResults.length === 0) return "";

  return toolResults
    .map((tr) => {
      const output = tr.output ?? tr.result;
      return typeof output === "string" ? output : JSON.stringify(output);
    })
    .join("\n\n");
}

// ============================================================================
// PARALLEL SEARCH WORKFLOW
// ============================================================================

/**
 * Execute parallel searches across multiple sources
 * Uses Promise.all for concurrent execution
 */
async function parallelSearch(
  query: string,
  ctx: WorkflowContext,
): Promise<SearchResult[]> {
  const toolContext = { userId: ctx.userId, workspaceId: ctx.workspaceId };
  const webTools = createWebTools(toolContext);
  const ragTools = createRagTools(toolContext);
  const workspaceTools = createWorkspaceTools(toolContext);

  console.log(`🔍 [Workflow] Starting parallel search for: "${query}"`);

  // Define search tasks
  const searchTasks: Promise<SearchResult | null>[] = [];

  // 1. Web search - direct tool execution
  searchTasks.push(
    (async () => {
      try {
        const result = await webTools.searchWeb.execute!(
          { query, searchContextSize: "medium" },
          { toolCallId: "web-search", messages: [] },
        );

        if (result && "answer" in result && result.answer) {
          const sources = result.sources as
            | Array<{ title: string; url: string; content?: string }>
            | undefined;
          const content =
            result.answer +
            "\n\nSources:\n" +
            (sources || []).map((s) => `- ${s.title}: ${s.url}`).join("\n");

          return {
            source: "web" as const,
            query,
            content,
            relevance: 0.8,
          };
        }
        return null;
      } catch (e) {
        console.error("Web search failed:", e);
        return null;
      }
    })(),
  );

  // 2. Wikipedia search - direct tool execution
  searchTasks.push(
    (async () => {
      try {
        // First search
        const searchResult = await webTools.searchWikipedia.execute!(
          { query, limit: 3 },
          { toolCallId: "wiki-search", messages: [] },
        );

        if (
          searchResult &&
          "articles" in searchResult &&
          searchResult.articles?.length > 0
        ) {
          // Get first article
          const articleTitle = searchResult.articles[0].title;
          const articleResult = await webTools.getWikipediaArticle.execute!(
            { title: articleTitle },
            { toolCallId: "wiki-article", messages: [] },
          );

          if (articleResult && "content" in articleResult) {
            return {
              source: "wikipedia" as const,
              query,
              content: String(articleResult.content || ""),
              relevance: 0.9,
            };
          }
        }
        return null;
      } catch (e) {
        console.error("Wikipedia search failed:", e);
        return null;
      }
    })(),
  );

  // 3. RAG search (if sources provided)
  if (ctx.ragSources && ctx.ragSources.length > 0) {
    searchTasks.push(
      (async () => {
        try {
          const result = await ragTools.searchRagChunks.execute!(
            { query, limit: 10, threshold: 0.5 },
            { toolCallId: "rag-search", messages: [] },
          );

          if (result && "chunks" in result && result.chunks?.length > 0) {
            const chunks = result.chunks as Array<{
              content: string;
              source?: { id: string; title: string; type: string };
              similarity: number;
              section?: string;
              page?: number;
            }>;
            const content = chunks
              .map((c) => `[${c.source?.title || "Source"}]\n${c.content}`)
              .join("\n\n---\n\n");

            return {
              source: "rag" as const,
              query,
              content,
              relevance: 1.0, // User's own sources are most relevant
            };
          }
          return null;
        } catch (e) {
          console.error("RAG search failed:", e);
          return null;
        }
      })(),
    );
  }

  // 4. Workspace pages search
  searchTasks.push(
    (async () => {
      try {
        // List pages with search
        const listResult = await workspaceTools.listWorkspacePages.execute!(
          { search: query, limit: 5, includeArchived: false },
          { toolCallId: "workspace-list", messages: [] },
        );

        if (
          listResult &&
          "pages" in listResult &&
          listResult.pages?.length > 0
        ) {
          // Read first 2 relevant pages
          const pageContents: string[] = [];
          for (const page of listResult.pages.slice(0, 2)) {
            try {
              const pageContent = await workspaceTools.readWorkspacePage
                .execute!(
                { pageId: page.id },
                { toolCallId: `workspace-read-${page.id}`, messages: [] },
              );
              if (pageContent && "content" in pageContent) {
                pageContents.push(
                  `## ${page.title}\n${pageContent.content || ""}`,
                );
              }
            } catch {
              // Skip failed page reads
            }
          }

          if (pageContents.length > 0) {
            return {
              source: "workspace" as const,
              query,
              content: pageContents.join("\n\n---\n\n"),
              relevance: 0.95,
            };
          }
        }
        return null;
      } catch (e) {
        console.error("Workspace search failed:", e);
        return null;
      }
    })(),
  );

  // Execute all searches in parallel
  const results = await Promise.all(searchTasks);

  // Filter out null results and sort by relevance
  const validResults = results
    .filter((r): r is SearchResult => r !== null)
    .sort((a, b) => b.relevance - a.relevance);

  console.log(
    `✅ [Workflow] Parallel search complete: ${validResults.length} results from ${validResults.map((r) => r.source).join(", ")}`,
  );

  return validResults;
}

// ============================================================================
// RESEARCH SYNTHESIS
// ============================================================================

/**
 * Synthesize multiple search results into a coherent research summary
 */
async function synthesizeResearch(
  query: string,
  searchResults: SearchResult[],
): Promise<ResearchResults> {
  console.log(
    `📝 [Workflow] Synthesizing ${searchResults.length} search results`,
  );

  const sourcesContext = searchResults
    .map(
      (r, i) =>
        `<source_${i + 1} type="${r.source}" relevance="${r.relevance}">\n${r.content.slice(0, 4000)}\n</source_${i + 1}>`,
    )
    .join("\n\n");

  const result = await generateText({
    model: MODELS.thinking,
    maxOutputTokens: 4096,
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "medium" } },
    },
    system: `You are a research synthesis expert. Analyze multiple sources and create a comprehensive, well-organized summary.

Guidelines:
- Combine information from all sources coherently
- Identify key themes and insights
- Note any conflicting information
- Cite sources appropriately
- Structure the synthesis with clear sections
- Respond in the user's language (French by default)`,
    prompt: `Research query: "${query}"

Sources to synthesize:
${sourcesContext}

Create a comprehensive research synthesis that combines all relevant information from these sources.`,
  });

  const sources = searchResults.map(
    (r) => `[${r.source.toUpperCase()}] ${r.query}`,
  );

  return {
    searches: searchResults,
    summary: result.text,
    sources,
  };
}

// ============================================================================
// EVALUATION LOOP
// ============================================================================

/**
 * Evaluate content quality and provide feedback
 */
async function evaluateContent(
  content: string,
  criteria: {
    minLength: number;
    requiredSections?: string[];
    targetAudience?: string;
  },
): Promise<EvaluationResult> {
  console.log(`🔍 [Workflow] Evaluating content quality`);

  const result = await generateText({
    model: MODELS.fast,
    maxOutputTokens: 1024,
    system: `You are a content quality evaluator. Assess content against specific criteria and provide structured feedback.

Return your evaluation in this exact JSON format:
{
  "score": <number 0-100>,
  "feedback": "<overall assessment>",
  "passesThreshold": <boolean>,
  "suggestions": ["<suggestion1>", "<suggestion2>", ...]
}`,
    prompt: `Evaluate this content:

<content>
${content.slice(0, 8000)}
</content>

Criteria:
- Minimum length: ${criteria.minLength} words (current: ~${content.split(/\s+/).length} words)
- Required sections: ${criteria.requiredSections?.join(", ") || "None specified"}
- Target audience: ${criteria.targetAudience || "General"}
- Must be well-structured with headings
- Must be comprehensive and informative
- Must use proper formatting (bold, lists, links)

Score threshold to pass: 70/100`,
  });

  try {
    // Extract JSON from response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: parsed.score || 0,
        feedback: parsed.feedback || "No feedback",
        passesThreshold: parsed.passesThreshold ?? parsed.score >= 70,
        suggestions: parsed.suggestions || [],
      };
    }
  } catch (e) {
    console.error("Failed to parse evaluation:", e);
  }

  // Fallback
  return {
    score: 50,
    feedback: "Could not evaluate content properly",
    passesThreshold: false,
    suggestions: ["Please regenerate content"],
  };
}

/**
 * Improve content based on evaluation feedback
 */
async function improveContent(
  draft: ContentDraft,
  evaluation: EvaluationResult,
): Promise<ContentDraft> {
  console.log(
    `🔧 [Workflow] Improving content (iteration ${draft.iteration + 1})`,
  );

  const result = await generateText({
    model: MODELS.thinking,
    maxOutputTokens: 8192,
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "high" } },
    },
    system: `You are a content improvement specialist. Your task is to enhance content based on specific feedback.

Guidelines:
- Address ALL suggestions provided
- Maintain the original intent and structure
- Add more detail where needed
- Improve formatting and readability
- Keep the same language as the original`,
    prompt: `Current content to improve:

<content>
${draft.content}
</content>

Evaluation feedback (score: ${evaluation.score}/100):
${evaluation.feedback}

Specific improvements needed:
${evaluation.suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Please rewrite the content addressing all feedback points. Make it more comprehensive and detailed.`,
  });

  return {
    title: draft.title,
    content: result.text,
    iteration: draft.iteration + 1,
  };
}

// ============================================================================
// MAIN WORKFLOW FUNCTIONS
// ============================================================================

/**
 * Deep Research Workflow for "search" mode
 *
 * 1. Parallel search across all sources
 * 2. Synthesize results
 * 3. Planning
 * 4. Content generation
 * 5. Evaluation loop
 * 6. Page creation (ONLY if requested)
 */
export async function runDeepResearchWorkflow(
  query: string,
  ctx: WorkflowContext,
  options?: { createPage?: boolean },
): Promise<{
  searches: SearchResult[];
  summary: string;
  sources: string[];
  content: string;
  title: string;
  iterations: number;
  pageId?: string | null;
}> {
  console.log(`🚀 [Workflow] Starting Deep Research Workflow`);
  console.log(`📋 Query: "${query}"`);
  console.log(`📄 Create page: ${options?.createPage ? "YES" : "NO"}`);

  // Step 1: Parallel search
  const searchResults = await parallelSearch(query, ctx);

  if (searchResults.length === 0) {
    return {
      searches: [],
      summary: "No results found from any source.",
      sources: [],
      content: "",
      title: query,
      iterations: 0,
    };
  }

  // Step 2: Synthesize research
  const research = await synthesizeResearch(query, searchResults);

  // Step 3: Content planning
  console.log(`📋 [Workflow] Phase 3: Planning`);
  const planResult = await generateText({
    model: MODELS.fast,
    maxOutputTokens: 1024,
    system: `You are a content planner. Create a detailed outline for comprehensive research content.`,
    prompt: `Based on this research, create a detailed content outline for: "${query}"

Research summary:
${research.summary.slice(0, 3000)}

Create an outline with:
1. A compelling title
2. Main sections (5-8 sections)
3. Key points for each section
4. Important findings to highlight

Format as a structured outline.`,
  });

  // Extract title
  const titleMatch = planResult.text.match(
    /(?:title|titre)[:\s]*["']?([^"\n]+)["']?/i,
  );
  const title = titleMatch?.[1]?.trim() || query.slice(0, 100);

  // Step 4: Content generation
  console.log(`✍️ [Workflow] Phase 4: Content Generation`);
  const initialContent = await generateText({
    model: MODELS.thinking,
    maxOutputTokens: 32000,
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "high" } },
    },
    system: `You are a comprehensive research writer. Create detailed, well-structured content based on research findings.

Guidelines:
- Create COMPREHENSIVE and DETAILED content (2000-5000+ words)
- Use multiple heading levels (##, ###, ####) for clear hierarchy
- Include detailed explanations with examples
- Structure: thorough introduction, multiple detailed sections, comprehensive conclusion
- Include definitions, context, and background information
- Add comparisons or different perspectives when relevant
- Use tables or lists to organize complex information
- Include a summary or key takeaways section
- Cite sources throughout the content
- Respond in the user's language (French by default)`,
    prompt: `Create comprehensive, detailed research content based on this outline and research.

Research query: "${query}"

Content outline:
${planResult.text}

Research to incorporate:
${research.summary}

Sources to cite:
${research.sources.join("\n")}

Create a complete, detailed document covering all aspects of the research.`,
  });

  let draft: ContentDraft = {
    title,
    content: initialContent.text,
    iteration: 1,
  };

  // Step 5: Evaluation loop (max 3 iterations)
  console.log(`🔄 [Workflow] Phase 5: Evaluation Loop`);
  const maxIterations = 3;
  const minLength = 2000;

  for (let i = 0; i < maxIterations; i++) {
    const evaluation = await evaluateContent(draft.content, {
      minLength,
      requiredSections: ["Introduction", "Conclusion"],
      targetAudience: ctx.personalization?.classe || "General",
    });

    console.log(
      `📊 [Workflow] Evaluation ${i + 1}: Score ${evaluation.score}/100`,
    );

    if (evaluation.passesThreshold) {
      console.log(`✅ [Workflow] Content passed evaluation`);
      break;
    }

    if (i < maxIterations - 1) {
      draft = await improveContent(draft, evaluation);
    }
  }

  // Step 6: Page creation (ONLY if explicitly requested)
  let pageId: string | null = null;

  if (options?.createPage) {
    console.log(`📄 [Workflow] Phase 6: Creating Page (user requested)`);
    const toolContext = { userId: ctx.userId, workspaceId: ctx.workspaceId };
    const pageTools = createPageTools(toolContext);

    try {
      const pageResult = await pageTools.createPage.execute!(
        {
          title: draft.title,
          content: draft.content,
          projectId: undefined,
          icon: "🔍",
        },
        { toolCallId: "create-page-search", messages: [] },
      );

      if (
        pageResult &&
        "success" in pageResult &&
        pageResult.success &&
        pageResult.pageId
      ) {
        pageId = pageResult.pageId;
        console.log(`✅ [Workflow] Page created: ${pageId}`);
      }
    } catch (e) {
      console.error("Failed to create page:", e);
    }
  }

  console.log(`✅ [Workflow] Deep Research complete`);

  return {
    searches: searchResults,
    summary: research.summary,
    sources: research.sources,
    content: draft.content,
    title: draft.title,
    iterations: draft.iteration,
    pageId,
  };
}

/**
 * Deep Content Creation Workflow for "create-deep" mode
 *
 * 1. Research phase (parallel searches)
 * 2. Content planning
 * 3. Content generation
 * 4. Evaluation loop (max 3 iterations)
 * 5. Final page creation
 */
export async function runDeepContentWorkflow(
  request: AgentRequest,
  userPrompt: string,
): Promise<{
  pageId: string | null;
  title: string;
  content: string;
  research: ResearchResults;
  iterations: number;
}> {
  const ctx: WorkflowContext = {
    userId: request.userId,
    workspaceId: request.workspaceId,
    ragSources: request.ragSources as RagSource[],
    personalization: request.personalization as UserPersonalization,
  };

  console.log(`🚀 [Workflow] Starting Deep Content Creation Workflow`);

  // Step 1: Research phase
  console.log(`📚 [Workflow] Phase 1: Research`);
  const research = await runDeepResearchWorkflow(userPrompt, ctx);

  // Step 2: Content planning
  console.log(`📋 [Workflow] Phase 2: Planning`);
  const planResult = await generateText({
    model: MODELS.fast,
    maxOutputTokens: 1024,
    system: `You are a content planner. Create a detailed outline for educational content.`,
    prompt: `Based on this research, create a detailed content outline for: "${userPrompt}"

Research summary:
${research.summary.slice(0, 3000)}

Create an outline with:
1. A compelling title
2. Main sections (5-8 sections)
3. Key points for each section
4. Suggested examples or illustrations

Format as a structured outline.`,
  });

  // Extract title from plan
  const titleMatch = planResult.text.match(
    /(?:title|titre)[:\s]*["']?([^"\n]+)["']?/i,
  );
  const title = titleMatch?.[1]?.trim() || userPrompt.slice(0, 100);

  // Step 3: Initial content generation
  console.log(`✍️ [Workflow] Phase 3: Content Generation`);
  const initialContent = await generateText({
    model: MODELS.thinking,
    maxOutputTokens: 32000,
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "high" } },
    },
    system: buildSystemPrompt("create-deep", {
      workspaceId: ctx.workspaceId,
      ragSources: ctx.ragSources,
      personalization: ctx.personalization,
    }),
    prompt: `Create comprehensive, detailed content based on this outline and research.

User request: "${userPrompt}"

Content outline:
${planResult.text}

Research to incorporate:
${research.summary}

Sources to cite:
${research.sources.join("\n")}

IMPORTANT:
- Create LONG, DETAILED content (2000-5000+ words)
- Use multiple heading levels (##, ###, ####)
- Include examples and explanations
- Use bold, lists, and proper formatting
- Cite sources with links where possible
- Make it educational and comprehensive`,
  });

  let draft: ContentDraft = {
    title,
    content: initialContent.text,
    iteration: 1,
  };

  // Step 4: Evaluation loop (max 3 iterations)
  console.log(`🔄 [Workflow] Phase 4: Evaluation Loop`);
  const maxIterations = 3;
  const minLength = 2000;

  for (let i = 0; i < maxIterations; i++) {
    const evaluation = await evaluateContent(draft.content, {
      minLength,
      requiredSections: ["Introduction", "Conclusion"],
      targetAudience: ctx.personalization?.classe || "General",
    });

    console.log(
      `📊 [Workflow] Evaluation ${i + 1}: Score ${evaluation.score}/100`,
    );

    if (evaluation.passesThreshold) {
      console.log(`✅ [Workflow] Content passed evaluation`);
      break;
    }

    if (i < maxIterations - 1) {
      draft = await improveContent(draft, evaluation);
    }
  }

  // Step 5: Create page
  console.log(`📄 [Workflow] Phase 5: Creating Page`);
  const toolContext = { userId: ctx.userId, workspaceId: ctx.workspaceId };
  const pageTools = createPageTools(toolContext);

  let pageId: string | null = null;

  try {
    const pageResult = await pageTools.createPage.execute!(
      {
        title: draft.title,
        content: draft.content,
        projectId: undefined,
        icon: "📚",
      },
      { toolCallId: "create-page", messages: [] },
    );

    if (
      pageResult &&
      "success" in pageResult &&
      pageResult.success &&
      pageResult.pageId
    ) {
      pageId = pageResult.pageId;
      console.log(`✅ [Workflow] Page created: ${pageId}`);
    }
  } catch (e) {
    console.error("Failed to create page:", e);
  }

  return {
    pageId,
    title: draft.title,
    content: draft.content,
    research,
    iterations: draft.iteration,
  };
}

/**
 * Quick Content Creation Workflow for "create-quick" mode
 *
 * Simplified workflow without evaluation loop
 */
export async function runQuickContentWorkflow(
  request: AgentRequest,
  userPrompt: string,
): Promise<{
  pageId: string | null;
  title: string;
  content: string;
}> {
  const ctx: WorkflowContext = {
    userId: request.userId,
    workspaceId: request.workspaceId,
    ragSources: request.ragSources as RagSource[],
    personalization: request.personalization as UserPersonalization,
  };

  console.log(`🚀 [Workflow] Starting Quick Content Creation Workflow`);

  // Quick research (only if sources provided)
  let researchContext = "";
  if (ctx.ragSources && ctx.ragSources.length > 0) {
    const toolContext = { userId: ctx.userId, workspaceId: ctx.workspaceId };
    const ragTools = createRagTools(toolContext);

    try {
      const result = await ragTools.searchRagChunks.execute!(
        { query: userPrompt, limit: 5, threshold: 0.5 },
        { toolCallId: "quick-rag", messages: [] },
      );

      if (result && "chunks" in result && result.chunks?.length > 0) {
        const chunks = result.chunks as Array<{
          content: string;
          source?: { id: string; title: string; type: string };
          similarity: number;
          section?: string;
          page?: number;
        }>;
        researchContext = chunks.map((c) => c.content).join("\n\n");
      }
    } catch (e) {
      console.error("Quick research failed:", e);
    }
  }

  // Generate content
  const contentResult = await generateText({
    model: MODELS.thinking,
    maxOutputTokens: 8192,
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: "low" } },
    },
    system: buildSystemPrompt("create-quick", {
      workspaceId: ctx.workspaceId,
      ragSources: ctx.ragSources,
      personalization: ctx.personalization,
    }),
    prompt: `Create concise content for: "${userPrompt}"

${researchContext ? `Reference material:\n${researchContext}\n\n` : ""}

IMPORTANT:
- Keep it CONCISE (500-1500 words)
- Focus on essential information
- Use short paragraphs and bullet points
- One level of headings is sufficient`,
  });

  // Extract title
  const titleMatch = contentResult.text.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || userPrompt.slice(0, 100);

  // Create page
  const toolContext = { userId: ctx.userId, workspaceId: ctx.workspaceId };
  const pageTools = createPageTools(toolContext);

  let pageId: string | null = null;

  try {
    const pageResult = await pageTools.createPage.execute!(
      {
        title,
        content: contentResult.text,
        projectId: undefined,
        icon: "📝",
      },
      { toolCallId: "create-page-quick", messages: [] },
    );

    if (
      pageResult &&
      "success" in pageResult &&
      pageResult.success &&
      pageResult.pageId
    ) {
      pageId = pageResult.pageId;
    }
  } catch (e) {
    console.error("Failed to create page:", e);
  }

  return {
    pageId,
    title,
    content: contentResult.text,
  };
}
