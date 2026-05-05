// /admin/companies/[id]/edit — edit form

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { CompanyEditForm } from "./edit-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditCompanyPage({ params }: Props) {
  const session = await requireRole("super_admin", "org_admin");
  const { id } = await params;
  const admin = adminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: company } = await (admin.from as any)("companies")
    .select("id, code, name, tax_id, address, phone, logo_url, brand_color, is_active")
    .eq("id", id)
    .eq("org_id", session.user.org_id)
    .maybeSingle();

  if (!company) notFound();

  return (
    <div className="p-4 sm:p-8 lg:p-12 max-w-2xl mx-auto pb-24">
      <Link
        href={`/companies/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-[--color-brand-700]"
      >
        <ChevronLeft className="size-4" />
        กลับไปหน้ารายละเอียด
      </Link>

      <header className="mt-4 mb-10 animate-slide-up-soft">
        <p className="text-[11px] uppercase tracking-[0.22em] font-bold text-[--color-brand-700]">
          แก้ไข · {company.code}
        </p>
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.04em] font-display mt-3 leading-[0.95]">
          <span className="text-gradient-blue">{company.name}</span>
        </h1>
      </header>

      <CompanyEditForm company={company} />
    </div>
  );
}
