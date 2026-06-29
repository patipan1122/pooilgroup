import "server-only";

// DC Warehouse · LANDED-COST → cost-layer → stock-posting → TRCloud bridge.
//
// Pipeline (per GRN — the cost is finalised PER SHIPMENT/GRN, not per PO):
//   1. buildCostLayersForGrn → compute landed cost, write immutable DcCostLayer rows
//      (one per GRN line), link each line.costLayerId. IDEMPOTENT.
//   2. postGrnStock        → recordMovement(RECEIVE) per line, carrying the landed
//      unit cost + costLayerId. IDEMPOTENT via sourceKey.
//   3. pushGrnToTrcloud    → NON-BLOCKING best-effort stock-IN into TRCloud; if env
//      unconfigured it parks an outbox event and returns posted:false (never throws).
//   processGrnFull          → runs 1→2→3 and returns the combined result.
//
// ZERO-COST-COLUMN balances: the landed unit cost lives on the cost LAYER; the stock
// movement only snapshots it. Import VAT is split out (claimable), never capitalised.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { DcMoveKind, DcPostStatus, DcOutboxStatus } from "@/lib/generated/prisma/enums";
import { recordMovement } from "@/lib/dc/stock";
import { sourceKey } from "@/lib/dc/codes";
import { computeLandedCost, type LandedCostInputLine } from "@/lib/dc/landed-cost";
import { loadFreightRates } from "@/lib/dc/freight-rates";
import { pushStockIn, type StockInLine } from "@/lib/ledger/trcloud-inventory";

const IMPORT_VAT_RATE = 0.07;

function dec(v: Prisma.Decimal | null | undefined): number {
  return v == null ? 0 : Number(v.toString());
}

// ── 1. cost layers ────────────────────────────────────────────────────────────

export type CostLayerOut = {
  id: string;
  productId: string;
  qty: number;
  landedUnitSatang: number;
  goodsThbSatang: number;
  dutyThbSatang: number;
  freightThbSatang: number;
  brokerThbSatang: number;
  insuranceThbSatang: number;
  vatClaimableSatang: number;
};

export type BuildCostLayersResult =
  | { ok: true; layers: CostLayerOut[]; alreadyBuilt: boolean }
  | { ok: false; error: string };

/**
 * Load a GRN + its lines + the linked shipment (cost buckets) + PO lines (CNY price,
 * CBM), compute the landed cost, and create one immutable DcCostLayer per GRN line,
 * linking each line.costLayerId. Wrapped in one $transaction. IDEMPOTENT — if the GRN
 * already has cost layers it returns them untouched (alreadyBuilt:true).
 */
export async function buildCostLayersForGrn(grnId: string): Promise<BuildCostLayersResult> {
  const grn = await prisma.dcGoodsReceipt.findUnique({
    where: { id: grnId },
    select: {
      id: true,
      orgId: true,
      shipmentId: true,
      poId: true,
      lines: {
        select: { id: true, productId: true, qtyReceived: true, qtyExpected: true, costLayerId: true },
      },
    },
  });
  if (!grn) return { ok: false, error: "ไม่พบใบรับสินค้า (GRN)" };
  const orgId = grn.orgId;

  // Idempotency: any existing cost layer for this GRN → return them, don't rebuild.
  const existing = await prisma.dcCostLayer.findMany({
    where: { orgId, grnId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      productId: true,
      qty: true,
      landedUnitSatang: true,
      goodsThbSatang: true,
      dutyThbSatang: true,
      freightThbSatang: true,
      brokerThbSatang: true,
      insuranceThbSatang: true,
      vatClaimableSatang: true,
    },
  });
  if (existing.length > 0) {
    return { ok: true, alreadyBuilt: true, layers: existing.map(toCostLayerOut) };
  }

  if (grn.lines.length === 0) return { ok: false, error: "ใบรับสินค้านี้ไม่มีรายการ" };

  // Shipment carries the capitalisable cost buckets + fx. No shipment → costs are 0
  // and fx must come from the PO (else 1:1 → goods-only landed cost, still valid).
  const shipment = grn.shipmentId
    ? await prisma.dcShipment.findFirst({
        where: { id: grn.shipmentId, orgId },
        select: {
          id: true,
          chinaFreightThbSatang: true,
          intlFreightThbSatang: true,
          dutyThbSatang: true,
          brokerThbSatang: true,
          insuranceThbSatang: true,
          fxRate: true,
          fxDate: true,
          lines: { select: { productId: true, cbm: true } },
        },
      })
    : null;

  // PO lines give CNY unit price + CBM-per-unit per product (the price source).
  const poLines = grn.poId
    ? await prisma.dcPurchaseLine.findMany({
        where: { orgId, poId: grn.poId },
        select: { productId: true, unitPriceCny: true, cbmPerUnit: true },
      })
    : [];
  const po = grn.poId
    ? await prisma.dcPurchaseOrder.findFirst({
        where: { id: grn.poId, orgId },
        select: { fxRate: true, origin: true, currency: true },
      })
    : null;

  const poByProduct = new Map(poLines.map((l) => [l.productId, l]));
  // Shipment-line CBM overrides PO cbmPerUnit when present (shipment is the truth for volume).
  const shipCbmByProduct = new Map<string, number | null>();
  for (const sl of shipment?.lines ?? []) {
    shipCbmByProduct.set(sl.productId, sl.cbm == null ? null : dec(sl.cbm));
  }

  // fx: shipment fx wins, else PO fx, else 1 (no conversion).
  // ⚠️ ใบไทย (origin THAI / currency THB): ราคาเป็นบาทอยู่แล้ว → ห้ามคูณเรตอีก (ไม่งั้นต้นทุนพอง ×เรต ≈ ×5).
  //    บังคับ fx = 1 เสมอ ไม่ว่า PO/shipment จะเผลอเก็บเรตไว้ (เช่น เรต CNY ค้างจากตอนกรอก).
  const poIsThai = po?.origin === "THAI" || po?.currency === "THB";
  const fxRate = poIsThai
    ? 1
    : shipment?.fxRate != null
      ? dec(shipment.fxRate)
      : po?.fxRate != null
        ? dec(po.fxRate)
        : 1;
  const fxDate = shipment?.fxDate ?? new Date();

  const dutyThbSatang = shipment?.dutyThbSatang ?? 0;
  const brokerThbSatang = shipment?.brokerThbSatang ?? 0;
  const insuranceThbSatang = shipment?.insuranceThbSatang ?? 0;

  // Build engine input — receive qty drives cost (we capitalise what actually arrived).
  const engineLines: LandedCostInputLine[] = grn.lines.map((gl) => {
    const pl = poByProduct.get(gl.productId);
    const goodsCnyUnit = pl ? dec(pl.unitPriceCny) : 0;
    // CBM-per-unit: shipment line first, then PO cbmPerUnit.
    const shipCbm = shipCbmByProduct.has(gl.productId) ? shipCbmByProduct.get(gl.productId)! : undefined;
    const cbm = shipCbm != null ? shipCbm : pl?.cbmPerUnit != null ? dec(pl.cbmPerUnit) : null;
    return { productId: gl.productId, qty: gl.qtyReceived, goodsCnyUnit, cbm };
  });

  // #4 (CEO 2026-06-29): ค่าขนส่งจีน-ไทย เข้าต้นทุน landed = ปริมาตร(CBM) ของ "ใบรับนี้" × เรตต่อคิว.
  //   คิดตามวอลุ่มที่รับจริงในใบนี้ → รับแบ่งหลายงวด (PARTIAL) ก็ไม่คิดค่าขนส่งซ้ำ (แต่ละใบจ่ายตามวอลุ่มตัวเอง).
  //   เรตเลือกจาก mode ของชิปเมนต์ในใบ PO (ใบแรก) · ยังไม่ตั้งเรต → fallback ยอด freight เดิมที่กรอกมือไว้.
  const poShipments = grn.poId
    ? await prisma.dcShipment.findMany({
        where: { orgId, poId: grn.poId },
        select: { mode: true, chinaFreightThbSatang: true, intlFreightThbSatang: true },
      })
    : [];
  const freightRates = await loadFreightRates(orgId);
  const ratesSet = freightRates.TRUCK > 0 || freightRates.SEA > 0;
  const poMode = poShipments[0]?.mode ?? "SEA";
  const ratePerCbm = poMode === "SEA" ? freightRates.SEA : freightRates.TRUCK;
  const grnVolume = engineLines.reduce((s, l) => s + (l.cbm != null && l.cbm > 0 ? l.cbm * l.qty : 0), 0);
  const freightThbSatang = ratesSet
    ? Math.round(grnVolume * ratePerCbm)
    : (shipment?.chinaFreightThbSatang ?? 0) + (shipment?.intlFreightThbSatang ?? 0);

  const computed = computeLandedCost({
    lines: engineLines,
    fxRate,
    dutyThbSatang,
    freightThbSatang,
    brokerThbSatang,
    insuranceThbSatang,
    importVatRate: IMPORT_VAT_RATE,
  });

  // Map computed line → GRN line (positional — engineLines mirror grn.lines order).
  try {
    const created = await prisma.$transaction(async (tx) => {
      // Re-check inside the tx (guards a race where two callers build at once).
      const dup = await tx.dcCostLayer.count({ where: { orgId, grnId } });
      if (dup > 0) {
        const rows = await tx.dcCostLayer.findMany({
          where: { orgId, grnId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            productId: true,
            qty: true,
            landedUnitSatang: true,
            goodsThbSatang: true,
            dutyThbSatang: true,
            freightThbSatang: true,
            brokerThbSatang: true,
            insuranceThbSatang: true,
            vatClaimableSatang: true,
          },
        });
        return { rows: rows.map(toCostLayerOut), reused: true as const };
      }

      const out: CostLayerOut[] = [];
      for (let i = 0; i < grn.lines.length; i++) {
        const gl = grn.lines[i];
        const c = computed.lines[i];
        const pl = poByProduct.get(gl.productId);
        const layer = await tx.dcCostLayer.create({
          data: {
            orgId,
            productId: gl.productId,
            grnId,
            shipmentId: grn.shipmentId ?? null,
            qty: c.qty,
            cnyUnitCost: new Prisma.Decimal(pl ? dec(pl.unitPriceCny) : 0),
            fxRate: new Prisma.Decimal(fxRate),
            fxDate,
            goodsThbSatang: c.goodsThbSatang,
            dutyThbSatang: c.dutyAllocSatang,
            freightThbSatang: c.freightAllocSatang,
            brokerThbSatang: c.brokerAllocSatang,
            insuranceThbSatang: c.insuranceAllocSatang,
            otherThbSatang: 0,
            landedUnitSatang: c.landedUnitSatang,
            vatClaimableSatang: c.vatClaimableSatang,
          },
          select: {
            id: true,
            productId: true,
            qty: true,
            landedUnitSatang: true,
            goodsThbSatang: true,
            dutyThbSatang: true,
            freightThbSatang: true,
            brokerThbSatang: true,
            insuranceThbSatang: true,
            vatClaimableSatang: true,
          },
        });
        await tx.dcGoodsReceiptLine.update({ where: { id: gl.id }, data: { costLayerId: layer.id } });
        out.push(toCostLayerOut(layer));
      }
      return { rows: out, reused: false as const };
    });
    return { ok: true, layers: created.rows, alreadyBuilt: created.reused };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "สร้างต้นทุนนำเข้าไม่สำเร็จ" };
  }
}

function toCostLayerOut(r: {
  id: string;
  productId: string;
  qty: number;
  landedUnitSatang: number;
  goodsThbSatang: number;
  dutyThbSatang: number;
  freightThbSatang: number;
  brokerThbSatang: number;
  insuranceThbSatang: number;
  vatClaimableSatang: number;
}): CostLayerOut {
  return {
    id: r.id,
    productId: r.productId,
    qty: r.qty,
    landedUnitSatang: r.landedUnitSatang,
    goodsThbSatang: r.goodsThbSatang,
    dutyThbSatang: r.dutyThbSatang,
    freightThbSatang: r.freightThbSatang,
    brokerThbSatang: r.brokerThbSatang,
    insuranceThbSatang: r.insuranceThbSatang,
    vatClaimableSatang: r.vatClaimableSatang,
  };
}

// ── 2. post stock (RECEIVE) ─────────────────────────────────────────────────────

export type PostGrnStockResult =
  | { ok: true; posted: number; skipped: number }
  | { ok: false; error: string };

/**
 * Post each GRN line as a RECEIVE movement carrying the landed unit cost + costLayerId.
 * IDEMPOTENT via sourceKey("grn", grnId, lineId) — a replay is a no-op. Movements are
 * marked postStatus=PENDING (awaiting the TRCloud push to flip them POSTED).
 */
export async function postGrnStock(grnId: string): Promise<PostGrnStockResult> {
  const grn = await prisma.dcGoodsReceipt.findUnique({
    where: { id: grnId },
    select: {
      id: true,
      orgId: true,
      warehouseId: true,
      lines: { select: { id: true, productId: true, qtyReceived: true, costLayerId: true } },
    },
  });
  if (!grn) return { ok: false, error: "ไม่พบใบรับสินค้า (GRN)" };

  // Cost layers must exist first (caller runs buildCostLayersForGrn). Map line→layer.
  const layers = await prisma.dcCostLayer.findMany({
    where: { orgId: grn.orgId, grnId },
    select: { id: true, productId: true, landedUnitSatang: true },
  });
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const layerByProduct = new Map(layers.map((l) => [l.productId, l]));

  let posted = 0;
  let skipped = 0;
  for (const gl of grn.lines) {
    if (gl.qtyReceived <= 0) {
      skipped++;
      continue;
    }
    // ใช้ "cost layer ของบรรทัดเอง" (gl.costLayerId) เป็นหลัก — buildCostLayersForGrn ลิงก์ไว้
    // ต่อบรรทัดแล้ว → ต้นทุนตรงบรรทัดนั้นเป๊ะ. fallback by-product เฉพาะกรณีบรรทัดเก่าที่ยังไม่ลิงก์.
    const layer = gl.costLayerId
      ? layerById.get(gl.costLayerId) ?? layerByProduct.get(gl.productId)
      : layerByProduct.get(gl.productId);
    if (!layer) return { ok: false, error: `ยังไม่ได้สร้างต้นทุนนำเข้าของสินค้า ${gl.productId}` };

    const r = await recordMovement({
      orgId: grn.orgId,
      warehouseId: grn.warehouseId,
      productId: gl.productId,
      kind: DcMoveKind.RECEIVE,
      qty: gl.qtyReceived,
      unitCostSatang: layer.landedUnitSatang,
      costLayerId: layer.id,
      sourceKey: sourceKey("grn", grnId, gl.id),
      refType: "grn",
      refId: grnId,
      postStatus: DcPostStatus.PENDING,
    });
    if (!r.ok) return { ok: false, error: r.error };
    if (!r.duplicate) posted++;
    else skipped++;
  }
  return { ok: true, posted, skipped };
}

// ── 3. push to TRCloud (non-blocking, best-effort) ──────────────────────────────

export type PushGrnResult = {
  ok: boolean;
  posted: boolean;
  docId?: string | null;
  docNo?: string | null;
  reason?: string;
  error?: string;
};

/**
 * NON-BLOCKING best-effort push of the GRN as a TRCloud stock-IN. NEVER throws.
 *
 *   • env DC_TRCLOUD_COMPANY_ID + DC_TRCLOUD_PROJECT (สาขา — required by TRCloud).
 *   • Unconfigured OR project missing → GRN.postStatus=PENDING + park an outbox event
 *     (status PENDING) and return {posted:false, reason}.
 *   • Configured → build StockInLine[] from the cost layers (NET landed unit price in
 *     THB, VAT 7% per line so TRCloud separates input VAT), call pushStockIn.
 *       on ok   → GRN.postStatus=POSTED + related movements POSTED + outbox ACKED.
 *       on fail → GRN.postStatus=FAILED + outbox FAILED + lastError.
 */
export async function pushGrnToTrcloud(grnId: string): Promise<PushGrnResult> {
  try {
    const grn = await prisma.dcGoodsReceipt.findUnique({
      where: { id: grnId },
      select: {
        id: true,
        orgId: true,
        grnCode: true,
        note: true,
        receivedAt: true,
        poId: true,
      },
    });
    if (!grn) return { ok: false, posted: false, error: "ไม่พบใบรับสินค้า (GRN)" };
    const orgId = grn.orgId;
    const reference = grn.grnCode; // idempotency key inside TRCloud (search-by-reference)
    const obSourceKey = sourceKey("grn-trcloud", grnId);

    const companyId = process.env.DC_TRCLOUD_COMPANY_ID ?? "";
    const project = process.env.DC_TRCLOUD_PROJECT ?? "";
    const department = process.env.DC_TRCLOUD_DEPARTMENT ?? "";

    // Build the payload from cost layers (the net landed price is what we capitalise).
    const layers = await prisma.dcCostLayer.findMany({
      where: { orgId, grnId },
      select: { productId: true, qty: true, landedUnitSatang: true },
    });
    const products = await prisma.dcProduct.findMany({
      where: { orgId, id: { in: layers.map((l) => l.productId) } },
      select: { id: true, name: true, trcloudProductCode: true, trcloudSkuId: true },
    });
    const prodById = new Map(products.map((p) => [p.id, p]));

    const lines: StockInLine[] = layers
      .filter((l) => l.qty > 0)
      .map((l) => {
        const p = prodById.get(l.productId);
        return {
          productId: p?.trcloudProductCode ?? p?.trcloudSkuId ?? l.productId,
          productName: p?.name ?? l.productId,
          quantity: l.qty,
          // landed unit cost is satang → THB for TRCloud (net, VAT-exclusive).
          unitCost: l.landedUnitSatang / 100,
          vatRatePercent: "7",
        };
      });

    const payload = {
      grnId,
      grnCode: grn.grnCode,
      reference,
      companyId,
      project,
      department,
      lines,
    };

    // Unconfigured OR project missing → park outbox, mark PENDING, return non-posted.
    if (!companyId || !project) {
      await prisma.dcOutboxEvent.upsert({
        where: { orgId_sourceKey_eventType: { orgId, sourceKey: obSourceKey, eventType: "trcloud_stock_in" } },
        update: { payload, status: DcOutboxStatus.PENDING, lastError: null },
        create: {
          orgId,
          eventType: "trcloud_stock_in",
          sourceKey: obSourceKey,
          targetModule: "trcloud",
          payload,
          status: DcOutboxStatus.PENDING,
        },
      });
      await prisma.dcGoodsReceipt.update({ where: { id: grnId }, data: { postStatus: DcPostStatus.PENDING } });
      return { ok: true, posted: false, reason: "ยังไม่ได้ตั้งค่า TRCloud (env DC_TRCLOUD_*)" };
    }

    if (lines.length === 0) {
      return { ok: true, posted: false, reason: "ไม่มีรายการสินค้าให้รับเข้า TRCloud" };
    }

    // Vendor info from the PO supplier (if any) — TRCloud resolves the contact.
    let vendor: string | null = null;
    let vendorTaxId: string | null = null;
    let vendorAddress: string | null = null;
    if (grn.poId) {
      const po = await prisma.dcPurchaseOrder.findFirst({
        where: { id: grn.poId, orgId },
        select: { supplier: { select: { name: true, contact: true } } },
      });
      if (po?.supplier) {
        vendor = po.supplier.name;
        vendorAddress = po.supplier.contact ?? null;
      }
    }

    const res = await pushStockIn({
      vendor,
      vendorTaxId,
      vendorAddress,
      orgId,
      companyId,
      docDate: grn.receivedAt ?? new Date(),
      reference,
      note: grn.note ?? `DC รับเข้าคลัง · ${grn.grnCode}`,
      project,
      department: department || null,
      paymentStatus: "credit",
      taxReport: true, // import VAT is claimable input VAT
      lines,
    });

    if (res.ok) {
      await prisma.$transaction([
        prisma.dcGoodsReceipt.update({ where: { id: grnId }, data: { postStatus: DcPostStatus.POSTED } }),
        prisma.dcStockMovement.updateMany({
          where: { orgId, refType: "grn", refId: grnId },
          data: { postStatus: DcPostStatus.POSTED },
        }),
        prisma.dcOutboxEvent.upsert({
          where: { orgId_sourceKey_eventType: { orgId, sourceKey: obSourceKey, eventType: "trcloud_stock_in" } },
          update: {
            payload: { ...payload, docId: res.docId, docNo: res.docNo },
            status: DcOutboxStatus.ACKED,
            lastError: null,
            processedAt: new Date(),
          },
          create: {
            orgId,
            eventType: "trcloud_stock_in",
            sourceKey: obSourceKey,
            targetModule: "trcloud",
            payload: { ...payload, docId: res.docId, docNo: res.docNo },
            status: DcOutboxStatus.ACKED,
            processedAt: new Date(),
          },
        }),
      ]);
      return { ok: true, posted: true, docId: res.docId, docNo: res.docNo };
    }

    // Failure → mark FAILED on GRN + outbox, record lastError. Stock stays posted in DC.
    await prisma.$transaction([
      prisma.dcGoodsReceipt.update({ where: { id: grnId }, data: { postStatus: DcPostStatus.FAILED } }),
      prisma.dcOutboxEvent.upsert({
        where: { orgId_sourceKey_eventType: { orgId, sourceKey: obSourceKey, eventType: "trcloud_stock_in" } },
        update: { payload, status: DcOutboxStatus.FAILED, lastError: res.error, attempts: { increment: 1 } },
        create: {
          orgId,
          eventType: "trcloud_stock_in",
          sourceKey: obSourceKey,
          targetModule: "trcloud",
          payload,
          status: DcOutboxStatus.FAILED,
          attempts: 1,
          lastError: res.error,
        },
      }),
    ]);
    return { ok: false, posted: false, error: res.error };
  } catch (e) {
    // Never throw — best-effort. Try to flag the GRN FAILED so the UI can show a retry.
    const msg = e instanceof Error ? e.message : "ส่ง TRCloud ไม่สำเร็จ";
    try {
      await prisma.dcGoodsReceipt.update({ where: { id: grnId }, data: { postStatus: DcPostStatus.FAILED } });
    } catch {
      /* swallow — already best-effort */
    }
    return { ok: false, posted: false, error: msg };
  }
}

// ── convenience: full pipeline ──────────────────────────────────────────────────

export type ProcessGrnFullResult = {
  ok: boolean;
  costLayers: CostLayerOut[];
  stockPosted: number;
  trcloud: PushGrnResult;
  error?: string;
};

/**
 * Convenience pipeline the GRN UI calls: build cost layers → post stock → push TRCloud.
 * Stops early (and reports) if cost-layer build or stock-posting fails; the TRCloud
 * push is always best-effort and never blocks the local receive.
 */
export async function processGrnFull(grnId: string): Promise<ProcessGrnFullResult> {
  const built = await buildCostLayersForGrn(grnId);
  if (!built.ok) {
    return { ok: false, costLayers: [], stockPosted: 0, trcloud: { ok: false, posted: false }, error: built.error };
  }

  const stock = await postGrnStock(grnId);
  if (!stock.ok) {
    return { ok: false, costLayers: built.layers, stockPosted: 0, trcloud: { ok: false, posted: false }, error: stock.error };
  }

  const trcloud = await pushGrnToTrcloud(grnId);
  return {
    ok: true,
    costLayers: built.layers,
    stockPosted: stock.posted,
    trcloud,
  };
}
