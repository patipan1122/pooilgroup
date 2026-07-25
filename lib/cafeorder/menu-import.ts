// CafeOrder · bulk menu import (parse xlsx/csv → preview → commit).
//   upsert key = (orgId, brand, name) → re-import = อัปเดต ไม่สร้างซ้ำ (idempotent โดยธรรมชาติ
//   ด้วย @@unique([orgId,brand,name]) ที่ DB — ไม่ต้องพึ่ง idempotencyKey แยก).
//   ตัวเลขราคา (บาท) → satang (×100) integer. ราคาบิลลูกค้าจริงคิดที่ server ตอนสั่ง.
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { CafeBrand, CafeItemKind, CafeTemp, CafeSize } from "@/lib/generated/prisma/enums";

export type ImportRow = {
  rowNo: number;
  categoryName: string;
  name: string;
  kind: CafeItemKind;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  variants: { temp: CafeTemp | null; size: CafeSize; priceCents: number }[];
  error?: string;
};

export type ParseResult = {
  rows: ImportRow[];
  fileErrors: string[];
};

/** จับ header ไทยแบบยืดหยุ่น (contains) → index ของคอลัมน์ */
function headerIndex(headers: string[]): Record<string, number> {
  const find = (...keys: string[]) =>
    headers.findIndex((h) => keys.some((k) => (h ?? "").toString().replace(/\s+/g, "").includes(k)));
  return {
    category: find("หมวด"),
    name: find("ชื่อเมนู", "ชื่อ"),
    kind: find("ประเภท"),
    desc: find("คำอธิบาย"),
    image: find("รูป"),
    active: find("เปิดขาย"),
    hot: find("ราคาร้อน"),
    iced: find("ราคาเย็น"),
    blended: find("ราคาปั่น"),
    single: find("ราคาเดี่ยว"),
    upsize: find("อัพไซส์", "ใหญ่"),
  };
}

function toCents(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function parseWorkbook(buffer: Buffer): ParseResult {
  const fileErrors: string[] = [];
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { rows: [], fileErrors: ["อ่านไฟล์ไม่ได้ — ต้องเป็น .xlsx หรือ .csv"] };
  }
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return { rows: [], fileErrors: ["ไฟล์ว่าง"] };

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  if (grid.length < 2) return { rows: [], fileErrors: ["ไม่มีข้อมูล (ต้องมี header + อย่างน้อย 1 แถว)"] };

  const headers = (grid[0] as unknown[]).map((h) => String(h ?? ""));
  const idx = headerIndex(headers);
  if (idx.name < 0 || idx.category < 0) {
    fileErrors.push("ไม่พบคอลัมน์ 'หมวด' หรือ 'ชื่อเมนู' — ใช้ template ที่ดาวน์โหลด");
    return { rows: [], fileErrors };
  }

  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i] as unknown[];
    const get = (j: number) => (j >= 0 ? cells[j] : undefined);
    const name = String(get(idx.name) ?? "").trim();
    const categoryName = String(get(idx.category) ?? "").trim();
    if (!name && !categoryName) continue; // แถวว่าง

    const rowNo = i + 1;
    const kindRaw = String(get(idx.kind) ?? "").trim();
    const kind = kindRaw.includes("กิน") || kindRaw.toLowerCase().includes("food") ? CafeItemKind.food : CafeItemKind.drink;
    const activeRaw = String(get(idx.active) ?? "Y").trim().toUpperCase();
    const isActive = !(activeRaw === "N" || activeRaw === "NO" || activeRaw === "0" || activeRaw === "ปิด");

    const variants: ImportRow["variants"] = [];
    const upsize = toCents(get(idx.upsize));
    const addTemp = (temp: CafeTemp, j: number) => {
      const c = toCents(get(j));
      if (c !== null) {
        variants.push({ temp, size: CafeSize.regular, priceCents: c });
        if (upsize !== null) variants.push({ temp, size: CafeSize.large, priceCents: c + upsize });
      }
    };
    if (kind === CafeItemKind.food) {
      const c = toCents(get(idx.single)) ?? toCents(get(idx.hot));
      if (c !== null) variants.push({ temp: null, size: CafeSize.regular, priceCents: c });
    } else {
      addTemp(CafeTemp.hot, idx.hot);
      addTemp(CafeTemp.iced, idx.iced);
      addTemp(CafeTemp.blended, idx.blended);
    }

    let error: string | undefined;
    if (!name) error = "ไม่มีชื่อเมนู";
    else if (!categoryName) error = "ไม่มีหมวด";
    else if (!variants.length) error = "ไม่มีราคา";
    else if (seen.has(name.toLowerCase())) error = "ชื่อซ้ำในไฟล์";
    seen.add(name.toLowerCase());

    rows.push({
      rowNo,
      categoryName,
      name,
      kind,
      description: (String(get(idx.desc) ?? "").trim() || null),
      imageUrl: (String(get(idx.image) ?? "").trim() || null),
      isActive,
      variants,
      error,
    });
  }
  return { rows, fileErrors };
}

export type ImportPreview = {
  toCreate: number;
  toUpdate: number;
  errors: number;
  rows: (ImportRow & { action: "create" | "update" | "skip" })[];
};

/** เทียบกับของที่มีอยู่ (upsert by orgId+brand+name) → บอกว่าจะสร้าง/อัปเดต/ข้าม */
export async function previewImport(orgId: string, brand: CafeBrand, parsed: ImportRow[]): Promise<ImportPreview> {
  const names = parsed.filter((r) => !r.error).map((r) => r.name);
  const existing = names.length
    ? await prisma.cafeMenuItem.findMany({ where: { orgId, brand, name: { in: names } }, select: { name: true } })
    : [];
  const existingSet = new Set(existing.map((e) => e.name));
  let toCreate = 0, toUpdate = 0, errors = 0;
  const rows = parsed.map((r) => {
    let action: "create" | "update" | "skip";
    if (r.error) { action = "skip"; errors++; }
    else if (existingSet.has(r.name)) { action = "update"; toUpdate++; }
    else { action = "create"; toCreate++; }
    return { ...r, action };
  });
  return { toCreate, toUpdate, errors, rows };
}

export type CommitResult = { created: number; updated: number; skipped: number };

/** บันทึกจริง — upsert category + item + variants (replace variants ในทรานแซกชันต่อ item). */
export async function commitImport(orgId: string, brand: CafeBrand, parsed: ImportRow[]): Promise<CommitResult> {
  let created = 0, updated = 0, skipped = 0;

  // 1) upsert categories ที่พบทั้งหมด (unique orgId+brand+name)
  const catNames = Array.from(new Set(parsed.filter((r) => !r.error).map((r) => r.categoryName)));
  const catId = new Map<string, string>();
  for (const cn of catNames) {
    const cat = await prisma.cafeCategory.upsert({
      where: { orgId_brand_name: { orgId, brand, name: cn } },
      update: {},
      create: { orgId, brand, name: cn },
    });
    catId.set(cn, cat.id);
  }

  // 2) upsert แต่ละ item + variants
  for (const r of parsed) {
    if (r.error) { skipped++; continue; }
    const categoryId = catId.get(r.categoryName)!;
    const existing = await prisma.cafeMenuItem.findUnique({
      where: { orgId_brand_name: { orgId, brand, name: r.name } },
      select: { id: true },
    });
    if (existing) {
      await prisma.$transaction([
        prisma.cafeItemVariant.deleteMany({ where: { itemId: existing.id } }),
        prisma.cafeMenuItem.update({
          where: { id: existing.id },
          data: {
            categoryId,
            kind: r.kind,
            description: r.description,
            imageKey: r.imageUrl,
            isActive: r.isActive,
            variants: { create: r.variants },
          },
        }),
      ]);
      updated++;
    } else {
      await prisma.cafeMenuItem.create({
        data: {
          orgId, brand, categoryId, name: r.name, kind: r.kind,
          description: r.description, imageKey: r.imageUrl, isActive: r.isActive,
          variants: { create: r.variants },
        },
      });
      created++;
    }
  }
  return { created, updated, skipped };
}
