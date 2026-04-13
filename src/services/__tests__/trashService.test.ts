/**
 * trashService tests — integration against the dev DB
 * Run with: infisical run --env=dev --path=/Backend -- npm test -- trashService.test.ts
 *
 * These tests create a disposable User + Workspace fixture, run against real
 * Postgres (no mocks — the archive logic relies on a recursive CTE that must
 * be exercised end-to-end), and clean everything up in afterAll().
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from "@jest/globals";
import { archiveCascade } from "../trashService.js";
import { prisma } from "../../lib/prisma.js";

const TEST_USER_ID = `test-trash-${Date.now()}`;
const TEST_EMAIL = `trash-${Date.now()}@test.pennote.dev`;
let workspaceId: string;

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      firstName: "Trash",
      lastName: "Test",
    },
  });
  const ws = await prisma.workspace.create({
    data: {
      name: `trash-test-${Date.now()}`,
      ownerId: TEST_USER_ID,
    },
  });
  workspaceId = ws.id;
});

afterEach(async () => {
  // Hard-delete all pages in the test workspace between tests.
  // parent_id FK is onDelete: Cascade so this is safe for hierarchies.
  await prisma.page.deleteMany({ where: { workspaceId } });
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
  await prisma.$disconnect();
});

describe("archiveCascade", () => {
  it("marks root as archived with archivedRootId=null and descendants with archivedRootId=root.id", async () => {
    const root = await prisma.page.create({
      data: { workspaceId, title: "Root", position: 0, createdBy: TEST_USER_ID },
    });
    const child = await prisma.page.create({
      data: {
        workspaceId,
        title: "Child",
        parentId: root.id,
        position: 0,
        createdBy: TEST_USER_ID,
      },
    });
    const grandchild = await prisma.page.create({
      data: {
        workspaceId,
        title: "Grand",
        parentId: child.id,
        position: 0,
        createdBy: TEST_USER_ID,
      },
    });

    const result = await archiveCascade({ pageId: root.id, workspaceId });
    expect(result.archivedCount).toBe(3);

    const [r, c, g] = await Promise.all([
      prisma.page.findUnique({ where: { id: root.id } }),
      prisma.page.findUnique({ where: { id: child.id } }),
      prisma.page.findUnique({ where: { id: grandchild.id } }),
    ]);
    expect(r?.isArchived).toBe(true);
    expect(r?.archivedRootId).toBeNull();
    expect(r?.archivedAt).toBeInstanceOf(Date);
    expect(r!.archivedAt!.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(r!.archivedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(r?.archivedPosition).toBe(0);
    expect(c?.isArchived).toBe(true);
    expect(c?.archivedRootId).toBe(root.id);
    expect(g?.isArchived).toBe(true);
    expect(g?.archivedRootId).toBe(root.id);
  });

  it("decrements positions of siblings located after the archived page", async () => {
    const a = await prisma.page.create({
      data: { workspaceId, title: "A", position: 0, createdBy: TEST_USER_ID },
    });
    const b = await prisma.page.create({
      data: { workspaceId, title: "B", position: 1, createdBy: TEST_USER_ID },
    });
    const c = await prisma.page.create({
      data: { workspaceId, title: "C", position: 2, createdBy: TEST_USER_ID },
    });

    await archiveCascade({ pageId: b.id, workspaceId });

    const [aAfter, bAfter, cAfter] = await Promise.all([
      prisma.page.findUnique({ where: { id: a.id } }),
      prisma.page.findUnique({ where: { id: b.id } }),
      prisma.page.findUnique({ where: { id: c.id } }),
    ]);
    expect(aAfter?.position).toBe(0);
    expect(aAfter?.isArchived).toBe(false);
    expect(bAfter?.isArchived).toBe(true);
    expect(bAfter?.archivedPosition).toBe(1);
    expect(cAfter?.position).toBe(1); // shifted down from 2 to 1
    expect(cAfter?.isArchived).toBe(false);
  });

  it("throws PAGE_NOT_FOUND_OR_ALREADY_ARCHIVED when page does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    await expect(archiveCascade({ pageId: fakeId, workspaceId })).rejects.toThrow(
      "PAGE_NOT_FOUND_OR_ALREADY_ARCHIVED",
    );
  });

  it("throws PAGE_NOT_FOUND_OR_ALREADY_ARCHIVED when page is already archived", async () => {
    const p = await prisma.page.create({
      data: { workspaceId, title: "P", position: 0, createdBy: TEST_USER_ID },
    });
    await archiveCascade({ pageId: p.id, workspaceId });
    await expect(archiveCascade({ pageId: p.id, workspaceId })).rejects.toThrow(
      "PAGE_NOT_FOUND_OR_ALREADY_ARCHIVED",
    );
  });

  it("archives a leaf page (no descendants) and returns archivedCount=1", async () => {
    const leaf = await prisma.page.create({
      data: { workspaceId, title: "Leaf", position: 0, createdBy: TEST_USER_ID },
    });
    const result = await archiveCascade({ pageId: leaf.id, workspaceId });
    expect(result.archivedCount).toBe(1);
    const after = await prisma.page.findUnique({ where: { id: leaf.id } });
    expect(after?.isArchived).toBe(true);
    expect(after?.archivedRootId).toBeNull();
  });

  it("refuses to archive a page that belongs to another workspace (cross-workspace isolation)", async () => {
    // Create a SECOND workspace + a page in it
    const otherUserId = `test-trash-other-${Date.now()}`;
    const otherUser = await prisma.user.create({
      data: {
        id: otherUserId,
        email: `trash-other-${Date.now()}@test.pennote.dev`,
        firstName: "Other",
        lastName: "Test",
      },
    });
    const otherWorkspace = await prisma.workspace.create({
      data: {
        name: `trash-test-other-${Date.now()}`,
        ownerId: otherUser.id,
      },
    });
    const otherPage = await prisma.page.create({
      data: {
        workspaceId: otherWorkspace.id,
        title: "Other",
        position: 0,
        createdBy: otherUser.id,
      },
    });

    // Attempt to archive otherPage using OUR workspaceId
    await expect(archiveCascade({ pageId: otherPage.id, workspaceId })).rejects.toThrow(
      "PAGE_NOT_FOUND_OR_ALREADY_ARCHIVED",
    );

    // Verify the page is STILL not archived
    const stillThere = await prisma.page.findUnique({ where: { id: otherPage.id } });
    expect(stillThere?.isArchived).toBe(false);

    // Cleanup
    await prisma.page.delete({ where: { id: otherPage.id } });
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});
