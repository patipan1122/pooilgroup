// Shown after a successful LINE OAuth login when the LINE user is verified
// but not yet bound to a Pool / ChairOps account. Surfaces the verified LINE
// ID so the office can bind it via /chairops/users/[id].

export const dynamic = "force-dynamic";

import { CopyLineIdButton } from "./copy-button";

export default async function LineAuthPending({
  searchParams,
}: {
  searchParams: Promise<{ lineUserId?: string; name?: string }>;
}) {
  const sp = await searchParams;
  const lineUserId = sp.lineUserId ?? "";
  const name = sp.name ?? "";

  return (
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto max-w-sm space-y-6 text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-amber-100 text-3xl">
          🔑
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-zinc-900">บัญชียังไม่เปิดใช้งาน</h1>
          <p className="text-sm text-zinc-500">
            แจ้ง LINE ID ด้านล่างให้ออฟฟิศ เพื่อเปิดใช้งานให้คุณ
          </p>
        </div>
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left">
          {name && (
            <>
              <div className="text-xs text-zinc-500">ชื่อ LINE</div>
              <div className="text-sm font-medium text-zinc-800">{name}</div>
            </>
          )}
          <div className="mt-2 text-xs text-zinc-500">
            LINE ID (ส่งให้ออฟฟิศ)
          </div>
          <div className="select-all break-all font-mono text-sm text-zinc-900">
            {lineUserId}
          </div>
        </div>
        <CopyLineIdButton lineUserId={lineUserId} />
      </div>
    </div>
  );
}
