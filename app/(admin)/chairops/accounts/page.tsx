// Bank accounts master · OFFICE+ · CRUD via inline forms
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountsTable } from "./accounts-table";
import { NewAccountForm } from "./new-account-form";

export default async function AccountsPage() {
  await requireRole("OFFICE");

  const [accounts, branches] = await Promise.all([
    prisma.chairopsBankAccount.findMany({
      orderBy: [{ isActive: "desc" }, { bankName: "asc" }],
    }),
    prisma.chairopsBranch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const branchById = new Map(branches.map((b) => [b.id, b.name]));

  const items = accounts.map((a) => ({
    id: a.id,
    bankName: a.bankName,
    accountNo: a.accountNo,
    accountName: a.accountName,
    branchId: a.branchId,
    branchName: a.branchId ? branchById.get(a.branchId) ?? null : null,
    notes: a.notes,
    isActive: a.isActive,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">บัญชีที่ใช้</h1>
        <p className="text-sm text-muted-foreground">
          บัญชีธนาคารสำหรับฝากเงินจากแม่บ้าน · ทั้งหมด {accounts.length} บัญชี
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">รายการบัญชี</CardTitle>
            </CardHeader>
            <CardBody>
              <AccountsTable items={items} branches={branches} />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">เพิ่มบัญชีใหม่</CardTitle>
          </CardHeader>
          <CardBody>
            <NewAccountForm branches={branches} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
