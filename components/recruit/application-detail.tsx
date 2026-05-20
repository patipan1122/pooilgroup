// Application Detail panel — server component shown inside inbox right pane
// Or full-page at /recruit/applications/[id]

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  STATUS_LABELS,
  STATUS_TONE,
  FormSchemaSchema,
  type ApplicationStatus,
  type FormSchema,
} from "@/lib/recruit/types";
import { ApplicationActions } from "./application-actions";
import { ApplicationNotes } from "./application-notes";
import { ApplicationAIPanel } from "./application-ai-panel";
import { ApplicationFiles } from "./application-files";
import { thaiDateLong } from "@/lib/utils/format";

interface Props {
  applicationId: string;
  canWrite: boolean;
}

export async function ApplicationDetail({ applicationId, canWrite }: Props) {
  const app = await prisma.recruitApplication.findUnique({
    where: { id: applicationId },
    include: {
      applicant: true,
      posting: { select: { id: true, title: true, fieldSchema: true, description: true } },
      notes: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!app) {
    return <div className="p-10 text-center text-sm text-zinc-500">ไม่พบใบสมัคร</div>;
  }

  // Parse field schema
  let schema: FormSchema | null = null;
  try {
    schema = FormSchemaSchema.parse(app.posting.fieldSchema);
  } catch {
    schema = null;
  }

  const answers = (app.answers ?? {}) as Record<string, unknown>;
  const files = ((app.files ?? []) as Array<{
    key: string;
    name: string;
    size: number;
    mime: string;
  }>) ?? [];

  return (
    <div className="p-5 sm:p-7 max-w-3xl">
      {/* Blacklist banner */}
      {app.flaggedBlacklist && (
        <div className="mb-5 rounded-2xl border-l-4 border-red-500 bg-red-50 p-4">
          <p className="font-bold text-red-900 text-sm">🚫 ผู้สมัครนี้ตรงกับ Blacklist</p>
          {app.blacklistReason && (
            <p className="text-xs text-red-700 mt-1">{app.blacklistReason}</p>
          )}
          <Link
            href="/recruit/blacklist"
            className="text-xs text-red-600 underline hover:text-red-900 mt-2 inline-block"
          >
            ดู Blacklist
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <p className="text-xs text-zinc-500">
            {app.refId} · {app.posting.title}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 font-display mt-1">
            {app.applicant.fullName}
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap text-xs text-zinc-600">
            <span>📞 {app.applicant.phone}</span>
            {app.applicant.email && <span>· ✉️ {app.applicant.email}</span>}
            {app.applicant.lineId && <span>· LINE {app.applicant.lineId}</span>}
          </div>
        </div>
        <Badge tone={STATUS_TONE[app.status as ApplicationStatus]}>
          {STATUS_LABELS[app.status as ApplicationStatus]}
        </Badge>
      </div>

      {/* Status actions (status change · rating · tags) */}
      {canWrite && (
        <ApplicationActions
          applicationId={app.id}
          currentStatus={app.status as ApplicationStatus}
          currentRating={app.starRating}
          currentTags={app.tags ?? []}
        />
      )}

      {/* AI panel */}
      <ApplicationAIPanel
        applicationId={app.id}
        aiScore={app.aiScore}
        aiSummary={app.aiSummary}
        aiStrengths={(app.aiStrengths as string[] | null) ?? null}
        aiRisks={(app.aiRisks as string[] | null) ?? null}
        aiEvaluatedAt={app.aiEvaluatedAt}
        canWrite={canWrite}
      />

      {/* Files */}
      {files.length > 0 && <ApplicationFiles files={files} />}

      {/* Answers */}
      <div className="mt-6">
        <h2 className="text-sm font-bold text-zinc-900 mb-3 uppercase tracking-wider">
          คำตอบ ({Object.keys(answers).length} ข้อ)
        </h2>
        <div className="space-y-3">
          {schema?.sections.map((section) => (
            <div key={section.id}>
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400 font-bold mb-2">
                {section.title}
              </p>
              <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                {section.fields.map((field) => {
                  const val = answers[field.id];
                  return (
                    <div
                      key={field.id}
                      className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 items-start"
                    >
                      <p className="text-xs font-medium text-zinc-600 sm:col-span-1">
                        {field.label}
                        {field.required && (
                          <span className="text-red-500 ml-0.5">*</span>
                        )}
                      </p>
                      <p className="text-sm text-zinc-900 sm:col-span-2 break-words">
                        {formatAnswer(val) || (
                          <span className="text-zinc-400 italic">— ไม่ตอบ —</span>
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="mt-7">
        <h2 className="text-sm font-bold text-zinc-900 mb-3 uppercase tracking-wider">
          Notes ภายใน HR ({app.notes.length})
        </h2>
        <ApplicationNotes
          applicationId={app.id}
          notes={app.notes.map((n) => ({
            id: n.id,
            body: n.body,
            rating: n.rating,
            userName: n.user.name,
            createdAt: n.createdAt.toISOString(),
          }))}
          canWrite={canWrite}
        />
      </div>

      {/* Footer */}
      <div className="mt-8 pt-4 border-t border-zinc-100 text-xs text-zinc-400 flex justify-between flex-wrap gap-2">
        <span>
          ส่งใบสมัครเมื่อ{" "}
          {app.submittedAt ? thaiDateLong(app.submittedAt) : "ยังไม่ส่ง"}
        </span>
        <Link
          href={`/recruit/applications/${app.id}`}
          className="text-[var(--color-brand-700)] hover:underline"
        >
          เปิดเต็มหน้า →
        </Link>
      </div>
    </div>
  );
}

function formatAnswer(val: unknown): string {
  if (val == null || val === "") return "";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "boolean") return val ? "ใช่" : "ไม่ใช่";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
