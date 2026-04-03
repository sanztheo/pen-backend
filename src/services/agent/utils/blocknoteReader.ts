// pen-backend/src/services/agent/utils/blocknoteReader.ts

// -- Types --------------------------------------------------------------------

interface BlockNoteContentItem {
  type?: string;
  text?: string;
  styles?: Record<string, unknown>;
  props?: { latex?: string };
}

interface BlockNoteTableRow {
  cells?: BlockNoteContentItem[][];
}

interface BlockNoteTableContent {
  rows?: BlockNoteTableRow[];
}

export interface BlockNoteBlock {
  id?: string;
  type?: string;
  content?: BlockNoteContentItem[] | BlockNoteTableContent;
  props?: {
    level?: number;
    checked?: boolean;
    language?: string;
    caption?: string;
    latex?: string;
    [key: string]: unknown;
  };
  children?: BlockNoteBlock[];
}

export interface PageSection {
  heading: string;
  level: number;
  startBlock: number;
  endBlock: number;
  tokens: number;
}

export interface PageOutline {
  totalBlocks: number;
  totalTokens: number;
  sections: PageSection[];
}

export interface SearchMatch {
  blockIndex: number;
  blockType: string;
  matchSnippet: string;
}

// -- Constants ----------------------------------------------------------------

export const SOFT_TOKEN_CAP = 32_000;
export const HARD_TOKEN_CAP = 100_000;
const FALLBACK_CHUNK_SIZE = 50;
const MAX_BLOCKS = 10_000;

// -- Helpers ------------------------------------------------------------------

function inlineContentToMarkdown(content: BlockNoteContentItem[]): string {
  return content
    .map((item) => {
      if (item.type === "inlineLatex" && item.props?.latex) {
        return item.props.latex;
      }
      if (!item.text) return "";
      let text = item.text;
      if (item.styles?.bold) text = `**${text}**`;
      if (item.styles?.italic) text = `*${text}*`;
      if (item.styles?.underline) text = `__${text}__`;
      if (item.styles?.strikethrough) text = `~~${text}~~`;
      return text;
    })
    .join("");
}

function blockToMarkdown(block: BlockNoteBlock, index: number, annotate: boolean): string {
  const prefix = annotate ? `[block:${index}] ` : "";

  switch (block.type) {
    case "heading": {
      const items = Array.isArray(block.content) ? (block.content as BlockNoteContentItem[]) : [];
      const level = block.props?.level || 2;
      return `${prefix}${"#".repeat(level)} ${inlineContentToMarkdown(items)}`;
    }
    case "paragraph": {
      const items = Array.isArray(block.content) ? (block.content as BlockNoteContentItem[]) : [];
      const text = inlineContentToMarkdown(items);
      return text ? `${prefix}${text}` : "";
    }
    case "bulletListItem": {
      const items = Array.isArray(block.content) ? (block.content as BlockNoteContentItem[]) : [];
      return `${prefix}- ${inlineContentToMarkdown(items)}`;
    }
    case "numberedListItem": {
      const items = Array.isArray(block.content) ? (block.content as BlockNoteContentItem[]) : [];
      return `${prefix}1. ${inlineContentToMarkdown(items)}`;
    }
    case "checkListItem": {
      const items = Array.isArray(block.content) ? (block.content as BlockNoteContentItem[]) : [];
      const mark = block.props?.checked ? "[x]" : "[ ]";
      return `${prefix}${mark} ${inlineContentToMarkdown(items)}`;
    }
    case "codeBlock": {
      const items = Array.isArray(block.content) ? (block.content as BlockNoteContentItem[]) : [];
      const code = items.map((i) => i.text || "").join("");
      const lang = block.props?.language || "";
      return `${prefix}\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case "latex": {
      return `${prefix}${block.props?.latex || ""}`;
    }
    case "table": {
      const tc = block.content as BlockNoteTableContent | undefined;
      if (!tc?.rows) return "";
      const rows = tc.rows.map((row) => {
        if (!row.cells) return "";
        const cells = row.cells.map((cell) =>
          Array.isArray(cell) ? cell.map((i) => i.text || "").join("") : "",
        );
        return `| ${cells.join(" | ")} |`;
      });
      return `${prefix}${rows.join("\n")}`;
    }
    case "image": {
      return `${prefix}[Image: ${block.props?.caption || "image"}]`;
    }
    default:
      return "";
  }
}

// -- Public API ---------------------------------------------------------------

export function blocknoteToMarkdown(
  blocks: BlockNoteBlock[],
  options?: { annotate?: boolean },
): string {
  const annotate = options?.annotate ?? true;
  const lines: string[] = [];

  blocks.forEach((block, index) => {
    const md = blockToMarkdown(block, index, annotate);
    if (md) lines.push(md);

    if (block.children?.length) {
      for (const child of block.children) {
        const childMd = blockToMarkdown(child, index, false);
        if (childMd) lines.push("  " + childMd);
      }
    }
  });

  return lines.join("\n\n");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function parseBlockNoteSections(blocks: BlockNoteBlock[]): PageOutline {
  if (blocks.length > MAX_BLOCKS) {
    return {
      totalBlocks: blocks.length,
      totalTokens: -1,
      sections: [
        {
          heading: "(Page too large to analyze)",
          level: 0,
          startBlock: 0,
          endBlock: blocks.length - 1,
          tokens: -1,
        },
      ],
    };
  }

  const sections: PageSection[] = [];
  const hasHeadings = blocks.some((b) => b.type === "heading");

  if (hasHeadings) {
    let current: PageSection | null = null;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (block.type === "heading") {
        if (current) {
          current.endBlock = i - 1;
          const md = blocknoteToMarkdown(blocks.slice(current.startBlock, i), { annotate: false });
          current.tokens = estimateTokens(md);
          sections.push(current);
        }

        const items = Array.isArray(block.content) ? (block.content as BlockNoteContentItem[]) : [];
        const headingText = items.map((item) => item.text || "").join("");

        current = {
          heading: headingText || "Untitled Section",
          level: block.props?.level || 2,
          startBlock: i,
          endBlock: i,
          tokens: 0,
        };
      }
    }

    if (current) {
      current.endBlock = blocks.length - 1;
      const md = blocknoteToMarkdown(blocks.slice(current.startBlock), { annotate: false });
      current.tokens = estimateTokens(md);
      sections.push(current);
    }

    if (sections.length > 0 && sections[0].startBlock > 0) {
      const pre = blocks.slice(0, sections[0].startBlock);
      const preMd = blocknoteToMarkdown(pre, { annotate: false });
      const preTokens = estimateTokens(preMd);
      if (preTokens > 0) {
        sections.unshift({
          heading: "(Introduction)",
          level: 0,
          startBlock: 0,
          endBlock: sections[0].startBlock - 1,
          tokens: preTokens,
        });
      }
    }
  } else {
    for (let i = 0; i < blocks.length; i += FALLBACK_CHUNK_SIZE) {
      const end = Math.min(i + FALLBACK_CHUNK_SIZE - 1, blocks.length - 1);
      const chunkMd = blocknoteToMarkdown(blocks.slice(i, end + 1), { annotate: false });
      sections.push({
        heading: `Blocks ${i}\u2013${end}`,
        level: 0,
        startBlock: i,
        endBlock: end,
        tokens: estimateTokens(chunkMd),
      });
    }
  }

  const totalTokens = sections.reduce((sum, s) => sum + s.tokens, 0);

  return {
    totalBlocks: blocks.length,
    totalTokens,
    sections,
  };
}

export function searchInBlocks(blocks: BlockNoteBlock[], query: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  blocks.forEach((block, index) => {
    const md = blockToMarkdown(block, index, false);
    if (!md) return;

    const lowerMd = md.toLowerCase();
    const pos = lowerMd.indexOf(lowerQuery);
    if (pos === -1) return;

    const start = Math.max(0, pos - 30);
    const end = Math.min(md.length, pos + query.length + 30);
    const snippet =
      (start > 0 ? "..." : "") + md.slice(start, end) + (end < md.length ? "..." : "");

    matches.push({
      blockIndex: index,
      blockType: block.type || "unknown",
      matchSnippet: snippet,
    });
  });

  return matches;
}
