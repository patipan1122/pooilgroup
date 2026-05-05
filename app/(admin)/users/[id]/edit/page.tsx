import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { BackButton } from "@/components/ui/back-button";
import { adminClient } from "@/lib/db/server";
import { EditUserForm } from "./edit-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditUserPage({ params }: Props) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await params;
  const admin = adminClient();

  const { data: user } = await admin
    .from("users")
    .select("id, name, email, phone, role, is_active")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!user) notFound();

  const { data: branchLinks } = await admin
    .from("user_branches")
    .select("branch_id")
    .eq("user_id", id)
    .eq("is_active", true);

  const { data: allBranches } = await admin
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .order("code");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-3">
        <BackButton label="กลับ" fallbackHref={`/users/${id}`} />
      </div>

      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold">
          แก้ไขผู้ใช้
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          {user.name}
        </h1>
      </header>

      <EditUserForm
        userId={user.id}
        initial={{
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
        }}
        initialBranchIds={(branchLinks ?? []).map((b) => b.branch_id)}
        branches={allBranches ?? []}
        isSelf={user.id === session.user.id}
      />
    </div>
  );
}
