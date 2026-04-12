// 📄 Structure Tools - Workspace hierarchy navigation for agent
import { tool } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../utils/logger.js";

interface StructureToolsContext {
  userId: string;
  workspaceId: string;
}

const getWorkspaceStructureSchema = z.object({
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe("Focus on a specific project. Omit to see entire workspace structure."),
});

interface PageNode {
  id: string;
  title: string;
  icon: string | null;
  projectId: string | null;
  parentId: string | null;
  children: PageNode[];
}

const MAX_DEPTH = 10;

// Format page tree recursively (with cycle + depth protection)
function formatPages(nodes: PageNode[], indent: number, visited: Set<string>): string[] {
  if (indent > MAX_DEPTH) return [`${"  ".repeat(indent)}└─ ... (deeper levels omitted)`];
  const lines: string[] = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    const prefix = "  ".repeat(indent);
    const icon = node.icon ? `${node.icon} ` : "";
    const safeTitle = (node.title || "Untitled")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .slice(0, 100);
    lines.push(`${prefix}├─ ${icon}${safeTitle} [pageId: ${node.id}]`);
    if (node.children.length > 0) {
      lines.push(...formatPages(node.children, indent + 1, visited));
    }
  }
  return lines;
}

// Format project tree recursively (with cycle + depth protection)
function formatProject(
  projId: string,
  indent: number,
  projectMap: Map<
    string,
    { id: string; name: string; parentId: string | null; position: number; children: string[] }
  >,
  projectPages: Map<string, PageNode[]>,
  visited: Set<string>,
): string[] {
  if (indent > MAX_DEPTH || visited.has(projId)) return [];
  visited.add(projId);
  const proj = projectMap.get(projId);
  if (!proj) return [];
  const lines: string[] = [];
  const prefix = "  ".repeat(indent);
  const pagesInProject = projectPages.get(projId) || [];
  const safeName = proj.name.replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 100);
  lines.push(`${prefix}📁 ${safeName} [projectId: ${proj.id}] (${pagesInProject.length} pages)`);
  lines.push(...formatPages(pagesInProject, indent + 1, visited));
  for (const childId of proj.children) {
    lines.push(...formatProject(childId, indent + 1, projectMap, projectPages, visited));
  }
  return lines;
}

/**
 * Creates structure/hierarchy tools with user context
 */
export function createStructureTools(ctx: StructureToolsContext) {
  return {
    getWorkspaceStructure: tool({
      description: `Returns the full workspace tree: projects (folders) and their pages, including nested sub-pages. Call this BEFORE createPage to find valid projectId and parentId values. Shows hierarchy with indentation. Optionally focus on a single project.`,
      inputSchema: getWorkspaceStructureSchema,
      execute: async ({ projectId }) => {
        logger.log(
          `🔍 [TOOL:getWorkspaceStructure] workspaceId=${ctx.workspaceId}, projectId=${projectId || "all"}`,
        );

        try {
          const projectWhere: Prisma.ProjectWhereInput = {
            workspaceId: ctx.workspaceId,
            isArchived: false,
          };
          if (projectId) {
            projectWhere.id = projectId;
          }

          const projects = await prisma.project.findMany({
            where: projectWhere,
            select: {
              id: true,
              name: true,
              parentId: true,
              position: true,
            },
            orderBy: { position: "asc" },
            take: 50,
          });

          const pageWhere: Prisma.PageWhereInput = {
            workspaceId: ctx.workspaceId,
            isArchived: false,
          };
          if (projectId) {
            pageWhere.projectId = projectId;
          }

          const pages = await prisma.page.findMany({
            where: pageWhere,
            select: {
              id: true,
              title: true,
              icon: true,
              projectId: true,
              parentId: true,
              position: true,
            },
            orderBy: { position: "asc" },
            take: 200,
          });

          // Build project tree
          const projectMap = new Map(
            projects.map((p) => [p.id, { ...p, children: [] as string[] }]),
          );
          const rootProjects: string[] = [];
          for (const p of projects) {
            if (p.parentId && projectMap.has(p.parentId)) {
              projectMap.get(p.parentId)!.children.push(p.id);
            } else {
              rootProjects.push(p.id);
            }
          }

          // Build page tree
          const pageMap = new Map<string, PageNode>(
            pages.map((p) => [p.id, { ...p, children: [] }]),
          );
          const rootPages: PageNode[] = [];
          const projectPages = new Map<string, PageNode[]>();

          for (const p of pages) {
            if (p.parentId && pageMap.has(p.parentId)) {
              pageMap.get(p.parentId)!.children.push(pageMap.get(p.id)!);
            } else if (p.projectId) {
              if (!projectPages.has(p.projectId)) projectPages.set(p.projectId, []);
              projectPages.get(p.projectId)!.push(pageMap.get(p.id)!);
            } else {
              rootPages.push(pageMap.get(p.id)!);
            }
          }

          const visited = new Set<string>();
          const tree: string[] = [];
          tree.push("📂 Workspace");

          if (rootProjects.length > 0) {
            for (const projId of rootProjects) {
              tree.push(...formatProject(projId, 1, projectMap, projectPages, visited));
            }
          }

          if (!projectId && rootPages.length > 0) {
            tree.push("  📄 Root pages (no project):");
            tree.push(...formatPages(rootPages, 2, visited));
          }

          const treeText = tree.join("\n");

          logger.log(
            `✅ [TOOL:getWorkspaceStructure] ${projects.length} projects, ${pages.length} pages`,
          );

          return {
            structure: treeText,
            summary: {
              projectCount: projects.length,
              pageCount: pages.length,
              rootPageCount: rootPages.length,
            },
          };
        } catch (error) {
          logger.error(`❌ [TOOL:getWorkspaceStructure] Error:`, error);
          return {
            error: "Failed to retrieve workspace structure. Try again.",
            structure: null,
          };
        }
      },
    }),
  };
}
