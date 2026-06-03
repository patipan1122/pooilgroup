import { randomBytes } from "node:crypto";

// token เดาไม่ได้ สำหรับลิงก์ใบเสนอราคา (bearer) — crypto-strong
export function genToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

function be2(): string {
  // ปี พ.ศ. 2 หลัก + เดือน 2 หลัก
  const now = new Date();
  const beYear = (now.getFullYear() + 543) % 100;
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${String(beYear).padStart(2, "0")}${mm}`;
}

function rand4(): string {
  return randomBytes(3).toString("hex").slice(0, 4).toUpperCase();
}

export function genQuoteNo(): string {
  return `QT-${be2()}-${rand4()}`;
}

export function genOrderNo(): string {
  return `SO-${be2()}-${rand4()}`;
}
