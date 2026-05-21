// Create new spare part — OFFICE+
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/chairops/ui/card";
import { NewPartForm } from "./new-part-form";

export default async function NewPartPage() {
  await requireRole("OFFICE");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/chairops/parts" className="text-sm text-muted-foreground hover:underline">
          ← กลับรายการอะไหล่
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">เพิ่มอะไหล่ใหม่</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ข้อมูลอะไหล่</CardTitle>
        </CardHeader>
        <CardContent>
          <NewPartForm />
        </CardContent>
      </Card>
    </div>
  );
}
