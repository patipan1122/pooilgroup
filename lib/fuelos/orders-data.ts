import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { bkkDate } from "@/lib/fuelos/utils/format";
import type { OrderStatus } from "@/lib/generated/prisma/enums";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

// 4 คอลัมน์บอร์ด Kanban (ไม่รวม CANCELLED — ออเดอร์ที่ยกเลิกหลุดจากบอร์ด)
export const BOARD_STATUSES: OrderStatus[] = [
  "AWAITING_CONFIRM",
  "DELIVERING",
  "DELIVERED_UNPAID",
  "CLOSED",
];

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; tone: string; column?: string }
> = {
  AWAITING_CONFIRM: { label: "รอจัดส่ง", tone: "bg-surface-2 text-zinc-600", column: "รอจัดส่ง" },
  DELIVERING: { label: "กำลังส่ง", tone: "bg-info/10 text-info", column: "กำลังส่ง" },
  DELIVERED_UNPAID: { label: "ส่งแล้ว/รอเก็บเงิน", tone: "bg-warning/15 text-warning", column: "ส่งแล้ว/รอเก็บเงิน" },
  CLOSED: { label: "ปิดบิล", tone: "bg-leaf-100 text-leaf-700", column: "ปิดบิล" },
  CANCELLED: { label: "ยกเลิก", tone: "bg-danger/10 text-danger" },
};

// ลำดับ flow การเดินสถานะ (เดินหน้าได้ทีละขั้น)
const STATUS_FLOW: OrderStatus[] = [
  "AWAITING_CONFIRM",
  "DELIVERING",
  "DELIVERED_UNPAID",
  "CLOSED",
];

export function nextStatus(s: OrderStatus): OrderStatus | null {
  const i = STATUS_FLOW.indexOf(s);
  if (i < 0 || i >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[i + 1];
}

export function isForwardStep(from: OrderStatus, to: OrderStatus): boolean {
  const a = STATUS_FLOW.indexOf(from);
  const b = STATUS_FLOW.indexOf(to);
  return a >= 0 && b >= 0 && b === a + 1;
}

export type BoardCard = {
  id: string;
  orderNo: string;
  customerName: string;
  totalLiters: number;
  subtotal: number;
  profit: number;
  scheduledDate: Date | null;
  status: OrderStatus;
};

// ดึงการ์ดออเดอร์ที่กำลังดำเนินการ (statuses บนบอร์ด) — ใช้ร่วมทั้งมุมมองสถานะและมุมมองวัน
async function fetchBoardCards(orgId: string): Promise<BoardCard[]> {
  const rows = await prisma.order.findMany({
    where: { orgId, status: { in: BOARD_STATUSES } },
    orderBy: [{ scheduledDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 500,
    include: {
      customer: { select: { name: true } },
      items: { select: { qtyLiters: true } },
    },
  });

  return rows.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    customerName: o.customer.name,
    totalLiters: o.items.reduce((s, it) => s + Number(it.qtyLiters), 0),
    subtotal: Number(o.subtotal),
    profit: Number(o.totalProfit),
    scheduledDate: o.scheduledDate,
    status: o.status,
  }));
}

// มุมมอง "ตามสถานะ" — จัดกลุ่ม 4 คอลัมน์ Kanban
export async function listOrdersBoard(orgId: string) {
  const cards = await fetchBoardCards(orgId);
  const columns = BOARD_STATUSES.map((status) => ({
    status,
    label: ORDER_STATUS_META[status].column ?? ORDER_STATUS_META[status].label,
    cards: cards.filter((c) => c.status === status),
  }));
  return { columns, total: cards.length };
}

export type DayGroup = {
  key: string; // "yyyy-MM-dd" หรือ "none" (ยังไม่นัดส่ง)
  title: string; // "วันนี้" / "พรุ่งนี้" / "พฤ. 23 มิ.ย. 69" / "ยังไม่นัดส่ง"
  sub: string; // วันที่กำกับเมื่อ title เป็น วันนี้/พรุ่งนี้
  totalLiters: number;
  subtotal: number;
  cards: BoardCard[];
};

// มุมมอง "ตามวัน" — จัดกลุ่มตามวันนัดส่ง เรียงวันใกล้→ไกล (ยังไม่นัดส่งไว้ท้ายสุด)
export async function listOrdersByDay(orgId: string) {
  const cards = await fetchBoardCards(orgId);

  const now = new Date();
  const todayKey = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const tomorrowKey = formatInTimeZone(new Date(now.getTime() + 86_400_000), TZ, "yyyy-MM-dd");

  const buckets = new Map<string, { date: Date | null; cards: BoardCard[] }>();
  for (const c of cards) {
    // scheduledDate เป็น @db.Date (เที่ยงคืน UTC) → format ที่ไทยได้วันปฏิทินถูกต้อง (ตรงกับ bkkDate ทั้งระบบ)
    const key = c.scheduledDate ? formatInTimeZone(c.scheduledDate, TZ, "yyyy-MM-dd") : "none";
    if (!buckets.has(key)) buckets.set(key, { date: c.scheduledDate, cards: [] });
    buckets.get(key)!.cards.push(c);
  }

  const groups: DayGroup[] = [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === "none") return 1;
      if (b === "none") return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map(([key, b]) => {
      const dateLabel = b.date ? bkkDate(b.date) : "";
      let title = dateLabel;
      let sub = "";
      if (key === "none") title = "ยังไม่นัดส่ง";
      else if (key === todayKey) { title = "วันนี้"; sub = dateLabel; }
      else if (key === tomorrowKey) { title = "พรุ่งนี้"; sub = dateLabel; }
      return {
        key,
        title,
        sub,
        totalLiters: b.cards.reduce((s, c) => s + c.totalLiters, 0),
        subtotal: b.cards.reduce((s, c) => s + c.subtotal, 0),
        cards: b.cards,
      };
    });

  return { groups, total: cards.length };
}

// รายละเอียดออเดอร์ + ลูกค้า + items + การอนุมัติเครดิต + รถที่เลือกได้
export async function getOrder(orgId: string, id: string) {
  const order = await prisma.order.findFirst({
    where: { id, orgId },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          legalName: true,
          zone: true,
          phone: true,
          creditLimit: true,
          creditUsed: true,
          paymentTerms: true,
        },
      },
      location: { select: { name: true, address: true } },
      sales: { select: { name: true } },
      truck: { select: { id: true, plate: true, status: true } },
      items: true,
      approval: {
        include: {
          requestedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!order) return null;

  const trucks = await prisma.truck.findMany({
    where: { orgId, isActive: true },
    orderBy: { plate: "asc" },
    select: { id: true, plate: true, status: true, capacityLiters: true },
  });

  const subtotal = Number(order.subtotal);
  const creditLimit = order.customer.creditLimit ? Number(order.customer.creditLimit) : null;
  const creditUsed = Number(order.customer.creditUsed);

  // วงเงินที่จะใช้ "รวมออเดอร์นี้" (ออเดอร์ยังเปิดอยู่ → ยอดนี้ยังไม่ถูกบวกใน creditUsed)
  const projectedUsed = creditUsed + subtotal;
  const overLimit = creditLimit != null && projectedUsed > creditLimit;
  const amountOver = overLimit && creditLimit != null ? Math.round((projectedUsed - creditLimit) * 100) / 100 : 0;

  return {
    order,
    trucks,
    credit: {
      creditLimit,
      creditUsed,
      subtotal,
      projectedUsed,
      overLimit,
      amountOver,
      overrideApproved: order.creditOverride,
    },
  };
}
