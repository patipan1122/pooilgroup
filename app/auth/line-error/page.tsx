// Shown when LINE OAuth flow fails (state mismatch, token exchange error,
// LINE-denied, etc). Surfaces the reason + detail so we can debug, and offers
// a "ลองใหม่" button that restarts the OAuth flow.

export const dynamic = "force-dynamic";

const REASON_TH: Record<string, string> = {
  "line-denied": "ผู้ใช้ไม่ยอมรับการเข้าสู่ระบบที่ LINE",
  "missing-code": "ไม่ได้รับ code จาก LINE",
  "state-mismatch": "state cookie ไม่ตรง (อาจหมดเวลาหรือเปิดในแท็บอื่น)",
  "server-config": "ตั้งค่าฝั่ง server ไม่ครบ (env channel id/secret)",
  "token-exchange": "แลก code เป็น token ไม่สำเร็จ",
  "token-fetch": "ติดต่อ LINE token endpoint ไม่ได้",
  "no-id-token": "LINE ไม่ส่ง id_token กลับมา",
  "login-api": "/api/auth/line-login ตอบ error",
  "login-fetch": "ติดต่อ /api/auth/line-login ไม่ได้",
  unexpected: "ตอบกลับไม่คาดคิดจาก server",
};

export default async function LineAuthError({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const reason = sp.reason ?? "unknown";
  const detail = sp.detail ?? "";
  const reasonLabel = REASON_TH[reason] ?? reason;

  return (
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto max-w-sm space-y-4 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-rose-100 text-2xl">
          ⚠️
        </div>
        <p className="text-base font-semibold text-zinc-800">
          เข้าสู่ระบบ LINE ไม่สำเร็จ
        </p>
        <p className="text-sm text-zinc-600">{reasonLabel}</p>
        {detail && (
          <pre className="select-all whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-left font-mono text-xs text-zinc-700">
            {detail}
          </pre>
        )}
        <a
          href="/auth/line-start"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold text-white active:bg-emerald-700"
        >
          ลองใหม่
        </a>
      </div>
    </div>
  );
}
