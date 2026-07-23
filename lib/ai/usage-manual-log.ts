// บันทึกคำถามที่ผู้ช่วย AI ตอบไม่ได้ กลับเข้า Google Sheet "คำถามที่ผู้ช่วยตอบไม่ได้"
// ใช้ Google Service Account เซ็น JWT เองด้วย Node crypto (ไม่เพิ่ม npm package ใหม่)
// ถ้ายังไม่ตั้งค่า env หรือเขียนพลาด — แค่ log แล้วปล่อยผ่าน ห้ามทำให้แชทของ user พังเด็ดขาด

import { createSign } from "crypto";

const UNANSWERED_SHEET_ID = "1r0MuJyoV2LzXTkm_6dWtI-jGHiLhF8r6e4ncbsCWnJ8";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(): Promise<string | null> {
  const email = process.env.USAGE_MANUAL_SHEETS_SA_EMAIL;
  const rawKey = process.env.USAGE_MANUAL_SHEETS_SA_PRIVATE_KEY;
  if (!email || !rawKey) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: email,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signInput = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signInput);
  signer.end();
  const signature = base64url(signer.sign(privateKey));
  const jwt = `${signInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    console.error("[usage-manual-log] token exchange failed", await res.text());
    return null;
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

/** บันทึก 1 แถวเข้า Sheet คำถามที่ตอบไม่ได้ — fire-and-forget โดย caller, ไม่ throw ออกไปนอกฟังก์ชันนี้ */
export async function logUnansweredQuestion(entry: {
  program: string;
  page: string;
  question: string;
  role: string;
}): Promise<void> {
  try {
    const token = await getAccessToken();
    if (!token) return; // ยังไม่ตั้งค่า service account — ข้ามเงียบๆ

    const today = new Date().toISOString().slice(0, 10);
    const row = [today, entry.program, entry.page, entry.question, entry.role, "ใหม่", ""];

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${UNANSWERED_SHEET_ID}/values/A:G:append?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [row] }),
    });
    if (!res.ok) {
      console.error("[usage-manual-log] append failed", res.status, await res.text());
    }
  } catch (err) {
    console.error("[usage-manual-log] unexpected error", err);
  }
}
