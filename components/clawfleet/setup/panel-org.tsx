"use client";

// PanelOrg — organization-level config + LINE / cron status.
// Org name + slug are read-only here (admin elsewhere).
// "ส่งทดสอบ LINE" button hits a stub action.

import { useState, useTransition } from "react";
import {
  Building2,
  Send,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";

interface OrgConfig {
  id: string;
  name: string;
  slug: string;
  lineOaId: string | null;
  telegramChatId: string | null;
  cronSecretSet: boolean;
}

export interface PanelOrgProps {
  orgConfig: OrgConfig;
}

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

export function PanelOrg({ orgConfig }: PanelOrgProps) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [defaultBranch, setDefaultBranch] = useState("");

  function sendTestLine() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      try {
        // TODO[claude-design]: hook to /api/clawfleet/test-line or similar.
        await new Promise((res) => setTimeout(res, 400));
        if (!orgConfig.lineOaId) {
          setStatus({
            kind: "err",
            msg: "ยังไม่ได้ผูก LINE OA · ติดต่อทีม dev",
          });
          return;
        }
        setStatus({
          kind: "ok",
          msg: `ส่งแล้ว → LINE OA ${orgConfig.lineOaId}`,
        });
      } catch (e) {
        setStatus({ kind: "err", msg: (e as Error).message });
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Org block */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <header className="mb-5 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Building2 className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-zinc-900">บัญชีองค์กร</h2>
            <p className="text-sm text-zinc-500">
              ข้อมูลที่ใช้ทั่วทุก ClawFleet ของบริษัท
            </p>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="ชื่อองค์กร"
            hint="เปลี่ยนที่ระบบกลาง · แสดงในรายงาน + LINE"
          >
            <Input value={orgConfig.name} readOnly disabled />
          </Field>
          <Field label="Slug" hint="ใช้กับ URL · ห้ามเปลี่ยนเอง">
            <Input value={orgConfig.slug} readOnly disabled />
          </Field>
          <Field
            label="สาขาเริ่มต้น (default branch)"
            hint="สาขาที่จะถูกเลือกอัตโนมัติเมื่อเปิดหน้า"
          >
            <Input
              placeholder="ไม่กำหนด — เลือกในแต่ละหน้า"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
            />
          </Field>
        </div>
      </section>

      {/* LINE / Telegram */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <header className="mb-5 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <MessageSquare className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-zinc-900">แจ้งเตือน</h2>
            <p className="text-sm text-zinc-500">
              LINE OA สำหรับส่ง anomaly · tolerance-change alert
            </p>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="LINE OA ID">
            <div className="flex items-center gap-2">
              <Input
                value={orgConfig.lineOaId ?? "ไม่ได้ผูก"}
                readOnly
                disabled
              />
              {orgConfig.lineOaId ? (
                <StatusPill tone="success" dot size="sm">
                  เชื่อมแล้ว
                </StatusPill>
              ) : (
                <StatusPill tone="danger" dot size="sm">
                  ไม่ได้ผูก
                </StatusPill>
              )}
            </div>
          </Field>
          <Field label="Telegram Chat ID (สำรอง)">
            <div className="flex items-center gap-2">
              <Input
                value={orgConfig.telegramChatId ?? "ไม่ได้ผูก"}
                readOnly
                disabled
              />
              {orgConfig.telegramChatId ? (
                <StatusPill tone="success" dot size="sm">
                  เชื่อมแล้ว
                </StatusPill>
              ) : (
                <StatusPill tone="neutral" dot size="sm">
                  ปิด
                </StatusPill>
              )}
            </div>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
          <div className="text-sm">
            {status.kind === "ok" && (
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="size-4" /> {status.msg}
              </span>
            )}
            {status.kind === "err" && (
              <span className="inline-flex items-center gap-1.5 text-rose-700">
                <AlertTriangle className="size-4" /> {status.msg}
              </span>
            )}
            {status.kind === "idle" && (
              <span className="text-xs text-zinc-500">
                ทดสอบส่งข้อความเข้า LINE OA ที่ผูกอยู่
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={sendTestLine}
            loading={pending}
          >
            <Send className="size-4" /> ส่งทดสอบ LINE
          </Button>
        </div>
      </section>

      {/* Cron secret */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <header className="mb-5 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
            <KeyRound className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-zinc-900">Cron secret</h2>
            <p className="text-sm text-zinc-500">
              env ที่ปกป้อง /api/cron/* — แก้ผ่าน Vercel dashboard
            </p>
          </div>
        </header>

        <div className="flex items-center gap-3 rounded-xl bg-zinc-50 p-4">
          {orgConfig.cronSecretSet ? (
            <>
              <CheckCircle2 className="size-5 text-emerald-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-zinc-900">
                  CRON_SECRET พร้อมใช้งาน
                </p>
                <p className="text-xs text-zinc-500">
                  cron 5 ตัว (photo-retention · session-autoclose ·
                  silent-machines · day-end · handover-stale) ทำงานปกติ
                </p>
              </div>
              <StatusPill tone="success" dot>
                ✓ พร้อม
              </StatusPill>
            </>
          ) : (
            <>
              <AlertTriangle className="size-5 text-rose-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-rose-900">
                  CRON_SECRET ไม่ได้ตั้ง
                </p>
                <p className="text-xs text-rose-700">
                  เพิ่มที่ Vercel → Project → Settings → Environment Variables
                </p>
              </div>
              <StatusPill tone="danger" dot>
                ✗ ขาด
              </StatusPill>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
