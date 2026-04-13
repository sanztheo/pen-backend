/**
 * Trash HTTP routes — integration tests
 *
 * Goal: prove the route-level wiring (auth, workspace authz, sync vs async empty)
 * without re-testing the service layer (covered by services/__tests__/trashService.test.ts).
 *
 * Strategy: build a minimal Express app that wires the real controllers and the
 * real `verifyWorkspaceAccess` middleware against the real dev DB. We bypass
 * Clerk's `authenticateToken` with a tiny test middleware that reads `x-test-user`
 * (same approach used in routes/__tests__/beta.integration.test.ts). This is the
 * cleanest path: the service-layer tests already prove the security boundary,
 * and we still exercise `verifyWorkspaceAccess` + `assertUserCanAccessWorkspace`
 * against real Postgres so cross-workspace requests truly hit the DB.
 *
 * Run with:
 *   infisical run --env=dev --path=/Backend -- npm test -- trash.test.ts
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from "@jest/globals";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";

// Hard-stop if this file is ever evaluated outside the Jest runner.
// `testAuthenticateToken` below bypasses Clerk by trusting a plain header —
// if a dev copy-pastes this pattern into a non-test module, Postgres/Clerk
// would start accepting forged `x-test-user` headers in prod. NODE_ENV is
// set to "test" automatically by Jest, so this throws only in foreign contexts.
if (process.env.NODE_ENV !== "test") {
  throw new Error(
    "trash.test.ts / testAuthenticateToken imported in non-test context — refusing to run",
  );
}
import {
  archivePageHandler,
  restorePageHandler,
  listTrashHandler,
  bulkDeleteTrashHandler,
  emptyTrashHandler,
} from "../../controllers/trash.js";
import { validateUUID } from "../../middlewares/validateUUID.js";
import { verifyWorkspaceAccess } from "../../middlewares/workspaceAccess.js";
import { archiveCascade } from "../../services/trashService.js";
import { prisma } from "../../lib/prisma.js";

// ─── Test auth middleware (matches beta.integration.test.ts pattern) ───
function testAuthenticateToken(req: Request, res: Response, next: NextFunction): void {
  const userHeader = req.headers["x-test-user"] as string | undefined;
  if (userHeader) {
    try {
      req.user = JSON.parse(userHeader) as Request["user"];
      next();
      return;
    } catch {
      /* fall through */
    }
  }
  res.status(401).json({ error: "MISSING_TOKEN" });
}

// ─── Build a minimal app that mirrors routes/page.ts ────────────────────
function createTestApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(testAuthenticateToken);

  // Order matters: literal `/trash*` segments BEFORE `/:id/*` so DELETE /trash
  // doesn't get matched as a UUID param. Mirrors the comment in routes/page.ts.
  app.get("/api/pages/trash", verifyWorkspaceAccess, listTrashHandler);
  app.post("/api/pages/trash/bulk-delete", verifyWorkspaceAccess, bulkDeleteTrashHandler);
  app.delete("/api/pages/trash", verifyWorkspaceAccess, emptyTrashHandler);
  app.post("/api/pages/:id/archive", validateUUID("id"), archivePageHandler);
  app.post("/api/pages/:id/restore", validateUUID("id"), restorePageHandler);

  return app;
}

// ─── Fixtures ───────────────────────────────────────────────────────────
const RUN_ID = Date.now();
const OWNER_ID = `test-trash-http-owner-${RUN_ID}`;
const OTHER_ID = `test-trash-http-other-${RUN_ID}`;

let app: express.Application;
let workspaceId: string;
let otherWorkspaceId: string;

function authHeader(userId: string): Record<string, string> {
  return { "x-test-user": JSON.stringify({ id: userId, email: `${userId}@test.pennote.dev` }) };
}

beforeAll(async () => {
  app = createTestApp();

  await prisma.user.create({
    data: {
      id: OWNER_ID,
      email: `${OWNER_ID}@test.pennote.dev`,
      firstName: "Trash",
      lastName: "Owner",
    },
  });
  await prisma.user.create({
    data: {
      id: OTHER_ID,
      email: `${OTHER_ID}@test.pennote.dev`,
      firstName: "Other",
      lastName: "User",
    },
  });

  const ws = await prisma.workspace.create({
    data: { name: `trash-http-${RUN_ID}`, ownerId: OWNER_ID },
  });
  workspaceId = ws.id;

  const otherWs = await prisma.workspace.create({
    data: { name: `trash-http-other-${RUN_ID}`, ownerId: OTHER_ID },
  });
  otherWorkspaceId = otherWs.id;
});

afterEach(async () => {
  await prisma.page.deleteMany({ where: { workspaceId } });
  await prisma.page.deleteMany({ where: { workspaceId: otherWorkspaceId } });
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, OTHER_ID] } } });
  await prisma.$disconnect();
});

// ════════════════════════════════════════════════════════════════════════
describe("Trash HTTP routes", () => {
  it("POST /pages/:id/restore restores an archived page to its original position", async () => {
    // Seed positions 0,1,2; archive B; restore B; expect 0,1,2 back.
    const a = await prisma.page.create({
      data: { workspaceId, title: "A", position: 0, createdBy: OWNER_ID },
    });
    const b = await prisma.page.create({
      data: { workspaceId, title: "B", position: 1, createdBy: OWNER_ID },
    });
    const c = await prisma.page.create({
      data: { workspaceId, title: "C", position: 2, createdBy: OWNER_ID },
    });

    await archiveCascade({ pageId: b.id, workspaceId });

    const res = await request(app).post(`/api/pages/${b.id}/restore`).set(authHeader(OWNER_ID));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const sorted = await prisma.page.findMany({
      where: { workspaceId, isArchived: false },
      orderBy: { position: "asc" },
    });
    expect(sorted.map((p) => p.title)).toEqual(["A", "B", "C"]);
    expect(sorted.map((p) => p.position)).toEqual([0, 1, 2]);
    // Silence unused var warnings for fixtures we still want to be explicit about.
    expect(a.id).toBeDefined();
    expect(c.id).toBeDefined();
  });

  it("POST /pages/:id/archive rejects cross-workspace requests", async () => {
    // OWNER tries to archive a page that belongs to OTHER's workspace.
    const otherPage = await prisma.page.create({
      data: {
        workspaceId: otherWorkspaceId,
        title: "Foreign Page",
        position: 0,
        createdBy: OTHER_ID,
      },
    });

    const res = await request(app)
      .post(`/api/pages/${otherPage.id}/archive`)
      .set(authHeader(OWNER_ID));

    // assertUserCanAccessWorkspace throws HttpError with status 403/404 — either
    // is acceptable as long as the page wasn't archived.
    expect([403, 404]).toContain(res.status);

    const stillThere = await prisma.page.findUnique({ where: { id: otherPage.id } });
    expect(stillThere?.isArchived).toBe(false);
  });

  it("DELETE /pages/trash empties small trashes synchronously", async () => {
    const a = await prisma.page.create({
      data: { workspaceId, title: "A", position: 0, createdBy: OWNER_ID },
    });
    const b = await prisma.page.create({
      data: { workspaceId, title: "B", position: 1, createdBy: OWNER_ID },
    });
    await archiveCascade({ pageId: a.id, workspaceId });
    await archiveCascade({ pageId: b.id, workspaceId });

    const res = await request(app)
      .delete("/api/pages/trash")
      .set(authHeader(OWNER_ID))
      .send({ workspaceId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.mode).toBe("sync");
    expect(typeof res.body.deletedCount).toBe("number");
    expect(res.body.deletedCount).toBeGreaterThanOrEqual(2);

    const remaining = await prisma.page.count({
      where: { workspaceId, isArchived: true },
    });
    expect(remaining).toBe(0);
  });
});
