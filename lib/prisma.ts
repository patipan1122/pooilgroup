// Prisma 7 client singleton + soft-delete extension + org_id auto-scope
// Usage: `import { prisma } from "@/lib/prisma"`

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

declare global {
  var __prismaClient: PrismaClient | undefined;
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalThis.__prismaClient ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prismaClient = prisma;
}
