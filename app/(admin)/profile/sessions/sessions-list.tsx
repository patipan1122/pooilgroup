"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Monitor, Smartphone, Tablet, LogOut, ShieldX, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { bkkDateTime } from "@/lib/utils/format";

interface SessionRow {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  device: string | null;
  login_at: string;
  last_active_at: string;
  logout_at: string | null;
  is_revoked: boolean;
}

function deviceIcon(device: string | null) {
  if (!device) return <Monitor className="size-5" />;
  if (/iOS|Android/i.test(device)) return <Smartphone className="size-5" />;
  if (/iPad/i.test(device)) return <Tablet className="size-5" />;
  return <Monitor className="size-5" />;
}

export function SessionsList({ rows }: { rows: SessionRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [revoking, setRevoking] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="size-8" />}
        title="ยังไม่มีประวัติการ Login"
        description="หลังจากนี้การ login จากอุปกรณ์ใดๆ จะแสดงขึ้นที่นี่"
      />
    );
  }

  function revoke(id: string) {
    setRevoking(id);
    startTransition(async () => {
      const res = await fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "ปลด session ไม่สำเร็จ");
        setRevoking(null);
        return;
      }
      toast.success("ออกจากระบบ session นี้แล้ว");
      setRevoking(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {rows.map((s) => {
        const isActive = !s.logout_at && !s.is_revoked;
        const status = s.is_revoked
          ? { label: "ถูกปลด", tone: "danger" as const }
          : s.logout_at
            ? { label: "ออกแล้ว", tone: "neutral" as const }
            : { label: "ใช้งานอยู่", tone: "success" as const };

        return (
          <Card key={s.id} className="animate-fade-up">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <span className="text-zinc-600">{deviceIcon(s.device)}</span>
                <span className="text-base">
                  {s.device || "อุปกรณ์ไม่ทราบ"}
                </span>
              </CardTitle>
              <Badge tone={status.tone}>{status.label}</Badge>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-y-1 gap-x-4 text-xs">
                <div>
                  <span className="text-zinc-500">เข้าใช้:</span>{" "}
                  <span className="font-medium">{bkkDateTime(s.login_at)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">ใช้ครั้งล่าสุด:</span>{" "}
                  <span className="font-medium">{bkkDateTime(s.last_active_at)}</span>
                </div>
                {s.logout_at && (
                  <div>
                    <span className="text-zinc-500">ออกเมื่อ:</span>{" "}
                    <span className="font-medium">{bkkDateTime(s.logout_at)}</span>
                  </div>
                )}
                {s.ip_address && (
                  <div>
                    <span className="text-zinc-500">IP:</span>{" "}
                    <span className="font-mono">{s.ip_address}</span>
                  </div>
                )}
              </div>

              {isActive && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revoke(s.id)}
                    disabled={pending && revoking === s.id}
                    loading={pending && revoking === s.id}
                  >
                    <LogOut className="size-4" />
                    ออกจากระบบที่นี่
                  </Button>
                </div>
              )}
              {s.is_revoked && (
                <p className="text-xs text-red-600 flex items-center gap-1.5 pt-1">
                  <ShieldX className="size-3.5" />
                  Admin ปลด session นี้
                </p>
              )}
            </CardBody>
          </Card>
        );
      })}

      <p className="text-xs text-zinc-400 text-center pt-2">
        แสดง 50 session ล่าสุดเท่านั้น
      </p>
    </div>
  );
}
