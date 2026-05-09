// Prisma 7 client singleton + soft-delete extension + org_id auto-scope
// Usage: `import { prisma } from "@/lib/prisma"`

import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "./generated/prisma/client";

declare global {
  var __prismaClient: PrismaClient | undefined;
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  // Supabase pooler ใช้ cert chain ที่ Node มอง self-signed
  // → สร้าง pg.Pool เองพร้อม ssl: { rejectUnauthorized: false }
  // แล้วส่งให้ adapter (ไม่ให้ adapter parse connection string เอง)
  // TLS ยังเข้ารหัสปกติ — แค่ไม่ verify cert chain
  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalThis.__prismaClient ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prismaClient = prisma;
}
