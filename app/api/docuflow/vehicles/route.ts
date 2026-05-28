// /api/docuflow/vehicles — Vehicle CRUD
// POST: create vehicle (admin tier)
// GET:  list vehicles (executive)

import { NextResponse } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import {
  isAdminTier,
  isExecutiveRole,
} from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";

const CreateVehicleSchema = z.object({
  licensePlate: z.string().min(1).max(32),
  vehicleType: z.string().min(1).max(64),
  companyId: zUUID().nullable().optional(),
  branchId: zUUID().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateVehicleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const orgId = session.user.org_id;

  const dup = await prisma.vehicle.findFirst({
    where: { orgId, licensePlate: data.licensePlate },
    select: { id: true },
  });
  if (dup) {
    return NextResponse.json(
      { error: "ป้ายทะเบียนซ้ำในองค์กร" },
      { status: 409 },
    );
  }

  const created = await prisma.vehicle.create({
    data: {
      orgId,
      licensePlate: data.licensePlate,
      vehicleType: data.vehicleType,
      companyId: data.companyId ?? null,
      branchId: data.branchId ?? null,
      notes: data.notes ?? null,
      isActive: data.isActive ?? true,
    },
    select: { id: true, licensePlate: true, vehicleType: true },
  });

  await audit({
    orgId,
    userId: session.user.id,
    action: "VEHICLE_CREATE",
    resourceType: "vehicle",
    resourceId: created.id,
    diff: {
      new: {
        licensePlate: created.licensePlate,
        vehicleType: created.vehicleType,
      },
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}

const ListSchema = z.object({
  activeOnly: z.enum(["true", "false"]).optional(),
  companyId: zUUID().optional(),
  branchId: zUUID().optional(),
  vehicleType: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: Request) {
  const session = await requireSession();
  if (!isExecutiveRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const parsed = ListSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const q = parsed.data;
  const orgId = session.user.org_id;

  const vehicles = await prisma.vehicle.findMany({
    where: {
      orgId,
      ...(q.activeOnly !== "false" && { isActive: true }),
      ...(q.companyId && { companyId: q.companyId }),
      ...(q.branchId && { branchId: q.branchId }),
      ...(q.vehicleType && { vehicleType: q.vehicleType }),
      ...(q.search && {
        licensePlate: { contains: q.search, mode: "insensitive" },
      }),
    },
    orderBy: { licensePlate: "asc" },
    take: q.limit,
  });

  return NextResponse.json({ vehicles });
}
