import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-50">
      <div className="text-center max-w-sm">
        <div className="text-6xl mb-3">🚫</div>
        <h1 className="text-2xl font-semibold font-display mb-2">
          ไม่มีสิทธิ์เข้าถึง
        </h1>
        <p className="text-sm text-zinc-500 mb-6">
          บัญชีของคุณไม่ได้รับอนุญาตให้เปิดหน้านี้
          ติดต่อผู้ดูแลถ้าต้องการเข้าใช้งาน
        </p>
        <Link href="/">
          <Button variant="primary" size="lg">
            กลับหน้าหลัก
          </Button>
        </Link>
      </div>
    </div>
  );
}
