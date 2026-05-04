import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_TYPES } from "@/constants/business-types";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  const session = await requireSession();
  const admin = adminClient();

  const { data: branches } = await admin
    .from("branches")
    .select("id, code, name, business_type, province, is_active, manager_id")
    .eq("org_id", session.user.org_id)
    .order("code");

  const list = branches ?? [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight font-display">
            สาขา
          </h1>
          <p className="text-zinc-600 mt-1 text-sm">
            ทั้งหมด {list.filter((b) => b.is_active).length} สาขา ที่ใช้งานอยู่
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการสาขา</CardTitle>
        </CardHeader>
        <CardBody className="!pt-0">
          <div className="divide-y divide-zinc-100">
            {list.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-zinc-500">
                  ยังไม่มีสาขา — เพิ่มสาขาเริ่มต้นจาก seed หรือ CSV import
                </p>
              </div>
            )}
            {list.map((b) => {
              const cfg = BUSINESS_TYPES[b.business_type];
              return (
                <Link
                  key={b.id}
                  href={`/cashhub?branchId=${b.id}`}
                  className="flex items-center gap-3 py-3 hover:bg-zinc-50 -mx-2 px-2 rounded-xl transition-colors"
                >
                  <div className="text-2xl shrink-0">{cfg?.emoji || "📋"}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{b.code}</span>
                      {!b.is_active && (
                        <Badge tone="neutral">ปิดอยู่</Badge>
                      )}
                    </div>
                    <div className="text-sm text-zinc-600 truncate">
                      {b.name}
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5 flex items-center gap-2">
                      <span>{cfg?.label}</span>
                      {b.province && <span>· {b.province}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
