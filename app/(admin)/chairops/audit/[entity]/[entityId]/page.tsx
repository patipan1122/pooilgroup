// Audit timeline for a specific entity · diff oldValue → newValue per row
import Link from "next/link";
import { requireRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { thaiDateTime } from "@/lib/chairops/utils/format";

export default async function AuditEntityPage({
  params,
}: {
  params: Promise<{ entity: string; entityId: string }>;
}) {
  await requireRole("CEO");
  const { entity, entityId } = await params;

  const logs = await prisma.chairopsAuditLog.findMany({
    where: { entity, entityId },
    include: { user: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/chairops/audit" className="text-sm text-muted-foreground hover:underline">
          ← กลับ Audit Log
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">
          {entity} <span className="font-mono text-base">{entityId}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {logs.length.toLocaleString("en-US")} เหตุการณ์
        </p>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardBody className="p-8 text-center text-muted-foreground">
            ไม่พบประวัติของ entity นี้
          </CardBody>
        </Card>
      ) : (
        <ol className="space-y-3">
          {logs.map((l) => (
            <li key={l.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
                    <span className="font-mono">{l.action}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {thaiDateTime(l.createdAt)} · {l.user?.displayName ?? "ระบบ"}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  <DiffTable oldValue={l.oldValue} newValue={l.newValue} />
                  {l.metadata != null && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Metadata
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 text-xs">
                        {JSON.stringify(l.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DiffTable({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const oldObj =
    oldValue && typeof oldValue === "object" ? (oldValue as Record<string, unknown>) : null;
  const newObj =
    newValue && typeof newValue === "object" ? (newValue as Record<string, unknown>) : null;

  if (!oldObj && !newObj) {
    return <p className="text-sm text-muted-foreground">— ไม่มี diff —</p>;
  }

  const keys = Array.from(
    new Set([...(oldObj ? Object.keys(oldObj) : []), ...(newObj ? Object.keys(newObj) : [])])
  ).sort();

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-1 font-medium">Field</th>
          <th className="py-1 font-medium">Old</th>
          <th className="py-1 font-medium">New</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const o = oldObj?.[k];
          const n = newObj?.[k];
          const changed = JSON.stringify(o) !== JSON.stringify(n);
          return (
            <tr
              key={k}
              className={"border-t border-border " + (changed ? "" : "opacity-60")}
            >
              <td className="py-1 font-mono text-xs">{k}</td>
              <td className="py-1 font-mono text-xs text-danger">
                {formatVal(o)}
              </td>
              <td className="py-1 font-mono text-xs text-success">
                {formatVal(n)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function formatVal(v: unknown): string {
  if (v === undefined || v === null) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
