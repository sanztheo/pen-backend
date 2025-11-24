import { createRequire } from "module";
const require = createRequire(import.meta.url);
const gocardless = require("gocardless-nodejs");
const constants = require("gocardless-nodejs/constants");

// 🔒 SÉCURITÉ CRITIQUE: Validation des variables d'environnement au démarrage
const GOCARDLESS_TOKEN = process.env.GOCARDLESS;
const GOCARDLESS_ENV = process.env.GOCARDLESS_ENVIRONMENT;

if (!GOCARDLESS_TOKEN) {
  throw new Error(
    "❌ SÉCURITÉ: Variable GOCARDLESS manquante. Le serveur ne peut pas démarrer.",
  );
}

if (!GOCARDLESS_ENV || !["sandbox", "live"].includes(GOCARDLESS_ENV)) {
  throw new Error(
    `❌ SÉCURITÉ: GOCARDLESS_ENVIRONMENT invalide (${GOCARDLESS_ENV}). Valeurs acceptées: 'sandbox' ou 'live'.`,
  );
}

// Note: La variable GOCARDLESS contient le token, pas GOCARDLESS_ACCESS_TOKEN
const environment =
  GOCARDLESS_ENV === "sandbox"
    ? constants.Environments.Sandbox
    : constants.Environments.Live;

console.log(
  `[GOCARDLESS] ✅ Configuration validée: environnement = ${GOCARDLESS_ENV}`,
);

export const gcClient = gocardless(GOCARDLESS_TOKEN, environment);
