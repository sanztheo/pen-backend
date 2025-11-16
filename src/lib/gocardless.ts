import { createRequire } from "module";
const require = createRequire(import.meta.url);
const gocardless = require("gocardless-nodejs");

// Note: La variable GOCARDLESS contient le token, pas GOCARDLESS_ACCESS_TOKEN
export const gcClient = gocardless(
  process.env.GOCARDLESS!,
  process.env.GOCARDLESS_ENVIRONMENT as "sandbox" | "live",
);
