// Playland · เครื่องสแกนหน้า (ACS device) หลุดนาน → แจ้งเตือน LINE ทันที
//
// ทำไมต้องมี: ลงทะเบียนหน้าส่งงานเป็นคิว (PlaylandFaceSync PENDING) ให้ agent บนคอมหน้าร้าน
// ไปส่งต่อให้เครื่องสแกน — ถ้า agent/เครื่องหลุดจาก network ของร้าน งานจะค้าง ลูกค้าเจอ
// "รอนานเกินไป" ที่หน้าจอ โดยไม่มีใครรู้จนลูกค้ามาเจอเอง (postmortem 2026-09-30) — cron นี้เช็ค
// PlaylandDevice.lastSeenAt แทนการรอให้ลูกค้าเจอปัญหาก่อน
//
// Idempotency: ไม่สร้าง alert ซ้ำถ้ามี DEVICE_OFFLINE ที่ยังไม่ resolve ของเครื่องเดิมอยู่แล้ว
// (เหมือน findOpenAlert ใน lib/chairops/alerts/_shared.ts แต่ scope อยู่ใน schema playland เอง)
// เครื่องกลับมาออนไลน์ทัน resolve alert เดิมอัตโนมัติ + ส่งข้อความแจ้งว่ากลับมาแล้ว

import { prisma } from "@/lib/prisma";
import { pushPlaylandLineAlert } from "@/lib/playland/line";

export const DEVICE_OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // เงียบเกิน 10 นาที = ถือว่าหลุด

export interface DeviceWatchdogResult {
  checked: number;
  newlyOffline: { deviceId: string; deviceName: string; branchName: string }[];
  recovered: { deviceId: string; deviceName: string; branchName: string }[];
  linePushErrors: string[];
}

export async function runDeviceOfflineWatchdog(): Promise<DeviceWatchdogResult> {
  const result: DeviceWatchdogResult = { checked: 0, newlyOffline: [], recovered: [], linePushErrors: [] };
  const cutoff = new Date(Date.now() - DEVICE_OFFLINE_THRESHOLD_MS);

  // ข้าม DISABLED (ปิดใช้งานตั้งใจ) และ PAIRING (ยังตั้งค่าไม่เสร็จ ไม่เคยออนไลน์มาก่อน — ไม่ใช่ "หลุด")
  const devices = await prisma.playlandDevice.findMany({
    where: { status: { notIn: ["DISABLED", "PAIRING"] } },
    select: { id: true, orgId: true, branchId: true, deviceName: true, status: true, lastSeenAt: true, branch: { select: { name: true } } },
  });
  result.checked = devices.length;

  for (const device of devices) {
    const stale = !device.lastSeenAt || device.lastSeenAt < cutoff;

    if (stale) {
      const openAlert = await prisma.playlandAlert.findFirst({
        where: { orgId: device.orgId, branchId: device.branchId, type: "DEVICE_OFFLINE", resolvedAt: null, metadata: { path: ["deviceId"], equals: device.id } },
        select: { id: true },
      });
      if (openAlert) continue; // แจ้งไปแล้ว ไม่แจ้งซ้ำทุกรอบ cron

      await prisma.$transaction([
        prisma.playlandDevice.update({ where: { id: device.id }, data: { status: "OFFLINE" } }),
        prisma.playlandAlert.create({
          data: {
            orgId: device.orgId,
            branchId: device.branchId,
            type: "DEVICE_OFFLINE",
            severity: "DANGER",
            title: `เครื่องสแกนหน้าหลุด · ${device.branch.name}`,
            message: `${device.deviceName} ไม่ตอบสนองเกิน ${Math.round(DEVICE_OFFLINE_THRESHOLD_MS / 60000)} นาที — ลูกค้าที่ลงทะเบียนหน้าจะเจอ "รอนานเกินไป" จนกว่าจะแก้ (เช็คคอม/agent หน้าร้านหรือเครื่องสแกนที่ประตู)`,
            metadata: { deviceId: device.id },
          },
        }),
      ]);
      result.newlyOffline.push({ deviceId: device.id, deviceName: device.deviceName, branchName: device.branch.name });

      const push = await pushPlaylandLineAlert(
        `🔴 เครื่องสแกนหน้าหลุด\nสาขา: ${device.branch.name}\nเครื่อง: ${device.deviceName}\nเงียบเกิน ${Math.round(DEVICE_OFFLINE_THRESHOLD_MS / 60000)} นาที — ลูกค้าลงทะเบียนหน้าจะค้าง ช่วยเช็คคอม/เครื่องที่ร้านด้วยครับ`,
      );
      if (!push.ok && push.error !== "no-token") result.linePushErrors.push(`${device.deviceName}: ${push.error}`);
    } else if (device.status === "OFFLINE") {
      // กลับมาออนไลน์แล้ว (lastSeenAt สดอีกครั้ง) แต่ status ยังค้าง OFFLINE จากรอบที่แล้ว → เคลียร์ alert
      const openAlert = await prisma.playlandAlert.findFirst({
        where: { orgId: device.orgId, branchId: device.branchId, type: "DEVICE_OFFLINE", resolvedAt: null, metadata: { path: ["deviceId"], equals: device.id } },
        select: { id: true },
      });
      await prisma.$transaction([
        prisma.playlandDevice.update({ where: { id: device.id }, data: { status: "ONLINE" } }),
        ...(openAlert ? [prisma.playlandAlert.update({ where: { id: openAlert.id }, data: { resolvedAt: new Date() } })] : []),
      ]);
      if (openAlert) {
        result.recovered.push({ deviceId: device.id, deviceName: device.deviceName, branchName: device.branch.name });
        const push = await pushPlaylandLineAlert(`✅ เครื่องสแกนหน้ากลับมาแล้ว\nสาขา: ${device.branch.name}\nเครื่อง: ${device.deviceName}`);
        if (!push.ok && push.error !== "no-token") result.linePushErrors.push(`${device.deviceName}: ${push.error}`);
      }
    }
  }

  return result;
}
