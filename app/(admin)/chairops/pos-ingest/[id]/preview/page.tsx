// Step 2 — Diff preview · shows ใหม่ / เหมือนเดิม / เปลี่ยน / ผิด counts then table.
// Per memory [[pool-csv-import-must-diff-before-write]] — never commit without showing this.
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { OfficeShell } from "@/app/(admin)/chairops/dashboard-office/layout";
import { Badge } from "@/components/chairops/ui/badge";
import { baht, thaiDate, thaiDateTime } from "@/lib/chairops/utils/format";
import { canEditPastDay } from "@/lib/chairops/auth/role-guards";
import type { DiffSummary, DiffRow } from "../../actions";
import { CommitButtons } from "./commit-buttons";

const STATUS_LABEL: Record<DiffRow["status"], { label: string; variant: "default" | "secondary" | "success" | "warning" | "danger" | "outline" }> = {
  new: { label: "ใหม่", variant: "success" },
  same: { label: "เหมือนเดิม", variant: "secondary" },
  changed: { label: "เปลี่ยน", variant: "warning" },
  error: { label: "ผิด", variant: "danger" },
};

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; filter?: string }>;
}) {
  const session = await requireRole("OFFICE");
  const { id } = await params;
  const sp = await searchParams;

  const imp = await prisma.chairopsPosImport.findUnique({ where: { id } });
  if (!imp) notFound();

  const uploader = await prisma.chairopsUser.findUnique({
    where: { id: imp.uploadedById },
    select: { id: true, displayName: true },
  });

  const diff = imp.diffSummary as unknown as DiffSummary;
  const counts = diff.counts;
  const filter = sp.filter ?? "all";

  const rows: DiffRow[] = Array.isArray(diff.rows) ? diff.rows : [];
  const visibleRows = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const isSelfCommit = uploader?.id === session.user.id;
  const hasPastDayChange = rows.some((r) => r.status === "changed" && r.isPastDay);
  const ceoOnlyBlocker = hasPastDayChange && !canEditPastDay(session.user);

  return (
    <OfficeShell session={session} active="/chairops/pos-ingest">
      <div className="mb-4">
        <Link href="/chairops/pos-ingest" className="text-sm text-muted-foreground hover:underline">
          ← กลับรายการ import
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Preview · {imp.filename}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            อัปโหลดโดย {uploader?.displayName ?? "?"} · {thaiDateTime(imp.uploadedAt)} · {imp.rowCount} แถว
            {imp.notes ? ` · "${imp.notes}"` : ""}
          </p>
        </div>
        {imp.committed ? (
          <Badge variant="success">commit แล้วเมื่อ {imp.committedAt ? thaiDateTime(imp.committedAt) : "—"}</Badge>
        ) : (
          <Badge variant="warning">รอยืนยัน commit</Badge>
        )}
      </div>

      {/* counts summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <CountTile label="แถวทั้งหมด" value={counts.total} tone="muted" />
        <CountTile label="ใหม่" value={counts.new} tone="success" />
        <CountTile label="เหมือนเดิม" value={counts.same} tone="muted" />
        <CountTile label="เปลี่ยน" value={counts.changed} tone="warning" />
        <CountTile label="ผิด" value={counts.error} tone="danger" />
      </div>

      {/* warnings */}
      <div className="mb-4 space-y-2">
        {sp.error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {counts.error > 0 && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm">
            มี {counts.error} แถวที่อ่านไม่ออก (วันที่ผิด · สาขา map ไม่เจอ · ตัวเลขผิด) — แถวเหล่านี้จะถูกข้ามตอน commit
          </div>
        )}
        {isSelfCommit && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm">
            ⚠ คุณเป็นทั้งผู้ upload และผู้ commit เอง · ระบบจะ log ไว้ในประวัติ (maker/checker soft-warn)
          </div>
        )}
        {diff.pastDayWarning && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm">
            ⚠ มีแถวที่แก้ไขย้อนหลัง &gt; 1 วัน
            {ceoOnlyBlocker
              ? " · ต้องให้ CEO เป็นผู้ commit เท่านั้น (คุณกด commit ไม่ได้)"
              : " · ระบบจะอนุญาตเฉพาะเมื่อคุณมี role CEO หรือ ADMIN"}
          </div>
        )}
      </div>

      {/* filter chips */}
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
        {(["all", "new", "changed", "same", "error"] as const).map((f) => (
          <Link
            key={f}
            href={`/pos-ingest/${imp.id}/preview${f === "all" ? "" : `?filter=${f}`}`}
            className={
              "rounded-full border px-3 py-1 font-medium transition-colors " +
              (filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted")
            }
          >
            {f === "all" ? "ทั้งหมด" : STATUS_LABEL[f].label}
          </Link>
        ))}
      </div>

      {/* diff table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="sticky top-14 z-20 bg-muted text-xs uppercase text-muted-foreground">
            <tr className="text-left">
              <th className="w-12 px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">สถานะ</th>
              <th className="px-2 py-2 font-medium">วันที่</th>
              <th className="px-2 py-2 font-medium">สาขา</th>
              <th className="px-2 py-2 font-medium">เครื่อง</th>
              <th className="px-2 py-2 text-right font-medium">ออนไลน์</th>
              <th className="px-2 py-2 text-right font-medium">แบงค์</th>
              <th className="px-2 py-2 text-right font-medium">เหรียญ</th>
              <th className="px-2 py-2 text-right font-medium">รวม</th>
              <th className="px-2 py-2 font-medium">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                  ไม่มีแถวที่ match filter นี้
                </td>
              </tr>
            )}
            {visibleRows.map((r) => {
              const status = STATUS_LABEL[r.status];
              return (
                <tr
                  key={r.rowIndex}
                  className={
                    r.status === "error"
                      ? "bg-danger/5"
                      : r.status === "changed"
                        ? "bg-warning/5"
                        : "hover:bg-muted/40"
                  }
                >
                  <td className="px-2 py-1.5 text-xs tabular-nums text-muted-foreground">{r.rowIndex}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.bizDate ? thaiDate(r.bizDate) : <span className="text-danger">—</span>}
                    {r.isPastDay && <span className="ml-1 text-xs text-warning">(ย้อนหลัง)</span>}
                  </td>
                  <td className="px-2 py-1.5">{r.branchName ?? <span className="text-danger">หาไม่เจอ</span>}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{r.chairCode ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{baht(r.online)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{baht(r.cash)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{baht(r.coin)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{baht(r.totalRevenue)}</td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">
                    {r.errors.length > 0 && <span className="text-danger">{r.errors.join(" · ")}</span>}
                    {r.status === "changed" && r.changes && r.changes.join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* commit / cancel */}
      {!imp.committed && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-4">
          <p className="text-sm text-muted-foreground">
            กด <strong>ยืนยัน commit</strong> เพื่อบันทึก {counts.new + counts.changed} แถวลงระบบ (ผิด {counts.error} แถวจะถูกข้าม){" "}
            · หลัง commit ระบบจะ recompute drift ทุกสาขา + ตรวจ alert ทันที
          </p>
          <CommitButtons importId={imp.id} disabled={ceoOnlyBlocker} ceoOnlyBlocker={ceoOnlyBlocker} />
        </div>
      )}
    </OfficeShell>
  );
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-[hsl(142,76%,28%)]"
      : tone === "warning"
        ? "text-[hsl(38,92%,38%)]"
        : tone === "danger"
          ? "text-[hsl(0,84%,48%)]"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${toneClass}`}>{value.toLocaleString()}</div>
    </div>
  );
}
