// Playland · ยืนยันตัวตน agent ของเครื่องพิมพ์ (header, ไม่ใช่ query string · เก็บเฉพาะ hash ในฐานข้อมูล)
// ไฟล์นี้ไม่ใช่ "use server" (ใช้ใน API route) · ห้ามเอารหัสลับจริงไปเก็บใน DB

import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export function hashPrinterSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function newPrinterSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashPrinterSecret(secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface AuthedPrinter {
  id: string;
  orgId: string;
  branchId: string;
  code: string;
  lastSeenAt: Date | null;
}

// รหัสเครื่องไม่มี/ผิด/รหัสลับผิด → 401 เหมือนกันหมด (ไม่บอกว่ามีเครื่องนี้อยู่จริงไหม)
export async function authenticatePrinter(req: NextRequest): Promise<{ printer: AuthedPrinter } | { error: NextResponse }> {
  const code = req.headers.get("x-printer-code")?.trim() ?? "";
  const secret = req.headers.get("x-printer-secret") ?? "";
  const deny = { error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  if (!code || !secret) return deny;

  const printer = await prisma.playlandPrinter.findUnique({
    where: { code },
    select: { id: true, orgId: true, branchId: true, code: true, secretHash: true, enabled: true, lastSeenAt: true },
  });
  if (!printer || !printer.enabled || !secretMatches(secret, printer.secretHash)) return deny;
  return { printer: { id: printer.id, orgId: printer.orgId, branchId: printer.branchId, code: printer.code, lastSeenAt: printer.lastSeenAt } };
}
