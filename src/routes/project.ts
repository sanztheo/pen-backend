import { Router } from "express";
import {
  createProject,
  getWorkspaceProjects,
  getProject,
  updateProject,
  deleteProject,
  toggleProjectPin,
} from "../controllers/project.js";
import { restoreProjectHandler } from "../controllers/trash.js";
import { authenticateToken } from "../middlewares/auth.js";
import { trashLimiter } from "../middlewares/rateLimiting.js";
import { validateUUID } from "../middlewares/validateUUID.js";

const router = Router();

router.use(authenticateToken);

router.post("/", createProject);
router.get("/workspace/:workspaceId", getWorkspaceProjects);
router.get("/:id", getProject);
router.put("/:id", updateProject);
// DELETE /:id now soft-deletes (archive into trash) via controllers/project.ts::deleteProject.
router.delete("/:id", deleteProject);
router.post("/:id/restore", validateUUID("id"), trashLimiter, restoreProjectHandler);
router.patch("/:id/pin", toggleProjectPin);

export { router as projectRouter };
