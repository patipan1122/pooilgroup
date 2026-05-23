"use server";

// Form template CRUD — let HR save reusable form layouts per org
// CEO 2026-05-23: "อยากให้มี template เซฟมาแก้ไขได้ด้วย"
//
// Built-in presets in `section-templates.ts` are always available;
// these are CUSTOM templates the org saves themselves.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canRecruitWrite } from "./role-guard";
import { FormSchemaSchema, type FormSchema } from "./types";

export async function createFormTemplate(input: {
  name: string;
  description?: string;
  schema: FormSchema;
}) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const name = input.name.trim();
  if (!name) throw new Error("ตั้งชื่อ template");
  if (name.length > 100) throw new Error("ชื่อยาวเกินไป");

  FormSchemaSchema.parse(input.schema);

  const tpl = await prisma.recruitFormTemplate.create({
    data: {
      orgId: session.user.org_id,
      name,
      description: input.description?.trim() || null,
      schema: input.schema as object,
      createdById: session.user.id,
    },
  });

  revalidatePath("/recruit/postings");
  revalidatePath("/recruit/postings/new");
  return { ok: true, id: tpl.id };
}

export async function listFormTemplates() {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const templates = await prisma.recruitFormTemplate.findMany({
    where: { orgId: session.user.org_id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      schema: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    schema: t.schema as unknown as FormSchema,
    createdAt: t.createdAt.toISOString(),
    createdByName: t.createdBy.name,
  }));
}

export async function deleteFormTemplate(id: string) {
  const session = await requireSession();
  if (!canRecruitWrite(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const existing = await prisma.recruitFormTemplate.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!existing) throw new Error("ไม่พบ template");
  if (existing.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  await prisma.recruitFormTemplate.delete({ where: { id } });
  revalidatePath("/recruit/postings");
  return { ok: true };
}
