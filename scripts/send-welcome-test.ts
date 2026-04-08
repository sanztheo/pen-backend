/**
 * Send a single Beta Welcome email with credentials
 *
 * Usage:
 *   infisical run --env=prod --path=/Backend -- npx tsx scripts/send-welcome-test.ts email@example.com "Prénom"
 */

import { EmailService } from "../src/services/EmailService.js";

const email = process.argv[2];
const name = process.argv[3] ?? "Test";

if (!email) {
  console.error("Usage: npx tsx scripts/send-welcome-test.ts <email> [name]");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`\nEnvoi Beta Welcome à: ${email}`);
  console.log(`Nom: ${name}`);
  console.log(`Password: Pennote-test1234!\n`);

  await EmailService.sendBetaWelcome({
    to: email,
    name,
    email,
    temporaryPassword: "Pennote-test1234!",
  });

  console.log('Envoyé. Check ta boîte — sujet: "Pennote — Votre compte beta est prêt"');
}

main().catch((err) => {
  console.error("Erreur:", err);
  process.exit(1);
});
