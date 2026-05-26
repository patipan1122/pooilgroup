// Insights · drill drawer bodies (SERVER components)
// Per-view renderers for the universal <DrillDrawer> shell.
// Imports Prisma + server-only queries; never client.

import Link from "next/link";
import { getMachineByCode } from "@/lib/clawfleet/queries";
import { formatTHB, severityLight } from "@/lib/clawfleet/validation";
import { StatusPill } from "@/components/ui/status-pill";
import { Sparkline } from "./sparkline";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";

/**
 * Event detail body — pre-rendered SC for drawer when ?view=events&drill=<eventId>
 */
export async function EventDrillBody({ eventId }: { eventId: string }) {
  const session = await requireSession();
  const event = await prisma.cfCollectionEvent.findFirst({
    where: { id: eventId, orgId: session.user.org_id },
    include: {
      machine: {
        select: {
          code: true,
          nickname: true,
          kind: true,
          branch: { select: { name: true } },
        },
      },
      collectedBy: { select: { name: true } },
      session: { select: { sessionCode: true, status: true } },
    },
  });

  if (!event) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
        ไม่พบเหตุการณ์ · อาจถูกลบหรืออยู่นอกสิทธิ์
      </p>
    );
  }

  const expected = (event.coinMeterAfter - event.coinMeterBefore) * 1000;
  const variance = event.cashCountedCents - expected;
  const light = severityLight(variance);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-xs text-zinc-500">ตู้</div>
            <div className="font-mono text-base font-bold text-zinc-900">
              {event.machine.code}
            </div>
            {event.machine.nickname && (
              <div className="text-xs text-zinc-500">
                {event.machine.nickname}
              </div>
            )}
          </div>
          <StatusPill
            tone={
              light === "danger" ? "danger" : light === "warn" ? "warning" : "success"
            }
            dot
            size="sm"
          >
            {light === "danger" ? "ขาดเยอะ" : light === "warn" ? "ขาดน้อย" : "ปกติ"}
          </StatusPill>
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          {event.machine.branch.name}
          {event.session && (
            <>
              {" · รอบ "}
              <span className="font-mono">{event.session.sessionCode}</span>
            </>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Stat
          label="เหรียญที่เพิ่ม"
          value={(event.coinMeterAfter - event.coinMeterBefore).toLocaleString(
            "th-TH",
          )}
        />
        <Stat
          label="เงินสดที่นับได้"
          value={formatTHB(event.cashCountedCents)}
        />
        <Stat label="ควรได้" value={formatTHB(expected)} />
        <Stat
          label="ส่วนต่าง"
          value={`${variance > 0 ? "+" : ""}${formatTHB(variance)}`}
          tone={variance < 0 ? "rose" : variance > 0 ? "violet" : "emerald"}
        />
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="text-xs text-zinc-500">เก็บโดย</div>
        <div className="text-sm font-semibold text-zinc-900">
          {event.collectedBy.name}
        </div>
        <div className="mt-1 text-xs text-zinc-500 tabular-nums">
          {new Date(event.collectedAt).toLocaleString("th-TH")}
        </div>
      </section>

      {event.anomalyFlags.length > 0 && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="text-xs font-bold text-rose-900">Anomaly flags</div>
          <ul className="mt-2 space-y-1">
            {event.anomalyFlags.map((f) => (
              <li key={f} className="text-xs text-rose-800">
                · {f}
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.notes && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">หมายเหตุพนักงาน</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">
            {event.notes}
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * Machine detail body — drawer for /insights?view=machines&drill=<code>
 */
export async function MachineDrillBody({ code }: { code: string }) {
  const machine = await getMachineByCode(code);
  if (!machine) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
        ไม่พบตู้รหัส <span className="font-mono">{code}</span>
      </p>
    );
  }

  // 30d sparkline series — derived from machine.events
  const now = new Date();
  const todayKey = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
  const dayMap = new Map<number, number>();
  for (const e of machine.events) {
    const k = Math.floor(
      new Date(e.collectedAt).getTime() / (1000 * 60 * 60 * 24),
    );
    dayMap.set(k, (dayMap.get(k) ?? 0) + e.cashCountedCents);
  }
  const series = Array.from({ length: 30 }, (_, i) =>
    dayMap.get(todayKey - (29 - i)) ?? 0,
  );
  const total30d = series.reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="font-mono text-lg font-bold text-zinc-900">
              {machine.code}
            </div>
            {machine.nickname && (
              <div className="text-xs text-zinc-500">{machine.nickname}</div>
            )}
            <div className="mt-1 text-xs text-zinc-500">
              {machine.branch.name} · {machine.group?.name ?? "ไม่มีกลุ่ม"}
            </div>
          </div>
          <StatusPill
            tone={machine.kind === "CLAW" ? "info" : "amber"}
            size="sm"
          >
            {machine.kind === "CLAW" ? "ตู้คีบ" : "ตู้แลก"}
          </StatusPill>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-zinc-500">รายได้ 30 วัน</div>
            <div className="text-xl font-bold text-zinc-900 tabular-nums">
              {formatTHB(total30d)}
            </div>
          </div>
          <Sparkline data={series} tone="indigo" width={140} height={40} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Stat
          label="มิเตอร์ล่าสุด"
          value={machine.lastCoinMeter.toLocaleString("th-TH")}
        />
        {machine.kind === "CLAW" && (
          <Stat
            label="สต๊อกตุ๊กตา"
            value={String(machine.lastDollStock)}
            tone={machine.lastDollStock < 10 ? "rose" : undefined}
          />
        )}
      </section>

      {machine.loadouts[0] && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-zinc-500">สินค้าปัจจุบัน</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">
            {machine.loadouts[0].product.name}
          </div>
          <div className="text-xs text-zinc-500">
            ราคา {machine.loadouts[0].pricePerPlayCoins} เหรียญ/ครั้ง
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-bold text-zinc-700">
            เหตุการณ์ล่าสุด ({machine.events.length})
          </h3>
          <Link
            href={`/clawfleet/machines/${machine.code}`}
            className="text-xs font-semibold text-zinc-600 hover:text-zinc-900"
          >
            ดูเพิ่ม →
          </Link>
        </div>
        {machine.events.length === 0 ? (
          <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500">
            ยังไม่มีเหตุการณ์
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
            {machine.events.slice(0, 6).map((e) => {
              const ts = new Date(e.collectedAt);
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <div>
                    <div className="text-zinc-900 tabular-nums">
                      {ts.toLocaleDateString("th-TH", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </div>
                    <div className="text-[11px] text-zinc-500 tabular-nums">
                      {ts.toLocaleTimeString("th-TH", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <span className="font-semibold text-zinc-900 tabular-nums">
                    {formatTHB(e.cashCountedCents)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Generic drill body for views that don't have a real entity yet
 */
export async function GenericDrillBody({
  id,
  view,
}: {
  id: string;
  view: string;
}) {
  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
        Drill-down สำหรับมุมมอง <b>{view}</b> · id{" "}
        <span className="font-mono text-xs">{id}</span> ยังไม่พร้อม
      </p>
      <p className="text-xs text-zinc-500">
        TODO[claude-design]: ต้องการ query เฉพาะมุมมองนี้ (
        <code className="rounded bg-zinc-100 px-1 font-mono text-[11px]">
          getBranchHeatmap
        </code>{" "}
        ·{" "}
        <code className="rounded bg-zinc-100 px-1 font-mono text-[11px]">
          getStaffPerformance
        </code>
        ) ก่อนแสดงรายละเอียดได้
      </p>
    </div>
  );
}

// =============================================================
// Internal — Stat tile
// =============================================================
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "rose" | "violet" | "emerald" | "amber";
}) {
  const toneClass = tone
    ? {
        rose: "text-rose-600",
        violet: "text-violet-600",
        emerald: "text-emerald-600",
        amber: "text-amber-700",
      }[tone]
    : "text-zinc-900";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-base font-bold tabular-nums ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}
