/**
 * AdminNotesService Tests
 * Covers: getNotes, createNote, deleteNote
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { AdminNotesService } from "../adminNotesService.js";
import { prisma } from "../../../lib/prisma.js";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockNoteFindMany = jest.fn();
const mockNoteCount = jest.fn();
const mockNoteCreate = jest.fn();
const mockNoteFindUnique = jest.fn();
const mockNoteDelete = jest.fn();
const mockUserFindUnique = jest.fn();

(prisma.adminNote as unknown as Record<string, jest.Mock>).findMany = mockNoteFindMany;
(prisma.adminNote as unknown as Record<string, jest.Mock>).count = mockNoteCount;
(prisma.adminNote as unknown as Record<string, jest.Mock>).create = mockNoteCreate;
(prisma.adminNote as unknown as Record<string, jest.Mock>).findUnique = mockNoteFindUnique;
(prisma.adminNote as unknown as Record<string, jest.Mock>).delete = mockNoteDelete;
(prisma.user as unknown as Record<string, jest.Mock>).findUnique = mockUserFindUnique;

// ─── Suppress logger output in tests ────────────────────────────
jest.unstable_mockModule("../../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// getNotes
// ═══════════════════════════════════════════════════════════════
describe("AdminNotesService.getNotes", () => {
  const mockNotes = [
    {
      id: "note-1",
      userId: "user-1",
      adminId: "admin-1",
      content: "User reported an issue",
      createdAt: new Date("2026-02-27"),
      updatedAt: new Date("2026-02-27"),
      admin: { email: "admin@test.com", firstName: "Jane", lastName: "Admin" },
    },
  ];

  it("should return paginated notes with defaults", async () => {
    mockNoteFindMany.mockResolvedValue(mockNotes);
    mockNoteCount.mockResolvedValue(1);

    const result = await AdminNotesService.getNotes("user-1");

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].adminEmail).toBe("admin@test.com");
    expect(result.notes[0].adminName).toBe("Jane Admin");
  });

  it("should respect page and limit parameters", async () => {
    mockNoteFindMany.mockResolvedValue([]);
    mockNoteCount.mockResolvedValue(50);

    const result = await AdminNotesService.getNotes("user-1", 3, 10);

    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(mockNoteFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
  });

  it("should cap limit at 100", async () => {
    mockNoteFindMany.mockResolvedValue([]);
    mockNoteCount.mockResolvedValue(0);

    await AdminNotesService.getNotes("user-1", 1, 500);

    expect(mockNoteFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("should clamp page to minimum 1", async () => {
    mockNoteFindMany.mockResolvedValue([]);
    mockNoteCount.mockResolvedValue(0);

    const result = await AdminNotesService.getNotes("user-1", -1, 20);

    expect(result.page).toBe(1);
    expect(mockNoteFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
  });

  it("should include admin info in results", async () => {
    mockNoteFindMany.mockResolvedValue(mockNotes);
    mockNoteCount.mockResolvedValue(1);

    await AdminNotesService.getNotes("user-1");

    expect(mockNoteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          admin: {
            select: { email: true, firstName: true, lastName: true },
          },
        },
      }),
    );
  });

  it("should order by createdAt desc", async () => {
    mockNoteFindMany.mockResolvedValue([]);
    mockNoteCount.mockResolvedValue(0);

    await AdminNotesService.getNotes("user-1");

    expect(mockNoteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// createNote
// ═══════════════════════════════════════════════════════════════
describe("AdminNotesService.createNote", () => {
  it("should create a note successfully", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1" });
    mockNoteCreate.mockResolvedValue({
      id: "note-new",
      userId: "user-1",
      adminId: "admin-1",
      content: "Important note",
      createdAt: new Date(),
      updatedAt: new Date(),
      admin: { email: "admin@test.com", firstName: "Jane", lastName: "Admin" },
    });

    const result = await AdminNotesService.createNote("user-1", "admin-1", "Important note");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.note.id).toBe("note-new");
      expect(result.note.content).toBe("Important note");
      expect(result.note.adminEmail).toBe("admin@test.com");
    }
  });

  it("should reject empty content", async () => {
    const result = await AdminNotesService.createNote("user-1", "admin-1", "");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("vide");
    }
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("should reject content exceeding 2000 characters", async () => {
    const longContent = "a".repeat(2001);

    const result = await AdminNotesService.createNote("user-1", "admin-1", longContent);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("2000");
    }
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("should return error when target user not found", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const result = await AdminNotesService.createNote("nonexistent", "admin-1", "Some note");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("introuvable");
    }
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });

  it("should accept content at exactly 2000 characters", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1" });
    mockNoteCreate.mockResolvedValue({
      id: "note-new",
      userId: "user-1",
      adminId: "admin-1",
      content: "a".repeat(2000),
      createdAt: new Date(),
      updatedAt: new Date(),
      admin: { email: "admin@test.com", firstName: "Jane", lastName: "Admin" },
    });

    const result = await AdminNotesService.createNote("user-1", "admin-1", "a".repeat(2000));

    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteNote
// ═══════════════════════════════════════════════════════════════
describe("AdminNotesService.deleteNote", () => {
  it("should delete own note successfully", async () => {
    mockNoteFindUnique.mockResolvedValue({ id: "note-1", adminId: "admin-1" });
    mockNoteDelete.mockResolvedValue({});

    const result = await AdminNotesService.deleteNote("note-1", "admin-1");

    expect(result.success).toBe(true);
    expect(mockNoteDelete).toHaveBeenCalledWith({ where: { id: "note-1" } });
  });

  it("should allow any admin to delete another admin's note", async () => {
    // The service allows any admin to delete (admin routes require admin auth)
    mockNoteFindUnique.mockResolvedValue({ id: "note-1", adminId: "admin-2" });
    mockNoteDelete.mockResolvedValue({});

    const result = await AdminNotesService.deleteNote("note-1", "admin-1");

    expect(result.success).toBe(true);
    expect(mockNoteDelete).toHaveBeenCalledWith({ where: { id: "note-1" } });
  });

  it("should return error for nonexistent note", async () => {
    mockNoteFindUnique.mockResolvedValue(null);

    const result = await AdminNotesService.deleteNote("nonexistent", "admin-1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("introuvable");
    }
    expect(mockNoteDelete).not.toHaveBeenCalled();
  });
});
