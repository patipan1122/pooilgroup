// Cloudflare R2 (shared with Pooil) — for evidence photos
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

const BUCKET = process.env.R2_BUCKET_NAME || "chairops";

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
