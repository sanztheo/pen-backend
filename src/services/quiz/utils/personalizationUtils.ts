/**
 * personalizationUtils.ts - Utilitaires pour récupérer et formater la personnalisation utilisateur
 * Utilisé pour enrichir les prompts IA de génération et correction de quiz
 */

import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../utils/logger.js";
import { SchoolLevel } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Type de personnalisation utilisateur stockée dans User.settings.personalization
 */
export interface UserPersonalization {
  classe?: string; // Ex: "Master", "Terminale", "3ème"
  etude?: string; // Ex: "Mathématique quantique", "Informatique"
  filiere?: string; // Ex: "Scientifique", "Littéraire"
  langue?: string; // Ex: "fr", "en"
  presentation?: string; // Description libre de l'utilisateur
  attente?: string; // Ce que l'utilisateur attend de l'IA
}

/**
 * Contexte de personnalisation formaté pour les prompts IA
 */
export interface PersonalizationContext {
  hasPersonalization: boolean;
  classe?: string;
  domaine?: string;
  filiere?: string;
  langue?: string;
  presentation?: string;
  attentes?: string;
  promptSection: string; // Section de prompt pré-formatée
  correctionPromptSection: string; // Section spécifique pour la correction
}

/**
 * Récupère la personnalisation utilisateur depuis la base de données
 */
export async function getUserPersonalization(userId: string): Promise<UserPersonalization | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    if (!user?.settings) {
      return null;
    }

    const settings = user.settings as unknown;
    if (!isRecord(settings)) return null;
    const personalization = settings.personalization;
    if (!isRecord(personalization)) return null;

    const result: UserPersonalization = {};
    // Legacy format: "classe" field directly
    // New onboarding format: "niveauScolaire" + "classeEtudesSup"/"classeCollege"/"classeLycee"
    if (typeof personalization.classe === "string") {
      result.classe = personalization.classe;
    } else if (typeof personalization.niveauScolaire === "string") {
      const niveau = personalization.niveauScolaire as string;
      if (niveau === "etudes_superieures" && typeof personalization.classeEtudesSup === "string") {
        result.classe = personalization.classeEtudesSup as string;
      } else if (niveau === "college" && typeof personalization.classeCollege === "string") {
        result.classe = personalization.classeCollege as string;
      } else if (niveau === "lycee" && typeof personalization.classeLycee === "string") {
        result.classe = personalization.classeLycee as string;
      } else {
        result.classe = niveau;
      }
    }
    if (typeof personalization.etude === "string") result.etude = personalization.etude;
    if (typeof personalization.filiere === "string") result.filiere = personalization.filiere;
    if (typeof personalization.langue === "string") result.langue = personalization.langue;
    if (typeof personalization.presentation === "string")
      result.presentation = personalization.presentation;
    if (typeof personalization.attente === "string") result.attente = personalization.attente;

    return Object.keys(result).length > 0 ? result : null;
  } catch (error) {
    logger.error("❌ [PERSONALIZATION] Erreur récupération personnalisation:", error);
    return null;
  }
}

/**
 * Formate la personnalisation en contexte utilisable dans les prompts
 */
export function formatPersonalizationContext(
  personalization: UserPersonalization | null,
): PersonalizationContext {
  if (
    !personalization ||
    (!personalization.classe &&
      !personalization.etude &&
      !personalization.filiere &&
      !personalization.presentation &&
      !personalization.attente)
  ) {
    return {
      hasPersonalization: false,
      promptSection: "",
      correctionPromptSection: "",
    };
  }

  // Construction du profil utilisateur
  const profileParts: string[] = [];

  if (personalization.classe) {
    profileParts.push(`Niveau : ${personalization.classe}`);
  }

  if (personalization.etude) {
    profileParts.push(`Domaine d'étude : ${personalization.etude}`);
  }

  if (personalization.filiere) {
    profileParts.push(`Filière : ${personalization.filiere}`);
  }

  if (personalization.presentation) {
    profileParts.push(`Profil : ${personalization.presentation}`);
  }

  // Section pour les prompts de génération
  let promptSection = "";
  if (profileParts.length > 0) {
    promptSection = `
👤 PROFIL DE L'ÉTUDIANT :
${profileParts.map((p) => `• ${p}`).join("\n")}

🎯 PERSONNALISATION REQUISE :
- Adapte le niveau de langage et la complexité au profil de l'étudiant
- Utilise des exemples pertinents pour son domaine d'étude
- Formule les questions de manière à correspondre à son niveau`;

    if (personalization.attente) {
      promptSection += `
- ATTENTES SPÉCIFIQUES DE L'ÉTUDIANT : "${personalization.attente}"
- Prends en compte ces attentes dans la formulation et le contenu des questions`;
    }
  }

  // Section pour les prompts de correction
  let correctionPromptSection = "";
  if (profileParts.length > 0) {
    correctionPromptSection = `
👤 PROFIL DE L'ÉTUDIANT À CORRIGER :
${profileParts.map((p) => `• ${p}`).join("\n")}

📝 ADAPTATION DE LA CORRECTION :
- Adapte ton ton et tes explications au niveau de l'étudiant
- Utilise des références et exemples de son domaine d'étude
- Sois ${getEncouragementStyle(personalization)} dans tes commentaires`;

    if (personalization.attente) {
      correctionPromptSection += `
- ATTENTES DE L'ÉTUDIANT : "${personalization.attente}"
- Prends en compte ces attentes dans tes feedbacks et recommandations`;
    }
  }

  return {
    hasPersonalization: true,
    classe: personalization.classe,
    domaine: personalization.etude,
    filiere: personalization.filiere,
    langue: personalization.langue,
    presentation: personalization.presentation,
    attentes: personalization.attente,
    promptSection,
    correctionPromptSection,
  };
}

/**
 * Détermine le style d'encouragement selon le profil
 */
function getEncouragementStyle(personalization: UserPersonalization): string {
  const niveau = personalization.classe?.toLowerCase() || "";

  // Collège : plus encourageant et pédagogique
  if (
    niveau.includes("6") ||
    niveau.includes("5") ||
    niveau.includes("4") ||
    niveau.includes("3") ||
    niveau.includes("collège")
  ) {
    return "encourageant et bienveillant, en expliquant clairement les erreurs";
  }

  // Lycée : équilibré
  if (
    niveau.includes("seconde") ||
    niveau.includes("première") ||
    niveau.includes("terminale") ||
    niveau.includes("lycée")
  ) {
    return "constructif tout en étant exigeant sur la rigueur";
  }

  // Études supérieures : plus rigoureux
  if (
    niveau.includes("licence") ||
    niveau.includes("master") ||
    niveau.includes("doctorat") ||
    niveau.includes("bts") ||
    niveau.includes("dut") ||
    niveau.includes("prépa") ||
    niveau.includes("supérieur") ||
    niveau.includes("université")
  ) {
    return "rigoureux et académique, avec des attentes élevées de précision";
  }

  return "adapté et encourageant";
}

/**
 * Récupère et formate la personnalisation en une seule fonction
 */
export async function getPersonalizationContextForUser(
  userId: string,
): Promise<PersonalizationContext> {
  const personalization = await getUserPersonalization(userId);
  return formatPersonalizationContext(personalization);
}

/**
 * Génère des instructions supplémentaires basées sur les attentes utilisateur
 */
export function generateAttentesInstructions(attentes: string): string {
  if (!attentes) return "";

  const attentesLower = attentes.toLowerCase();
  const instructions: string[] = [];

  // Détection des mots-clés dans les attentes
  if (
    attentesLower.includes("développement") ||
    attentesLower.includes("code") ||
    attentesLower.includes("programmation")
  ) {
    instructions.push(
      "- Privilégie les questions techniques et pratiques liées à la programmation",
    );
    instructions.push("- Inclus des exemples de code ou des cas pratiques quand c'est pertinent");
  }

  if (
    attentesLower.includes("concours") ||
    attentesLower.includes("examen") ||
    attentesLower.includes("prépare")
  ) {
    instructions.push("- Formule les questions dans un style proche des examens officiels");
    instructions.push("- Augmente le niveau d'exigence dans les réponses");
  }

  if (
    attentesLower.includes("pratique") ||
    attentesLower.includes("concret") ||
    attentesLower.includes("réel")
  ) {
    instructions.push("- Favorise les cas pratiques et exemples concrets");
    instructions.push("- Relie les concepts à des applications du monde réel");
  }

  if (
    attentesLower.includes("détaillé") ||
    attentesLower.includes("approfondi") ||
    attentesLower.includes("complet")
  ) {
    instructions.push("- Fournis des explications détaillées et complètes");
    instructions.push("- Approfondis les concepts avec des informations complémentaires");
  }

  if (
    attentesLower.includes("simple") ||
    attentesLower.includes("clair") ||
    attentesLower.includes("facile")
  ) {
    instructions.push("- Utilise un langage clair et accessible");
    instructions.push("- Décompose les concepts complexes en étapes simples");
  }

  return instructions.length > 0 ? "\n" + instructions.join("\n") : "";
}

/**
 * Mappe une valeur de personnalisation (classe) vers l'enum SchoolLevel de Prisma
 * @param classeValue - Valeur brute de la personnalisation (ex: "l2", "terminale", "M1")
 * @returns Valeur valide de l'enum SchoolLevel
 */
export function mapToSchoolLevelEnum(classeValue: string | undefined | null): SchoolLevel {
  if (!classeValue || classeValue.trim() === "") {
    return SchoolLevel.COLLEGE;
  }

  const normalized = classeValue.toLowerCase().trim();

  // Collège: 6ème, 5ème, 4ème, 3ème
  if (
    normalized.includes("6") ||
    normalized.includes("5") ||
    normalized.includes("4") ||
    normalized.includes("3") ||
    normalized.includes("collège") ||
    normalized.includes("college")
  ) {
    return SchoolLevel.COLLEGE;
  }

  // Lycée Seconde
  if (normalized.includes("seconde") || normalized === "2nde") {
    return SchoolLevel.LYCEE_SECONDE;
  }

  // Lycée Première
  if (
    normalized.includes("premiere") ||
    normalized.includes("première") ||
    normalized === "1ere" ||
    normalized === "1ère"
  ) {
    return SchoolLevel.LYCEE_PREMIERE;
  }

  // Lycée Terminale
  if (normalized.includes("terminale") || normalized === "tle") {
    return SchoolLevel.LYCEE_TERMINALE;
  }

  // Études supérieures: L1, L2, L3, M1, M2, Doctorat, BTS, DUT, Prépa, etc.
  if (
    normalized === "l1" ||
    normalized === "l2" ||
    normalized === "l3" ||
    normalized === "m1" ||
    normalized === "m2" ||
    normalized.includes("licence") ||
    normalized.includes("master") ||
    normalized.includes("doctorat") ||
    normalized.includes("bts") ||
    normalized.includes("dut") ||
    normalized.includes("but") ||
    normalized.includes("prépa") ||
    normalized.includes("prepa") ||
    normalized.includes("supérieur") ||
    normalized.includes("superieur") ||
    normalized.includes("université") ||
    normalized.includes("universite") ||
    normalized === "etudes_superieures"
  ) {
    return SchoolLevel.ETUDES_SUPERIEURES;
  }

  // Valeurs d'enum directes (déjà correctes)
  if (normalized === "college") return SchoolLevel.COLLEGE;
  if (normalized === "lycee_seconde") return SchoolLevel.LYCEE_SECONDE;
  if (normalized === "lycee_premiere") return SchoolLevel.LYCEE_PREMIERE;
  if (normalized === "lycee_terminale") return SchoolLevel.LYCEE_TERMINALE;
  if (normalized === "etudes_superieures") return SchoolLevel.ETUDES_SUPERIEURES;

  // Fallback par défaut
  logger.warn(`[SCHOOL-LEVEL-MAPPING] Valeur non reconnue "${classeValue}", fallback vers COLLEGE`);
  return SchoolLevel.COLLEGE;
}
