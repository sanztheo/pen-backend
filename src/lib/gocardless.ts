import { createRequire } from "module";
const require = createRequire(import.meta.url);
const gocardless = require("gocardless-nodejs");
const constants = require("gocardless-nodejs/constants");

// Note: La variable GOCARDLESS contient le token, pas GOCARDLESS_ACCESS_TOKEN
const environment =
  process.env.GOCARDLESS_ENVIRONMENT === "sandbox"
    ? constants.Environments.Sandbox
    : constants.Environments.Live;

export const gcClient = gocardless(process.env.GOCARDLESS!, environment);
