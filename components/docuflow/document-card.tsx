// DocumentCard — single document row for list views
// ────────────────────────────────────────────────────────────────────
// Server-component-safe (no event handlers). Click → detail page.
//
// The "ย้ายไปที่..." action (Workshop Must #5, 2026-10-10) is the one
// exception — it mounts a small client child (MoveDocumentButton, compact
// mode) in the card's top-right corner so admins can move a document to a
// different DocumentGroup right from this list, not just the detail page.
// Embedding a client component inside this server component is fine (RSC
// composition) — DocumentCard itself stays a plain server component.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { FileText, ArrowUpRight, Folder } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExpiryBadge } from "./expiry-badge";
import { MoveDocumentButton, type MoveDocumentGroupOption } from "./move-document-button";
import { bkkRelative } from "@/lib/utils/format";
import type { CanonicalDocument } from "@/lib/docuflow/data";

interface Props {
  doc: CanonicalDocument;
  /** Optional human-readable owner label (e.g. branch name) */
  ownerLabel?: string;
  /** Active DocumentGroup rows for this org — only needed when canMove is
   *  true, passed down to MoveDocumentButton's picker. */
  groups?: MoveDocumentGroupOption[];
  /** DocuFlow module-admin tier — gates the "ย้ายไปที่..." action, same tier
   *  every other admin-only mutation in this module requires. */
  canMove?: boolean;
}

const LEVEL_LABEL: Record<string, string> = {
  group: "กลุ่ม",
  company: "บริษัท",
  business_type: "ประเภทธุรกิจ",
  branch: "สาขา",
  person: "บุคคล",
};

export function DocumentCard({ doc, ownerLabel, groups, canMove }: Props) {
  const primaryLevel = doc.ownership[0]?.level;
  return (
    <Card className="hover-lift">
      <CardBody className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="size-10 shrink-0 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-100)] flex items-center justify-center text-[var(--color-brand-700)]">
            <FileText className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/docuflow/documents/${doc.id}`}
                className="group inline-flex items-start gap-1.5 min-w-0"
              >
                <h3 className="font-bold text-zinc-900 tracking-tight font-display group-hover:text-[var(--color-brand-700)] transition-colors line-clamp-1">
                  {doc.name}
                </h3>
                <ArrowUpRight className="size-3.5 text-zinc-400 group-hover:text-[var(--color-brand-700)] transition-colors mt-1 shrink-0" />
              </Link>
              {canMove && (
                <MoveDocumentButton
                  documentId={doc.id}
                  currentGroupId={doc.documentGroupId}
                  currentGroupName={doc.documentGroup?.name ?? null}
                  groups={groups ?? []}
                  compact
                />
              )}
            </div>
            {doc.description && (
              <p className="text-sm text-zinc-600 mt-1 line-clamp-2">
                {doc.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {primaryLevel && (
                <Badge tone="brand">
                  {LEVEL_LABEL[primaryLevel] ?? primaryLevel}
                </Badge>
              )}
              {ownerLabel && <Badge tone="neutral">{ownerLabel}</Badge>}
              {doc.documentGroup && (
                <Badge tone="neutral">
                  <Folder className="size-3" />
                  {doc.documentGroup.name}
                </Badge>
              )}
              {doc.tags.slice(0, 4).map((t) => (
                <Badge key={t} tone="neutral">
                  #{t}
                </Badge>
              ))}
              {doc.tags.length > 4 && (
                <span className="text-xs text-zinc-400">
                  +{doc.tags.length - 4}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs text-zinc-500">
              <span>อัปโหลด {bkkRelative(doc.uploadedAt)}</span>
              {doc.renewal && (
                <>
                  <span>·</span>
                  <ExpiryBadge
                    status={doc.renewal.expiryStatus}
                    days={doc.renewal.daysUntilExpiry}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
