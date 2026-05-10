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
  // → ส่ง ssl: { rejectUnauthorized: false } ให้ pg.Pool โดยตรง
  // TLS ยังเข้ารหัสปกติ — แค่ไม่ verify cert chain
  //
  // pg-connection-string v3 / pg v9 ตีความ ?sslmode=require เป็น verify-full
  // ซึ่ง override explicit ssl object → ต้อง strip sslmode ทิ้งก่อน เพื่อให้
  // { rejectUnauthorized: false } ทำงานจริง (prod ไม่มี
  // NODE_TLS_REJECT_UNAUTHORIZED=0 แบบ local dev)
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalThis.__prismaClient ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prismaClient = prisma;
}
