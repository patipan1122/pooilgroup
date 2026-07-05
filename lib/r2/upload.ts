import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2_BUCKET, R2_PUBLIC_URL, r2 } from "./client";

// Fetch a stored object's raw bytes — used server-side to feed a résumé file
// to Claude for AI reading. Keys are namespaced per org, so a caller can only
// read an object whose key it already owns (defense against cross-org reads).
export async function getObject(key: string): Promise<Buffer> {
  const res = await r2.send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
  );
  if (!res.Body) throw new Error("R2 object empty");
  const bytes = await (
    res.Body as { transformToByteArray: () => Promise<Uint8Array> }
  ).transformToByteArray();
  return Buffer.from(bytes);
}

export async function getUploadUrl(key: string, contentType: string) {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(r2, cmd, { expiresIn: 60 * 5 });
  return { url, publicUrl: `${R2_PUBLIC_URL}/${key}` };
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | Blob | string,
  contentType?: string,
) {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body as never,
      ContentType: contentType,
    }),
  );
  return `${R2_PUBLIC_URL}/${key}`;
}

// Best-effort delete — used to clean up orphan files after DB rollback.
// Swallows errors because at the call site the request has already failed
// and we don't want to mask the original error with a cleanup failure.
export async function deleteObject(key: string): Promise<void> {
  try {
    await r2.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
  } catch (err) {
    console.error(`[r2.deleteObject] failed to remove ${key}`, err);
  }
}
