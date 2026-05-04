import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { redirect } from "next/navigation";

export default async function LiffReportEntryPage() {
  const session = await requireSession();
  const admin = adminClient();

  // Find branches assigned to this user
  const { data: ub } = await admin
    .from("user_branches")
    .select("branch_id, branches(id, code, name, business_type, is_active)")
    .eq("user_id", session.user.id)
    .eq("is_active", true);

  const branches: { id: string; code: string; name: string; is_active: boolean }[] = [];
  for (const u of ub ?? []) {
    const b = Array.isArray(u.branches) ? u.branches[0] : u.branches;
    if (b) branches.push(b as { id: string; code: string; name: string; is_active: boolean });
  }

  const activeBranches = branches.filter((b) => b.is_active);

  // 1 branch → redirect direct
  if (activeBranches.length === 1) {
    redirect(`/liff/report/${activeBranches[0]!.id}`);
  }

  // None → message
  if (activeBranches.length === 0) {
    return (
      <div className="p-6 max-w-md mx-auto text-center">
        <div className="text-5xl mb-4">🤷‍♀️</div>
        <h1 className="font-semibold text-lg mb-2">บัญชียังไม่ได้ผูกสาขา</h1>
        <p className="text-sm text-zinc-500 mb-6">
          กรุณาติดต่อผู้ดูแลให้กำหนดสาขาให้คุณ
        </p>
      </div>
    );
  }

  // Multiple → choose
  return (
    <div className="p-4 max-w-md mx-auto safe-top safe-bottom">
      <h1 className="text-xl font-semibold font-display mb-1">
        เลือกสาขาที่จะกรอก
      </h1>
      <p className="text-sm text-zinc-500 mb-4">
        คุณดูแล {activeBranches.length} สาขา
      </p>
      <div className="space-y-2">
        {activeBranches.map((b) => (
          <Link
            key={b.id}
            href={`/liff/report/${b.id}`}
            className="block bg-white rounded-2xl border border-zinc-200 px-4 py-4 hover:border-[--color-brand-300] hover:bg-[--color-brand-50]/30 transition-colors shadow-soft"
          >
            <div className="font-medium">{b.code}</div>
            <div className="text-sm text-zinc-500">{b.name}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
