// Cloudflare R2 (shared with Pooil) — for evidence photos
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

// Use same env var name as the rest of the codebase (lib/r2/client.ts uses R2_BUCKET).
// R2_BUCKET_NAME was a typo introduced during initial ChairOps setup — leaving a
// fallback of "chairops" which pointed at a non-existent bucket.
const BUCKET = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || "pooilgroup";

export async function presignUpload(key: string, contentType: string) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(client(), cmd, { expiresIn: 60 * 5 });
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
  return { url, publicUrl };
}

// ---------------------------------------------------------------------------
// StarThing import files (xlsx/csv) — uploaded straight to R2 from the browser
// so they bypass the ~4.5 MB Vercel server-action body ceiling. The server
// then downloads + parses by key. Keys are namespaced per org so one org can
// never ask the server to read another org's (or another module's) object.
// See [[chairops-starthing-import-r2-presign-2026-06-25]].
// ---------------------------------------------------------------------------
const POS_INGEST_PREFIX = "pos-ingest/orgs";

export function posIngestKeyPrefix(orgId: string): string {
  return `${POS_INGEST_PREFIX}/${orgId}/`;
}

export function posIngestKey(orgId: string, fileName: string): string {
  const raw = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? "xlsx").toLowerCase();
  const ext = /^(xlsx|xls|csv)$/.test(raw) ? raw : "xlsx";
  return `${posIngestKeyPrefix(orgId)}${randomUUID()}.${ext}`;
}

/** Object size in bytes via HEAD · null when unknown. Used to reject a too-big
 *  object BEFORE downloading it into memory. */
export async function headObjectSize(key: string): Promise<number | null> {
  try {
    const res = await client().send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    return typeof res.ContentLength === "number" ? res.ContentLength : null;
  } catch {
    return null;
  }
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await client().send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  if (!res.Body) throw new Error("R2 object empty");
  const bytes = await (
    res.Body as { transformToByteArray: () => Promise<Uint8Array> }
  ).transformToByteArray();
  return Buffer.from(bytes);
}

export function evidenceKey(branchSlug: string, collectionId: string, ext = "jpg") {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `cash/${yyyy}/${mm}/${branchSlug}/${collectionId}.${ext}`;
}

export function slipKey(branchSlug: string, collectionId: string, ext = "jpg") {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `cash-slip/${yyyy}/${mm}/${branchSlug}/${collectionId}.${ext}`;
}

export function cleanlinessKey(branchSlug: string, reportId: string, n: number, ext = "jpg") {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `cleanliness/${yyyy}/${mm}/${branchSlug}/${reportId}-${n}.${ext}`;
}

export function damageKey(branchSlug: string, ticketCode: string, n: number, ext = "jpg") {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `damage/${yyyy}/${mm}/${branchSlug}/${ticketCode}-${n}.${ext}`;
}

// F2 vendor bill slip (rent/utility/etc invoice receipt) · keyed by branch + bill id.
// Used by /chairops/bills/[id] uploader + the mark-paid form.
export function billSlipKey(branchSlug: string, billId: string, ext = "jpg") {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `bill-slip/${yyyy}/${mm}/${branchSlug}/${billId}.${ext}`;
}
