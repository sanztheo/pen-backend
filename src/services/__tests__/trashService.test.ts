/**
 * trashService tests — integration against the dev DB
 * Run with: infisical run --env=dev --path=/Backend -- npm test -- trashService.test.ts
 *
 * These tests create a disposable User + Workspace fixture, run against real
 * Postgres (no mocks — the archive logic relies on a recursive CTE that must
 * be exercised end-to-end), and clean everything up in afterAll().
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from "@jest/globals";
import {
  archiveCascade,
  restoreCascade,
  listTrash,
  bulkDelete,
  emptyTrashSync,
  purgeOlderThan30Days,
  BULK_DELETE_MAX,
} from "../trashService.js";
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

describe("restoreCascade", () => {
  it("restores root and shifts siblings positions back", async () => {
    // Seed: parent P with children A=0, B=1, C=2
    // Archive B -> A=0, B archived(pos=1), C=1 (decremented by archive)
    // Restore B -> A=0, B=1, C=2 again
    const parent = await prisma.page.create({
      data: { workspaceId, title: "P", position: 100, createdBy: TEST_USER_ID },
    });
    const a = await prisma.page.create({
      data: {
        workspaceId,
        parentId: parent.id,
        title: "A",
        position: 0,
        createdBy: TEST_USER_ID,
      },
    });
    const b = await prisma.page.create({
      data: {
        workspaceId,
        parentId: parent.id,
        title: "B",
        position: 1,
        createdBy: TEST_USER_ID,
      },
    });
    const c = await prisma.page.create({
      data: {
        workspaceId,
        parentId: parent.id,
        title: "C",
        position: 2,
        createdBy: TEST_USER_ID,
      },
    });

    await archiveCascade({ pageId: b.id, workspaceId });
    await restoreCascade({ pageId: b.id, workspaceId });

    const [aAfter, bAfter, cAfter] = await Promise.all([
      prisma.page.findUnique({ where: { id: a.id } }),
      prisma.page.findUnique({ where: { id: b.id } }),
      prisma.page.findUnique({ where: { id: c.id } }),
    ]);
    expect(aAfter?.position).toBe(0);
    expect(bAfter?.position).toBe(1);
    expect(bAfter?.isArchived).toBe(false);
    expect(bAfter?.archivedAt).toBeNull();
    expect(bAfter?.archivedPosition).toBeNull();
    expect(bAfter?.parentId).toBe(parent.id);
    expect(cAfter?.position).toBe(2);
  });

  it("restores cascade descendants and clears archive flags on all", async () => {
    const root = await prisma.page.create({
      data: { workspaceId, title: "Root", position: 0, createdBy: TEST_USER_ID },
    });
    const child = await prisma.page.create({
      data: {
        workspaceId,
        parentId: root.id,
        title: "Child",
        position: 0,
        createdBy: TEST_USER_ID,
      },
    });

    await archiveCascade({ pageId: root.id, workspaceId });
    const result = await restoreCascade({ pageId: root.id, workspaceId });

    expect(result.restoredCount).toBe(2);
    const [rootAfter, childAfter] = await Promise.all([
      prisma.page.findUnique({ where: { id: root.id } }),
      prisma.page.findUnique({ where: { id: child.id } }),
    ]);
    expect(rootAfter?.isArchived).toBe(false);
    expect(rootAfter?.archivedRootId).toBeNull();
    expect(rootAfter?.archivedAt).toBeNull();
    expect(rootAfter?.archivedPosition).toBeNull();
    expect(childAfter?.isArchived).toBe(false);
    expect(childAfter?.archivedRootId).toBeNull();
    expect(childAfter?.archivedAt).toBeNull();
    expect(childAfter?.archivedPosition).toBeNull();
  });

  it("re-anchors to workspace root when original parent is no longer available", async () => {
    // Note: we can't hard-delete the parent because the Page.parentId FK uses
    // onDelete: Cascade — the child would get cascade-deleted too. Instead we
    // archive the parent independently after the child is already in trash.
    // The restore code treats an archived parent the same as a missing parent:
    // re-anchor to the workspace root.
    const parent = await prisma.page.create({
      data: { workspaceId, title: "Parent", position: 0, createdBy: TEST_USER_ID },
    });
    const child = await prisma.page.create({
      data: {
        workspaceId,
        parentId: parent.id,
        title: "Child",
        position: 0,
        createdBy: TEST_USER_ID,
      },
    });

    // Archive the child first. collectDescendantIds filters is_archived=false,
    // so the subsequent parent archive won't touch this already-archived child.
    await archiveCascade({ pageId: child.id, workspaceId });
    await archiveCascade({ pageId: parent.id, workspaceId });

    await restoreCascade({ pageId: child.id, workspaceId });

    const childAfter = await prisma.page.findUnique({ where: { id: child.id } });
    expect(childAfter?.isArchived).toBe(false);
    expect(childAfter?.parentId).toBeNull(); // re-anchored to root
  });

  it("throws PAGE_NOT_IN_TRASH when the page is not archived", async () => {
    const p = await prisma.page.create({
      data: { workspaceId, title: "Live", position: 0, createdBy: TEST_USER_ID },
    });
    await expect(restoreCascade({ pageId: p.id, workspaceId })).rejects.toThrow(
      "PAGE_NOT_IN_TRASH",
    );
  });

  it("refuses to restore a page that belongs to another workspace", async () => {
    const otherUserId = `test-restore-other-${Date.now()}`;
    const otherUser = await prisma.user.create({
      data: {
        id: otherUserId,
        email: `restore-other-${Date.now()}@test.pennote.dev`,
        firstName: "Other",
        lastName: "Test",
      },
    });
    const otherWorkspace = await prisma.workspace.create({
      data: {
        name: `restore-test-other-${Date.now()}`,
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
    await archiveCascade({ pageId: otherPage.id, workspaceId: otherWorkspace.id });

    // Try to restore from OUR workspace
    await expect(restoreCascade({ pageId: otherPage.id, workspaceId })).rejects.toThrow(
      "PAGE_NOT_IN_TRASH",
    );

    // Cleanup
    await prisma.page.delete({ where: { id: otherPage.id } });
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});

describe("listTrash + bulkDelete + emptyTrashSync + purge", () => {
  it("listTrash returns only archived roots, paginated by archivedAt desc", async () => {
    const r1 = await prisma.page.create({
      data: { workspaceId, title: "R1", position: 0, createdBy: TEST_USER_ID },
    });
    await prisma.page.create({
      data: {
        workspaceId,
        parentId: r1.id,
        title: "R1Child",
        position: 0,
        createdBy: TEST_USER_ID,
      },
    });
    const r2 = await prisma.page.create({
      data: { workspaceId, title: "R2", position: 1, createdBy: TEST_USER_ID },
    });

    await archiveCascade({ pageId: r1.id, workspaceId });
    // small delay to ensure r2 has a strictly later archivedAt
    await new Promise((resolve) => setTimeout(resolve, 10));
    await archiveCascade({ pageId: r2.id, workspaceId });

    const result = await listTrash({ workspaceId, take: 50 });
    // Child has archivedRootId=r1.id → NOT a root → excluded
    expect(result.items.map((i) => i.id).sort()).toEqual([r1.id, r2.id].sort());
    // newest first: r2 archived after r1
    expect(result.items[0].id).toBe(r2.id);
    expect(result.nextCursor).toBeNull();
  });

  it("bulkDelete deletes roots and all cascade descendants", async () => {
    const root = await prisma.page.create({
      data: { workspaceId, title: "Root", position: 0, createdBy: TEST_USER_ID },
    });
    const child = await prisma.page.create({
      data: {
        workspaceId,
        parentId: root.id,
        title: "Child",
        position: 0,
        createdBy: TEST_USER_ID,
      },
    });
    await archiveCascade({ pageId: root.id, workspaceId });

    const result = await bulkDelete({ workspaceId, ids: [root.id] });
    expect(result.deletedCount).toBeGreaterThanOrEqual(2);

    const [rootAfter, childAfter] = await Promise.all([
      prisma.page.findUnique({ where: { id: root.id } }),
      prisma.page.findUnique({ where: { id: child.id } }),
    ]);
    expect(rootAfter).toBeNull();
    expect(childAfter).toBeNull();
  });

  it("bulkDelete rejects when ids.length exceeds BULK_DELETE_MAX", async () => {
    const tooMany = Array.from(
      { length: BULK_DELETE_MAX + 1 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    await expect(bulkDelete({ workspaceId, ids: tooMany })).rejects.toThrow("BULK_LIMIT_EXCEEDED");
  });

  it("bulkDelete ignores ids from other workspaces", async () => {
    const otherUserId = `test-bulk-other-${Date.now()}`;
    const otherUser = await prisma.user.create({
      data: {
        id: otherUserId,
        email: `bulk-other-${Date.now()}@test.pennote.dev`,
        firstName: "Other",
        lastName: "Test",
      },
    });
    const otherWs = await prisma.workspace.create({
      data: { name: `bulk-other-${Date.now()}`, ownerId: otherUser.id },
    });
    const otherPage = await prisma.page.create({
      data: {
        workspaceId: otherWs.id,
        title: "Other",
        position: 0,
        createdBy: otherUser.id,
      },
    });
    await archiveCascade({ pageId: otherPage.id, workspaceId: otherWs.id });

    // Try to bulk-delete it from OUR workspace
    const result = await bulkDelete({ workspaceId, ids: [otherPage.id] });
    expect(result.deletedCount).toBe(0);

    const stillThere = await prisma.page.findUnique({ where: { id: otherPage.id } });
    expect(stillThere).not.toBeNull();

    await prisma.page.delete({ where: { id: otherPage.id } });
    await prisma.workspace.delete({ where: { id: otherWs.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it("emptyTrashSync removes all archived pages in the workspace", async () => {
    const a = await prisma.page.create({
      data: { workspaceId, title: "A", position: 0, createdBy: TEST_USER_ID },
    });
    const b = await prisma.page.create({
      data: { workspaceId, title: "B", position: 1, createdBy: TEST_USER_ID },
    });
    await archiveCascade({ pageId: a.id, workspaceId });
    await archiveCascade({ pageId: b.id, workspaceId });

    const result = await emptyTrashSync({ workspaceId });
    expect(result.deletedCount).toBeGreaterThanOrEqual(2);

    const remaining = await prisma.page.count({
      where: { workspaceId, isArchived: true },
    });
    expect(remaining).toBe(0);
  });

  it("purgeOlderThan30Days deletes pages older than retention, leaves fresh ones", async () => {
    const old = await prisma.page.create({
      data: { workspaceId, title: "Old", position: 0, createdBy: TEST_USER_ID },
    });
    const fresh = await prisma.page.create({
      data: { workspaceId, title: "Fresh", position: 1, createdBy: TEST_USER_ID },
    });

    // Manually mark `old` as archived 31 days ago
    const longAgo = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    await prisma.page.update({
      where: { id: old.id },
      data: { isArchived: true, archivedAt: longAgo },
    });
    await archiveCascade({ pageId: fresh.id, workspaceId });

    const result = await purgeOlderThan30Days();
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);

    const [oldAfter, freshAfter] = await Promise.all([
      prisma.page.findUnique({ where: { id: old.id } }),
      prisma.page.findUnique({ where: { id: fresh.id } }),
    ]);
    expect(oldAfter).toBeNull();
    expect(freshAfter).not.toBeNull();
  });
});
