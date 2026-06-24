"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { DC_WAREHOUSE_COOKIE, getAllowedWarehouses } from "@/lib/dc/access";

/** Switch the active warehouse (floor + office both read this cookie). */
export async function setActiveWarehouse(warehouseId: string): Promise<void> {
  const session = await requireSession();
  const allowed = await getAllowedWarehouses(session);
  if (!allowed.some((w) => w.id === warehouseId)) {
    throw new Error("ไม่มีสิทธิ์เข้าถึงคลังนี้");
  }
  const jar = await cookies();
  jar.set(DC_WAREHOUSE_COOKIE, warehouseId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/dc", "layout");
}
