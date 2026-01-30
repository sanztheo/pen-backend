/**
 * Admin Authorization Middleware
 * Verifies that the authenticated user has admin privileges
 */

import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        error: "Authentification requise",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isAdmin: true, email: true },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        error: "Utilisateur non trouvé",
      });
      return;
    }

    if (!user.isAdmin) {
      console.log(`[ADMIN] Access denied for user ${user.email}`);
      res.status(403).json({
        success: false,
        error: "Accès administrateur requis",
      });
      return;
    }

    console.log(`[ADMIN] Access granted for admin ${user.email}`);
    next();
  } catch (error) {
    console.error("[ADMIN] Middleware error:", error);
    res.status(500).json({
      success: false,
      error: "Erreur de vérification des droits",
    });
  }
};
