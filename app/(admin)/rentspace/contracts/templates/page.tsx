import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { RsPage, RsHeader, RsBackLink } from "@/components/rentspace/ui";
import { listTemplates } from "@/lib/rentspace/data";
import { TemplateEditor } from "./_components/template-editor";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) redirect("/403");

  const templates = await listTemplates(session.user.org_id);

  return (
    <RsPage>
      <RsBackLink href="/rentspace/contracts" label="กลับรายการสัญญา" />
      <RsHeader
        title="แม่แบบสัญญา"
        subtitle="สร้างแม่แบบไว้ใช้ซ้ำ — ระบบเติมชื่อผู้เช่า ค่าเช่า และวันที่ให้อัตโนมัติเมื่อทำสัญญา"
      />
      <TemplateEditor
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          bodyHtml: t.bodyHtml,
          isDefault: t.isDefault,
        }))}
      />
    </RsPage>
  );
}
