// POST /api/chairops/pos-ingest/presign
// Presigned PUT for a StarThing import file (xlsx/csv) so the browser can
// upload it straight to R2 — bypassing the ~4.5 MB Vercel server-action body
// ceiling that made large (>4.5 MB) StarThing files fail with the opaque
// "An unexpected response was received from the server." (CEO 2026-06-25).
//
// Auth: OFFICE+ (same gate as the import preview/commit actions). The returned
// key is namespaced under pos-ingest/orgs/<orgId>/ so the follow-up server
// action can verify the key belongs to the caller's org before downloading it.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { presignUpload, posIngestKey } from "@/lib/chairops/storage/r2";

interface Body {
  fileName?: string;
  contentType?: string;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (rankOf(session.user.role) < rankOf(ChairopsUserRole.OFFICE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { fileName, contentType } = body;
  if (!fileName || typeof fileName !== "string") {
    return NextResponse.json({ error: "missing-fileName" }, { status: 400 });
  }
  if (!/\.(xlsx|xls|csv)$/i.test(fileName)) {
    return NextResponse.json({ error: "ext-not-allowed" }, { status: 400 });
  }

  const ct =
    typeof contentType === "string" && contentType
      ? contentType
      : "application/octet-stream";
  const key = posIngestKey(session.user.orgId, fileName);
  const { url } = await presignUpload(key, ct);
  return NextResponse.json({ url, key });
}
