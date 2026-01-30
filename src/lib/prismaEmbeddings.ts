/**
 * 🔥 PRISMA CLIENT POUR LA BASE EMBEDDINGS (pgvector)
 *
 * Client Prisma séparé pour gérer les embeddings vectoriels.
 * Utilise EMBEDDING_DATABASE_URL au lieu de DATABASE_URL.
 *
 * Tables gérées :
 * - RAGSource
 * - RAGChunk (avec embeddings pgvector)
 * - RAGSession
 */

import { PrismaClient } from "../../node_modules/.prisma/client-embeddings/index.js";

const globalForPrismaEmbeddings = global as unknown as {
  prismaEmbeddings: PrismaClient | undefined;
};

export const prismaEmbeddings: PrismaClient =
  globalForPrismaEmbeddings.prismaEmbeddings ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrismaEmbeddings.prismaEmbeddings = prismaEmbeddings;
}
