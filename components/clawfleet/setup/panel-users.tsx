"use client";

// PanelUsers — table of users with ClawFleet branch access.
// Shows role + branch chips + last login.
// Add-user goes to Pool central user management; per-row "สลับสิทธิ์" stub.

import Link from "next/link";
import { Users, UserPlus, ShieldCheck, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";

interface User {
  id: string;
  name: string;
  email: string | null;
  role: string;
  lastLoginAt: string | null;
  branches: { id: string; name: string; code: string }[];
}

export interface PanelUsersProps {
  users: User[];
  branches: { id: string; name: string; code: string }[];
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  admin: "Admin",
  area_manager: "Area Manager",
  branch_manager: "ผู้จัดการสาขา",
  staff: "พนักงาน",
  viewer: "Viewer",
};

const ROLE_TONE: Record<string, "danger" | "warning" | "info" | "neutral" | "success"> = {
  super_admin: "danger",
  org_admin: "warning",
  admin: "warning",
  area_manager: "info",
  branch_manager: "info",
  staff: "neutral",
  viewer: "neutral",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "วันนี้";
  if (days === 1) return "เมื่อวาน";
  if (days < 30) return `${days} วันก่อน`;
  return `${Math.floor(days / 30)} เดือนก่อน`;
}

export function PanelUsers({ users, branches }: PanelUsersProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-zinc-900">
              ผู้ใช้ที่เข้าถึง ClawFleet
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {users.length} คน · ครอบ {branches.length} สาขา
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin/users"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              <ExternalLink className="size-3.5" /> ระบบผู้ใช้กลาง
            </Link>
            <Link
              href="/admin/users/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <UserPlus className="size-3.5" /> เพิ่มผู้ใช้
            </Link>
          </div>
        </header>

        {users.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 p-10 text-center">
            <Users className="mx-auto size-8 text-zinc-300" />
            <p className="mt-3 text-sm font-semibold text-zinc-900">
              ยังไม่มีผู้ใช้ที่ผูกกับสาขา ClawFleet
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              ผู้ใช้ต้องผูกสาขา businessType=claw_machine ในระบบผู้ใช้กลางก่อน
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="text-left text-xs text-zinc-500">
                  <th className="px-4 py-2.5 font-medium">ชื่อ</th>
                  <th className="px-4 py-2.5 font-medium">สิทธิ์</th>
                  <th className="px-4 py-2.5 font-medium">สาขาที่ดูแล</th>
                  <th className="px-4 py-2.5 font-medium">เข้าระบบล่าสุด</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-900">{u.name}</div>
                      <div className="text-xs text-zinc-500">{u.email ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={ROLE_TONE[u.role] ?? "neutral"}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {u.branches.length === 0 ? (
                        <StatusPill tone="warning" dot size="xs">
                          ไม่มีสาขา
                        </StatusPill>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.branches.slice(0, 4).map((b) => (
                            <span
                              key={b.id}
                              className="inline-flex h-6 items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 text-xs text-zinc-700"
                              title={b.code}
                            >
                              {b.name}
                            </span>
                          ))}
                          {u.branches.length > 4 && (
                            <span className="inline-flex h-6 items-center rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-500">
                              +{u.branches.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-zinc-600">
                      {timeAgo(u.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          /* TODO[claude-design]: stub — opens role picker */
                          alert(
                            `สลับสิทธิ์ ${u.name} — ใช้ระบบผู้ใช้กลางที่ /admin/users/${u.id}`,
                          );
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                      >
                        <ShieldCheck className="size-3.5" /> สลับสิทธิ์
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="px-2 text-xs text-zinc-500">
        การเพิ่ม/ลบผู้ใช้และ branch-access เต็มรูปแบบ ทำที่{" "}
        <Link
          href="/admin/users"
          className="font-semibold text-blue-600 hover:underline"
        >
          ระบบผู้ใช้กลาง
        </Link>{" "}
        · ที่นี่แสดงเฉพาะ snapshot
      </p>
    </div>
  );
}
