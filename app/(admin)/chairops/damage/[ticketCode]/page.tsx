// Damage ticket detail
// URL = ticketCode (CH-2569-NNNN) per spec · not id
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/chairops/auth/session";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import { ChairopsTicketStatus } from "@/lib/generated/prisma/enums";
import { TicketActions } from "./ticket-actions";

const STATUS_LABEL: Record<ChairopsTicketStatus, string> = {
  OPEN: "ใหม่",
  ASSIGNED: "มอบหมายแล้ว",
  IN_PROGRESS: "กำลังซ่อม",
  WAITING_PARTS: "รออะไหล่",
  DONE: "เสร็จ",
  CANCELLED: "ยกเลิก",
};

const STATUS_TONE: Record<ChairopsTicketStatus, "brand" | "neutral" | "success" | "warning" | "danger"> = {
  OPEN: "danger",
  ASSIGNED: "warning",
  IN_PROGRESS: "warning",
  WAITING_PARTS: "neutral",
  DONE: "success",
  CANCELLED: "neutral",
};

export default async function DamageTicketDetail({
  params,
}: {
  params: Promise<{ ticketCode: string }>;
}) {
  const session = await requireAuth();
  // MAID gets bumped — admin detail page is not for them
  if (session.user.role === "MAID") redirect("/chairops/damage/new");
  const { ticketCode } = await params;

  const ticket = await prisma.chairopsDamageTicket.findUnique({
    where: {
      orgId_ticketCode: { orgId: session.user.orgId, ticketCode },
    },
    include: {
      branch: { select: { id: true, name: true, slug: true } },
      chair: { select: { chairCode: true, generation: true } },
      reportedBy: { select: { displayName: true, role: true } },
      assignedTo: { select: { id: true, displayName: true } },
    },
  });
  if (!ticket) notFound();

  // Technician can only see tickets assigned to them or unassigned in their scope
  if (
    session.user.role === "TECHNICIAN" &&
    ticket.assignedToId !== session.user.id &&
    ticket.assignedToId !== null
  ) {
    notFound();
  }

  const [technicians, parts, movements, auditLogs] = await Promise.all([
    prisma.chairopsUser.findMany({
      where: { orgId: session.user.orgId, role: "TECHNICIAN", isActive: true },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.chairopsSparePart.findMany({
      where: { orgId: session.user.orgId, stockOnHand: { gt: 0 } },
      select: { id: true, partCode: true, name: true, unit: true, stockOnHand: true },
      orderBy: { name: "asc" },
    }),
    prisma.chairopsSparePartMovement.findMany({
      where: { orgId: session.user.orgId, refTicketId: ticket.id },
      include: { part: { select: { partCode: true, name: true, unit: true } } },
      orderBy: { at: "desc" },
    }),
    prisma.chairopsAuditLog.findMany({
      where: { orgId: session.user.orgId, entity: "DamageTicket", entityId: ticket.id },
      include: { user: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const isClosed = ticket.status === "DONE" || ticket.status === "CANCELLED";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link
            href="/chairops/damage"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← กลับรายการตั๋ว
          </Link>
          <h1 className="font-mono text-2xl font-bold tracking-tight">
            {ticket.ticketCode}
            {ticket.priority === "URGENT" && (
              <Badge tone="danger" className="ml-3 align-middle">
                ด่วน
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            แจ้งโดย {ticket.reportedBy.displayName} · {thaiDateTime(ticket.openedAt)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[ticket.status]} className="text-sm">
          {STATUS_LABEL[ticket.status]}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">อาการ / รายละเอียด</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">หมวด</div>
                <div className="font-medium">{ticket.category}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">รายละเอียด</div>
                <div className="whitespace-pre-wrap">{ticket.description}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">สาขา</div>
                  <div className="font-medium">{ticket.branch.name}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">เครื่อง</div>
                  <div className="font-mono">
                    {ticket.chair?.chairCode ?? "—"}{" "}
                    {ticket.chair?.generation && (
                      <span className="text-xs text-muted-foreground">
                        ({ticket.chair.generation})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {ticket.notes && (
                <div>
                  <div className="text-xs text-muted-foreground">บันทึกปิดงาน</div>
                  <div className="whitespace-pre-wrap rounded-md bg-muted p-2 text-sm">
                    {ticket.notes}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {ticket.photoUrls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">รูปภาพ ({ticket.photoUrls.length})</CardTitle>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {ticket.photoUrls.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`รูป ${i + 1}`}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    </a>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                อะไหล่ที่ใช้ ({movements.length})
              </CardTitle>
            </CardHeader>
            <CardBody>
              {movements.length === 0 ? (
                <p className="text-sm text-muted-foreground">ยังไม่มีอะไหล่ที่ใช้</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 font-medium">อะไหล่</th>
                      <th className="py-2 font-medium">จำนวน</th>
                      <th className="py-2 font-medium">เมื่อ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="py-2">
                          <div className="font-mono text-xs">{m.part.partCode}</div>
                          <div className="text-sm">{m.part.name}</div>
                        </td>
                        <td className="py-2">
                          {Math.abs(m.delta)} {m.part.unit}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {thaiDateTime(m.at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">ประวัติเปลี่ยนแปลง</CardTitle>
            </CardHeader>
            <CardBody>
              {auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">ยังไม่มีประวัติ</p>
              ) : (
                <ol className="space-y-2 border-l border-border pl-4">
                  {auditLogs.map((a) => (
                    <li key={a.id} className="relative text-sm">
                      <span className="absolute -left-[1.05rem] top-2 h-2 w-2 rounded-full bg-primary" />
                      <div className="font-medium">{a.action}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.user?.displayName ?? "ระบบ"} · {thaiRelative(a.createdAt)}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <TicketActions
            code={ticket.ticketCode}
            status={ticket.status}
            assignedToId={ticket.assignedToId}
            actorRole={session.user.role}
            technicians={technicians}
            parts={parts}
            isClosed={isClosed}
          />
        </div>
      </div>
    </div>
  );
}
