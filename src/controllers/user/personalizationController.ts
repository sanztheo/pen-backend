import { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";

type Personalization = {
  classe?: string;
  etude?: string;
  filiere?: string;
  langue?: string; // code linguistique, ex: 'fr', 'en'
  presentation?: string;
  attente?: string;
  onboardingCompleted?: boolean;
};

const sanitize = (v: unknown, max = 700) => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return s.length > max ? s.slice(0, max) : s;
};

const normalizeInput = (body: any): Personalization => {
  const out: Personalization = {};
  if (!body || typeof body !== "object") return out;
  if (body.classe !== undefined) out.classe = sanitize(body.classe, 120);
  if (body.etude !== undefined) out.etude = sanitize(body.etude, 120);
  if (body.filiere !== undefined) out.filiere = sanitize(body.filiere, 120);
  if (body.langue !== undefined) out.langue = sanitize(body.langue, 10);
  if (body.presentation !== undefined)
    out.presentation = sanitize(body.presentation, 700);
  if (body.attente !== undefined) out.attente = sanitize(body.attente, 500);
  if (body.onboardingCompleted !== undefined)
    out.onboardingCompleted = Boolean(body.onboardingCompleted);
  return out;
};

export const getPersonalization = async (req: Request, res: Response) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, error: "Utilisateur non authentifié" });

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { settings: true },
    });

    const personalization = (user?.settings as any)?.personalization || null;
    return res.json({ success: true, data: personalization });
  } catch (error) {
    console.error("❌ [USER] getPersonalization error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Erreur interne du serveur" });
  }
};

export const updatePersonalization = async (req: Request, res: Response) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, error: "Utilisateur non authentifié" });

    const incoming = normalizeInput(req.body);

    const existing = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { settings: true },
    });

    const currentSettings = (existing?.settings as any) || {};
    const currentPersona =
      (currentSettings.personalization as Personalization) || {};

    const merged: Personalization = {
      ...currentPersona,
      ...Object.fromEntries(
        Object.entries(incoming).filter(([_, v]) => v !== undefined),
      ),
    };

    const newSettings = { ...currentSettings, personalization: merged };

    await prisma.user.update({
      where: { id: req.user.id },
      data: { settings: newSettings },
    });

    return res.json({
      success: true,
      message: "Personnalisation mise à jour",
      data: merged,
    });
  } catch (error) {
    console.error("❌ [USER] updatePersonalization error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Erreur interne du serveur" });
  }
};
