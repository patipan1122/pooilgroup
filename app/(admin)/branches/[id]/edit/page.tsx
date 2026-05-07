import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { BackButton } from "@/components/ui/back-button";
import { adminClient } from "@/lib/db/server";
import { BranchForm } from "../../branch-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditBranchPage({ params }: Props) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const { id } = await params;
  const admin = adminClient();

  const { data: branch } = await admin
    .from("branches")
    .select(
      "id, code, name, business_type, province, region, address, lat, lng, manager_id, line_group_id, phone, report_deadline",
    )
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!branch) notFound();

  const { data: managers } = await admin
    .from("users")
    .select("id, name, role")
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .in("role", ["super_admin", "org_admin", "branch_manager"])
    .order("name");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-3">
        <BackButton label="กลับ" fallbackHref={`/branches/${id}`} />
      </div>

      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold">
          แก้ไขสาขา · {branch.code}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          {branch.name}
        </h1>
      </header>

      <BranchForm
        mode="edit"
        branch={{
          ...branch,
          lat: branch.lat == null ? null : Number(branch.lat),
          lng: branch.lng == null ? null : Number(branch.lng),
        }}
        managers={managers ?? []}
      />
    </div>
  );
}
