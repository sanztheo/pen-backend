import { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";

type NiveauScolaire = "college" | "lycee" | "etudes_superieures" | "autre";
type ClasseCollege = "6eme" | "5eme" | "4eme" | "3eme";
type ClasseLycee = "seconde" | "premiere" | "terminale";

type Personalization = {
  // === Nouveau système en cascade ===
  niveauScolaire?: NiveauScolaire;
  classeCollege?: ClasseCollege;
  classeLycee?: ClasseLycee;
  classeEtudesSup?: string; // L1, L2, L3, M1, M2, Doctorat, etc.
  classeAutre?: string; // Champ libre pour "Autre"
  filiere?: string; // Obligatoire pour lycée (Première/Terminale) et études sup
  specialites?: string; // Spécialités du bac (texte libre)

  // === Champs existants ===
  classe?: string; // Legacy - pour migration
  etude?: string; // Domaine d'étude
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

const VALID_NIVEAU_SCOLAIRE: NiveauScolaire[] = [
  "college",
  "lycee",
  "etudes_superieures",
  "autre",
];
const VALID_CLASSE_COLLEGE: ClasseCollege[] = ["6eme", "5eme", "4eme", "3eme"];
const VALID_CLASSE_LYCEE: ClasseLycee[] = ["seconde", "premiere", "terminale"];

const sanitizeEnum = <T extends string>(
  v: unknown,
  validValues: T[],
): T | undefined => {
  if (typeof v !== "string") return undefined;
  const normalized = v.toLowerCase().trim();
  return validValues.includes(normalized as T) ? (normalized as T) : undefined;
};

const normalizeInput = (body: any): Personalization => {
  const out: Personalization = {};
  if (!body || typeof body !== "object") return out;

  // === Nouveau système en cascade ===
  if (body.niveauScolaire !== undefined) {
    out.niveauScolaire = sanitizeEnum(
      body.niveauScolaire,
      VALID_NIVEAU_SCOLAIRE,
    );
  }
  if (body.classeCollege !== undefined) {
    out.classeCollege = sanitizeEnum(body.classeCollege, VALID_CLASSE_COLLEGE);
  }
  if (body.classeLycee !== undefined) {
    out.classeLycee = sanitizeEnum(body.classeLycee, VALID_CLASSE_LYCEE);
  }
  if (body.classeEtudesSup !== undefined) {
    out.classeEtudesSup = sanitize(body.classeEtudesSup, 50);
  }
  if (body.classeAutre !== undefined) {
    out.classeAutre = sanitize(body.classeAutre, 120);
  }
  if (body.specialites !== undefined) {
    out.specialites = sanitize(body.specialites, 200);
  }

  // === Champs existants ===
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
      select: { settings: true, onboardingCompleted: true },
    });

    // 🐛 DEBUG: Log pour voir la valeur réelle
    console.log("🔍 [DEBUG] User ID:", req.user.id);
    console.log(
      "🔍 [DEBUG] user?.onboardingCompleted:",
      user?.onboardingCompleted,
    );
    console.log("🔍 [DEBUG] Type:", typeof user?.onboardingCompleted);

    const personalization = (user?.settings as any)?.personalization || {};

    // Ajouter onboardingCompleted depuis le champ User
    const result = {
      ...personalization,
      onboardingCompleted: user?.onboardingCompleted ?? false,
    };

    console.log(
      "🔍 [DEBUG] Result onboardingCompleted:",
      result.onboardingCompleted,
    );

    return res.json({ success: true, data: result });
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

    // Extraire onboardingCompleted pour le sauvegarder séparément dans User
    const { onboardingCompleted, ...personalizationData } = incoming;

    const existing = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { settings: true },
    });

    const currentSettings = (existing?.settings as any) || {};
    const currentPersona =
      (currentSettings.personalization as Personalization) || {};

    // Ne merger que les données de personnalisation (sans onboardingCompleted)
    const merged: Personalization = {
      ...currentPersona,
      ...Object.fromEntries(
        Object.entries(personalizationData).filter(([_, v]) => v !== undefined),
      ),
    };

    const newSettings = { ...currentSettings, personalization: merged };

    // Préparer les données de mise à jour
    const updateData: any = { settings: newSettings };

    // Si onboardingCompleted est fourni, l'ajouter à l'update du User
    if (onboardingCompleted !== undefined) {
      updateData.onboardingCompleted = Boolean(onboardingCompleted);
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
    });

    // Retourner les données avec onboardingCompleted si fourni
    const responseData = {
      ...merged,
      ...(onboardingCompleted !== undefined && {
        onboardingCompleted: Boolean(onboardingCompleted),
      }),
    };

    return res.json({
      success: true,
      message: "Personnalisation mise à jour",
      data: responseData,
    });
  } catch (error) {
    console.error("❌ [USER] updatePersonalization error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Erreur interne du serveur" });
  }
};
