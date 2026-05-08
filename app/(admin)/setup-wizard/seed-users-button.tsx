"use client";

// Client-side trigger for /api/dev/seed-test-users.
//
// Why a separate component: the call may take 5–20s on a 30-branch org
// (creates 60+ Supabase auth users) so we need spinner + result rendering.
// Lives next to the setup wizard so CEO sees it right after creating branches.

import { useState, useTransition } from "react";
import { Loader2, UserCog, Copy, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SeededUser {
  role: string;
  name: string;
  email: string;
  password: string;
  branchCode?: string;
  status: "created" | "skipped_exists";
}

interface SeedResult {
  summary: {
    created: number;
    skipped: number;
    errors: number;
    branches: number;
    defaultPassword: string;
    emailDomain: string;
    note: string;
  };
  users: SeededUser[];
  errors: string[];
}

const ROLE_LABEL: Record<string, string> = {
  org_admin: "Org Admin (HR/IT)",
  admin: "Admin (mid)",
  area_manager: "ผจก. เขต",
  branch_manager: "ผจก. สาขา",
  staff: "พนักงาน",
  viewer: "ทีมบัญชี (read)",
};

export function SeedUsersButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SeedResult | null>(null);
  const [perBranch, setPerBranch] = useState(true);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  function trigger() {
    if (pending) return;
    if (
      !confirm(
        "ยืนยันสร้างบัญชีทดสอบ?\n\nระบบจะสร้าง user ทดสอบทุก role (org_admin, admin, area_manager, branch_manager × ทุกสาขา, staff × ทุกสาขา, viewer)\n\nบัญชีที่มีอยู่แล้วจะถูกข้าม (idempotent)",
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/dev/seed-test-users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ perBranch }),
        });
        const json = (await res.json()) as SeedResult & { error?: string };
        if (!res.ok) {
          toast.error(json.error || "Seed test users ไม่สำเร็จ");
          return;
        }
        setResult(json);
        toast.success(
          `สร้างบัญชี ${json.summary.created} (ข้าม ${json.summary.skipped})`,
        );
      } catch {
        toast.error("เน็ตหลุด ลองใหม่");
      }
    });
  }

  function copyEmail(email: string) {
    navigator.clipboard.writeText(email);
    setCopiedEmail(email);
    toast.success("Copy email แล้ว");
    setTimeout(() => setCopiedEmail(null), 2000);
  }

  function copyAll() {
    if (!result) return;
    const lines = result.users.map(
      (u) =>
        `${ROLE_LABEL[u.role] ?? u.role}\t${u.email}\t${u.password}\t${u.branchCode ?? ""}\t${u.status}`,
    );
    const tsv = ["role\temail\tpassword\tbranch\tstatus", ...lines].join("\n");
    navigator.clipboard.writeText(tsv);
    toast.success("Copy รายชื่อทั้งหมด (TSV — paste ลง Excel/Sheets ได้)");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm">
        <p className="flex items-start gap-2 text-amber-900">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            <b>เครื่องมือทดสอบ — ห้ามใช้บน production จริง</b>
            <br />
            สร้างบัญชี user ทดสอบครบทุก role เพื่อให้ CEO/QA เดินทดสอบ flow ทุกบทบาทได้ใน 1 คลิก ·
            ทุกบัญชีใช้ password เดียว: <code className="px-1.5 py-0.5 rounded bg-white border border-amber-300 font-mono">Pooil2026!</code> · เปลี่ยนได้ภายหลัง
          </span>
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={perBranch}
          onChange={(e) => setPerBranch(e.target.checked)}
          className="size-4 rounded border-zinc-300"
        />
        <span>
          สร้าง <b>branch_manager + staff</b> ครบทุกสาขา (ปิดถ้าสาขาเยอะมากแล้วยังไม่อยาก spam auth)
        </span>
      </label>

      <div>
        <Button onClick={trigger} disabled={pending} className="w-full sm:w-auto">
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              กำลังสร้างบัญชีทดสอบ...
            </>
          ) : (
            <>
              <UserCog className="size-4" />
              สร้างบัญชีทดสอบครบทุก role
            </>
          )}
        </Button>
      </div>

      {result && (
        <div className="rounded-xl border-2 border-zinc-200 bg-white p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-bold text-zinc-900">
                สร้าง {result.summary.created} · ข้าม {result.summary.skipped}{" "}
                {result.summary.errors > 0 && (
                  <span className="text-red-600">
                    · ผิด {result.summary.errors}
                  </span>
                )}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                ครอบคลุม {result.summary.branches} สาขา · password ทุกบัญชี:{" "}
                <code className="px-1.5 py-0.5 rounded bg-zinc-100 font-mono">
                  {result.summary.defaultPassword}
                </code>
              </p>
            </div>
            <Button variant="outline" onClick={copyAll}>
              <Copy className="size-4" />
              Copy ทั้งหมด (TSV)
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="text-left p-2 font-bold text-zinc-700">Role</th>
                  <th className="text-left p-2 font-bold text-zinc-700">ชื่อ</th>
                  <th className="text-left p-2 font-bold text-zinc-700">Email</th>
                  <th className="text-left p-2 font-bold text-zinc-700">สาขา</th>
                  <th className="text-left p-2 font-bold text-zinc-700">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {result.users.map((u) => (
                  <tr
                    key={u.email}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="p-2 font-medium text-zinc-900">
                      {ROLE_LABEL[u.role] ?? u.role}
                    </td>
                    <td className="p-2 text-zinc-700">{u.name}</td>
                    <td className="p-2 font-mono text-zinc-700">
                      <button
                        type="button"
                        onClick={() => copyEmail(u.email)}
                        className="inline-flex items-center gap-1.5 hover:text-[var(--color-brand-700)]"
                        title="Copy email"
                      >
                        {u.email}
                        {copiedEmail === u.email ? (
                          <Check className="size-3 text-green-600" />
                        ) : (
                          <Copy className="size-3 opacity-40" />
                        )}
                      </button>
                    </td>
                    <td className="p-2 text-zinc-600">{u.branchCode ?? "—"}</td>
                    <td className="p-2">
                      {u.status === "created" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[11px] font-bold">
                          new
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 text-[11px] font-bold">
                          มีอยู่แล้ว
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.errors.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-red-600 font-bold">
                ⚠️ ผิดพลาด {result.errors.length} รายการ (กดดู)
              </summary>
              <ul className="mt-2 space-y-1 text-red-700 font-mono">
                {result.errors.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
