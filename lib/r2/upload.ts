import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2_BUCKET, R2_PUBLIC_URL, r2 } from "./client";

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
