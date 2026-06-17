// ClawHub (JOLLY PLAY) — member lifecycle.
// getOrCreateMember is idempotent on (orgId, externalLineId); member codes are
// CH-YYYY-NNNN, sequential per calendar year (AD year), unique per org.

import { prisma } from "@/lib/prisma";
import type { ClawhubMember } from "@/lib/generated/prisma/client";
import type { MemberUpsertInput } from "./types";

/**
 * Generate the next CH-YYYY-NNNN code for the org. Sequential per AD year:
 * counts existing members created this year and adds 1, zero-padded to 4 digits.
 * Caller should retry on unique-collision (concurrent signups) — see
 * getOrCreateMember which loops a few times.
 */
export async function generateMemberCode(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);
  const nextYearStart = new Date(year + 1, 0, 1);

  const countThisYear = await prisma.clawhubMember.count({
    where: { orgId, createdAt: { gte: yearStart, lt: nextYearStart } },
  });

  const seq = (countThisYear + 1).toString().padStart(4, "0");
  return `CH-${year}-${seq}`;
}

/**
 * Find the member for this LINE user in this org, or create one.
 * Idempotent on (orgId, externalLineId). Refreshes display name / picture on the
 * way in (LINE profiles change). Retries member-code generation on collision.
 */
export async function getOrCreateMember(
  orgId: string,
  input: MemberUpsertInput,
): Promise<ClawhubMember> {
  const existing = await prisma.clawhubMember.findUnique({
    where: { orgId_externalLineId: { orgId, externalLineId: input.lineUserId } },
  });

  if (existing) {
    // Refresh denormalized profile fields if LINE sent newer values.
    const needsUpdate =
      (input.displayName !== undefined && input.displayName !== existing.displayName) ||
      (input.pictureUrl !== undefined && input.pictureUrl !== existing.pictureUrl);
    if (!needsUpdate) return existing;
    return prisma.clawhubMember.update({
      where: { id: existing.id },
      data: {
        displayName: input.displayName ?? existing.displayName,
        pictureUrl: input.pictureUrl ?? existing.pictureUrl,
      },
    });
  }

  // Create — retry on member-code unique collision (concurrent first signups).
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const memberCode = await generateMemberCode(orgId);
    try {
      return await prisma.clawhubMember.create({
        data: {
          orgId,
          externalLineId: input.lineUserId,
          displayName: input.displayName ?? null,
          pictureUrl: input.pictureUrl ?? null,
          memberCode,
        },
      });
    } catch (err: unknown) {
      lastErr = err;
      // Another request created this LINE user first → return that row.
      const raced = await prisma.clawhubMember.findUnique({
        where: { orgId_externalLineId: { orgId, externalLineId: input.lineUserId } },
      });
      if (raced) return raced;
      // Otherwise it was a memberCode collision → loop and regenerate.
    }
  }
  throw new Error(
    `[clawhub] getOrCreateMember failed after retries: ${String(lastErr)}`,
  );
}

/**
 * Update a member's editable profile (full name / phone / address) — used by the
 * register + redemption screens to capture/prefill contact info.
 * Only writes the fields the caller actually passed (undefined = leave as-is), trims
 * whitespace, and ignores empty strings (an empty box never wipes existing data).
 * No-op (returns the current row) if nothing meaningful was provided.
 */
export async function updateMemberProfile(
  memberId: string,
  data: {
    fullName?: string;
    phone?: string;
    address?: string;
    /** ISO date "YYYY-MM-DD" — stored as a date; empty/invalid is ignored. */
    birthDate?: string;
    /** ชาย / หญิง / ไม่ระบุ (free text — just trimmed). */
    gender?: string;
  },
): Promise<ClawhubMember> {
  const clean = (v: string | undefined): string | undefined => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === "" ? undefined : t;
  };

  // Parse an ISO "YYYY-MM-DD" into a UTC Date (date-only). Returns undefined for
  // empty/garbage so an empty box never wipes existing data and a typo never throws.
  const cleanBirthDate = (v: string | undefined): Date | undefined => {
    const s = clean(v);
    if (s === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return undefined;
    // Reject clearly-impossible dates (future birthday or absurdly old).
    const year = d.getUTCFullYear();
    if (year < 1900 || d.getTime() > Date.now()) return undefined;
    return d;
  };

  const patch: {
    fullName?: string;
    phone?: string;
    address?: string;
    birthDate?: Date;
    gender?: string;
  } = {};
  const fullName = clean(data.fullName);
  const phone = clean(data.phone);
  const address = clean(data.address);
  const birthDate = cleanBirthDate(data.birthDate);
  const gender = clean(data.gender);
  if (fullName !== undefined) patch.fullName = fullName;
  if (phone !== undefined) patch.phone = phone;
  if (address !== undefined) patch.address = address;
  if (birthDate !== undefined) patch.birthDate = birthDate;
  if (gender !== undefined) patch.gender = gender;

  if (Object.keys(patch).length === 0) {
    return prisma.clawhubMember.findUniqueOrThrow({ where: { id: memberId } });
  }

  return prisma.clawhubMember.update({ where: { id: memberId }, data: patch });
}

/** Record PDPA consent timestamp (idempotent — only sets if not already set). */
export async function setConsent(memberId: string): Promise<ClawhubMember> {
  return prisma.clawhubMember.update({
    where: { id: memberId },
    data: { consentAt: new Date() },
  });
}
