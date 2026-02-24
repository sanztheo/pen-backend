import { Router } from "express";
import { reorderItems } from "../controllers/reorder.js";
import { authenticateToken } from "../middlewares/auth.js";

const router = Router();

router.post("/", authenticateToken, reorderItems);

export { router as reorderRouter };
