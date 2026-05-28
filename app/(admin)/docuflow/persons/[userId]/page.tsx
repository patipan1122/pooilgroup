// DocuFlow · Person doc detail — driver/staff personal docs
// Server component · params is Promise<{userId}> (Next 16)
// Sensitive — admin tier only

import { notFound } from "next/navigation";
import Link from "next/link";
import { FileText, RefreshCw, UserCircle2, ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { Section } from "@/components/ui/section";
import { thaiDateLong } from "@/lib/utils/format";
import { prisma } from "@/lib/prisma";
import { classifyExpiry, type ExpiryStatus } from "@/lib/vehicles/data";
import {
  DfEyebrow,
  DfPill,
  DfSection,
} from "@/components/docuflow/df-ui";
import {
  PERSON_DOC_TYPES,
  PERSON_DOC_TYPE_LABEL,
  PERSON_DOC_TYPE_HINT,
} from "../types";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  admin: "Admin",
  area_manager: "Area Manager",
  branch_manager: "Branch Manager",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};

const STATUS_BADGE: Record<
  ExpiryStatus | "missing",
  { tone: "neutral" | "success" | "warning" | "danger" | "info"; label: string }
> = {
  expired: { tone: "danger", label: "หมดอายุแล้ว" },
  critical: { tone: "danger", label: "ภายใน 7 วัน" },
  urgent: { tone: "warning", label: "ภายใน 30 วัน" },
  watch: { tone: "info", label: "ภายใน 90 วัน" },
  ok: { tone: "success", label: "ปลอดภัย" },
  no_expiry: { tone: "neutral", label: "ไม่ระบุวันหมด" },
  missing: { tone: "neutral", label: "ยังไม่มีเอกสาร" },
};

interface DocSlotVm {
  type: string;
  label: string;
  hint: string;
  status: ExpiryStatus | "missing";
  expiryDate: string | null;
  daysToExpiry: number | null;
  document: {
    id: string;
    name: string;
    fileKey: string;
    filePublicUrl: string | null;
  } | null;
}

export default async function PersonDocDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const { userId } = await params;
  const orgId = session.user.org_id;

  const [user, docs] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, orgId, isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        email: true,
        employeeCode: true,
      },
    }),
    prisma.personDocument.findMany({
      where: { orgId, userId },
      include: {
        document: {
          select: {
            id: true,
            name: true,
            fileKey: true,
            filePublicUrl: true,
            isActive: true,
          },
        },
      },
      orderBy: [{ expiryDate: "asc" }],
    }),
  ]);
  if (!user) notFound();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Group by docType (most-recent or first per type)
  const docByType = new Map<
    string,
    (typeof docs)[number]
  >();
  for (const d of docs) {
    if (!docByType.has(d.docType)) docByType.set(d.docType, d);
  }

  const slots: DocSlotVm[] = PERSON_DOC_TYPES.map((type) => {
    const d = docByType.get(type);
    if (!d) {
      return {
        type,
        label: PERSON_DOC_TYPE_LABEL[type] ?? type,
        hint: PERSON_DOC_TYPE_HINT[type] ?? "",
        status: "missing" as const,
        expiryDate: null,
        daysToExpiry: null,
        document: null,
      };
    }
    let status: ExpiryStatus = "no_expiry";
    let days: number | null = null;
    if (d.expiryDate) {
      const exp = new Date(d.expiryDate);
      exp.setHours(0, 0, 0, 0);
      days = Math.floor(
        (exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      status = classifyExpiry(days);
    }
    return {
      type,
      label: PERSON_DOC_TYPE_LABEL[type] ?? type,
      hint: PERSON_DOC_TYPE_HINT[type] ?? "",
      status,
      expiryDate: d.expiryDate
        ? d.expiryDate.toISOString().slice(0, 10)
        : null,
      daysToExpiry: days,
      document: d.document
        ? {
            id: d.document.id,
            name: d.document.name,
            fileKey: d.document.fileKey,
            filePublicUrl: d.document.filePublicUrl,
          }
        : null,
    };
  });

  const otherDocs = docs.filter(
    (d) =>
      !PERSON_DOC_TYPES.includes(
        d.docType as (typeof PERSON_DOC_TYPES)[number],
      ),
  );

  return (
    <div
      style={{
        padding: "20px clamp(12px, 3vw, 32px)",
        paddingBottom: 96,
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      <Link
        href="/docuflow/persons"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--df-muted)",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <ArrowLeft size={14} />
        กลับเอกสารบุคคล
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
        className="df-fade-up"
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            background: "var(--df-brand-soft)",
            color: "var(--df-brand)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            border: "2px solid var(--df-surface)",
          }}
        >
          <UserCircle2 size={32} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <DfEyebrow>เอกสารบุคคล · {thaiDateLong(new Date())}</DfEyebrow>
          <h1
            className="df-serif"
            style={{
              fontSize: "clamp(20px, 3vw, 26px)",
              marginTop: 6,
              marginBottom: 0,
            }}
          >
            {user.name}
          </h1>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 8,
            }}
          >
            <DfPill tone="brand" small>
              {ROLE_LABEL[user.role] ?? user.role}
            </DfPill>
            {user.employeeCode && (
              <DfPill tone="outline" small>
                รหัสพนักงาน {user.employeeCode}
              </DfPill>
            )}
            {user.phone && (
              <DfPill tone="outline" small>
                {user.phone}
              </DfPill>
            )}
          </div>
        </div>
      </div>

      <DfSection
        number="01"
        label="เอกสารหลัก 4 ประเภท"
        className="df-fade-up df-fade-up-100"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          {slots.map((slot) => (
            <DocSlotCard key={slot.type} slot={slot} userId={user.id} />
          ))}
        </div>
      </DfSection>

      {otherDocs.length > 0 && (
        <DfSection
          number="02"
          label="เอกสารเพิ่มเติม"
          className="df-fade-up df-fade-up-200"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {otherDocs.map((d) => {
              let status: ExpiryStatus = "no_expiry";
              let days: number | null = null;
              if (d.expiryDate) {
                const exp = new Date(d.expiryDate);
                exp.setHours(0, 0, 0, 0);
                days = Math.floor(
                  (exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
                );
                status = classifyExpiry(days);
              }
              return (
                <DocSlotCard
                  key={d.id}
                  slot={{
                    type: d.docType,
                    label:
                      PERSON_DOC_TYPE_LABEL[d.docType] ?? d.docType,
                    hint: "",
                    status,
                    expiryDate: d.expiryDate
                      ? d.expiryDate.toISOString().slice(0, 10)
                      : null,
                    daysToExpiry: days,
                    document: d.document
                      ? {
                          id: d.document.id,
                          name: d.document.name,
                          fileKey: d.document.fileKey,
                          filePublicUrl: d.document.filePublicUrl,
                        }
                      : null,
                  }}
                  userId={user.id}
                />
              );
            })}
          </div>
        </DfSection>
      )}
    </div>
  );
}

function DocSlotCard({
  slot,
  userId,
}: {
  slot: DocSlotVm;
  userId: string;
}) {
  const badge = STATUS_BADGE[slot.status];
  const daysLabel =
    slot.daysToExpiry !== null
      ? slot.daysToExpiry < 0
        ? `เลยมา ${Math.abs(slot.daysToExpiry)} วัน`
        : slot.daysToExpiry === 0
          ? "หมดอายุวันนี้"
          : `เหลืออีก ${slot.daysToExpiry} วัน`
      : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-2 min-w-0">
          <div className="size-8 shrink-0 rounded-lg bg-[var(--color-brand-50)] flex items-center justify-center text-[var(--color-brand-700)]">
            <FileText className="size-4" />
          </div>
          <div>
            <CardTitle>{slot.label}</CardTitle>
            {slot.hint && (
              <p className="text-xs text-zinc-500 mt-0.5">{slot.hint}</p>
            )}
          </div>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        {slot.expiryDate ? (
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold">
              วันหมดอายุ
            </p>
            <p className="text-base font-bold text-zinc-900 tabular-nums mt-0.5">
              {slot.expiryDate}
            </p>
            {daysLabel && (
              <p
                className={
                  slot.status === "expired" || slot.status === "critical"
                    ? "text-xs font-semibold text-rose-700 mt-0.5"
                    : slot.status === "urgent"
                      ? "text-xs font-semibold text-amber-700 mt-0.5"
                      : "text-xs text-zinc-500 mt-0.5"
                }
              >
                {daysLabel}
              </p>
            )}
          </div>
        ) : slot.document ? (
          <p className="text-sm text-zinc-500">ไม่ได้ระบุวันหมดอายุ</p>
        ) : (
          <p className="text-sm text-zinc-500">
            ยังไม่มีเอกสาร — กดปุ่มเพื่ออัปโหลด
          </p>
        )}

        {slot.document && (
          <a
            href={
              slot.document.filePublicUrl ??
              `/api/docuflow/documents/${slot.document.id}/download`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-700)] hover:underline"
          >
            ดูไฟล์ · {slot.document.name}
          </a>
        )}

        <div className="pt-1">
          <Link
            href={`/docuflow/persons/${userId}/renew?type=${encodeURIComponent(slot.type)}`}
            className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 h-9 px-3 text-sm rounded-lg"
          >
            <RefreshCw className="size-3.5" />
            {slot.document ? "ต่ออายุ" : "อัปโหลด"}
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
