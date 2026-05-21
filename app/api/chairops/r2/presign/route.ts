// POST /api/r2/presign
// Returns a presigned URL for direct client-side upload to Cloudflare R2.
// Auth required. Branch-scoped (Maid only allowed for her primary branch).
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/chairops/auth/session";
import { canSeeBranch } from "@/lib/chairops/auth/role-guards";
import { prisma } from "@/lib/prisma";
import {
  presignUpload,
  evidenceKey,
  cleanlinessKey,
  damageKey,
} from "@/lib/chairops/storage/r2";

type Kind = "cash-evidence" | "cleanliness" | "damage";
const KINDS: ReadonlyArray<Kind> = ["cash-evidence", "cleanliness", "damage"];

interface Body {
  kind?: string;
  branchSlug?: string;
  contextId?: string;
  contentType?: string;
  // Optional index for multi-photo uploads (cleanliness/damage)
  index?: number;
  // Optional extension override (default: jpg)
  ext?: string;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { kind, branchSlug, contextId, contentType, index, ext } = body;

  if (!kind || !KINDS.includes(kind as Kind)) {
    return NextResponse.json(
      { error: "invalid-kind", allowed: KINDS },
      { status: 400 }
    );
  }
  if (!branchSlug || typeof branchSlug !== "string") {
    return NextResponse.json({ error: "missing-branchSlug" }, { status: 400 });
  }
  if (!contextId || typeof contextId !== "string") {
    return NextResponse.json({ error: "missing-contextId" }, { status: 400 });
  }
  if (!contentType || typeof contentType !== "string") {
    return NextResponse.json({ error: "missing-contentType" }, { status: 400 });
  }
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "image-only" }, { status: 400 });
  }

  // Branch scoping — verify the user is allowed to upload to this branch.
  const branch = await prisma.chairopsBranch.findUnique({
    where: { slug: branchSlug },
    select: { id: true, slug: true },
  });
  if (!branch) {
    return NextResponse.json({ error: "branch-not-found" }, { status: 404 });
  }
  if (!canSeeBranch(session.user, branch.id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const safeExt = sanitizeExt(ext) ?? extFromContentType(contentType);
  const safeIdx = Number.isFinite(index) ? Math.max(0, Math.floor(index as number)) : 1;
  const safeContextId = contextId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);

  let key: string;
  switch (kind as Kind) {
    case "cash-evidence":
      key = evidenceKey(branch.slug, safeContextId, safeExt);
      break;
    case "cleanliness":
      key = cleanlinessKey(branch.slug, safeContextId, safeIdx, safeExt);
      break;
    case "damage":
      key = damageKey(branch.slug, safeContextId, safeIdx, safeExt);
      break;
  }

  const { url, publicUrl } = await presignUpload(key, contentType);
  return NextResponse.json({ url, publicUrl, key });
}

function sanitizeExt(ext?: string): string | null {
  if (!ext) return null;
  const e = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!e || e.length > 5) return null;
  return e;
}

function extFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/gif": "gif",
  };
  return map[contentType.toLowerCase()] ?? "jpg";
}
