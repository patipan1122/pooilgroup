// Success page after the LIFF-SDK-free OAuth claim binds the LINE login identity
// (app/auth/line-callback handles the bind for iOS where liff.init "Load failed").
// No LIFF, no session needed — just a calm confirmation + what to do next.

export const dynamic = "force-dynamic";

export default function LineClaimedPage() {
  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-sm flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-emerald-100 text-3xl">
        ✅
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-bold text-zinc-900">ผูกบัญชีเรียบร้อย</h1>
        <p className="text-sm leading-relaxed text-zinc-500">
          ระบบรู้จักคุณแล้วทุกช่องทาง — ปิดหน้านี้ แล้วกลับไปกดปุ่ม
          <span className="font-medium text-zinc-700"> “แก้ไข” </span>
          หรือเมนูจัดการในไลน์ได้เลย
        </p>
      </div>
      <p className="text-xs text-zinc-400">ปิดหน้านี้ได้เลย (มุมขวาบน)</p>
    </div>
  );
}
