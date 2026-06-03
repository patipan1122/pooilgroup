import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// hash = salt(hex):derived(hex)  — scrypt, ไม่ต้องพึ่ง native bcrypt
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, salt, 64);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
