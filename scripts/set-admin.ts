/**
 * Script to set/unset admin status for a user
 * Usage: npm run admin:set <email> [true|false]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const isAdmin = process.argv[3] !== "false"; // Default to true

  if (!email) {
    console.error("Usage: npm run admin:set <email> [true|false]");
    console.error("Example: npm run admin:set user@example.com true");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isAdmin: true },
  });

  if (!user) {
    console.error(`[ERROR] User not found: ${email}`);
    process.exit(1);
  }

  if (user.isAdmin === isAdmin) {
    console.log(`[INFO] User ${email} is already isAdmin=${isAdmin}`);
    process.exit(0);
  }

  await prisma.user.update({
    where: { email },
    data: { isAdmin },
  });

  console.log(`[SUCCESS] User ${email} is now isAdmin=${isAdmin}`);
}

main()
  .catch((e) => {
    console.error("[ERROR]", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
