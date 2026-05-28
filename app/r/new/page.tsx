// /r/new — Public ticket creation (no auth required).
import { adminClient } from "@/lib/db/server";
import { PublicRepairForm } from "@/components/repair/public-form";

export const dynamic = "force-dynamic";

interface BranchRow {
  id: string;
  name: string;
  code: string;
  business_type: string;
  company_id: string;
}
interface CompanyRow {
  id: string;
  name: string;
  code: string;
}
interface CategoryRow {
  id: string;
  slug: string;
  label: string;
  emoji: string | null;
  default_urgency: "URGENT" | "NORMAL" | "LOW";
}

export default async function RepairPublicNewPage() {
  // Public form needs branches/companies/categories — fetched via adminClient
  // (no session). RLS would block these for anon, so we use service-role bypass.
  const admin = adminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs } = await (admin.from as any)("organizations")
    .select("id, name")
    .eq("is_active", true)
    .limit(1);
  const org = (orgs?.[0] as { id: string; name: string } | undefined) ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: companies } = await (admin.from as any)("companies")
    .select("id, name, code")
    .eq("is_active", true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: branches } = await (admin.from as any)("branches")
    .select("id, name, code, business_type, company_id")
    .eq("is_active", true)
    .order("name");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: categories } = await (admin.from as any)("repair_categories")
    .select("id, slug, label, emoji, default_urgency")
    .eq("is_active", true)
    .order("sort_order");

  return (
    <PublicRepairForm
      orgName={org?.name ?? "Pooilgroup"}
      companies={(companies as CompanyRow[] | null) ?? []}
      branches={(branches as BranchRow[] | null) ?? []}
      categories={(categories as CategoryRow[] | null) ?? []}
    />
  );
}
