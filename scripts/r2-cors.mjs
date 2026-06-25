import { PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

await r2.send(
  new PutBucketCorsCommand({
    Bucket: process.env.R2_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [
            "http://localhost:3100",
            "http://localhost:3000",
            "https://*.vercel.app",
            // Custom prod domain — without this, browser→R2 presigned PUT from
            // pooilgroup.com is blocked by CORS ("Failed to fetch"). This also
            // un-breaks the photo uploads that were moved server-side because
            // of the same gap. (CEO 2026-06-25 · StarThing >4.5MB import.)
            "https://pooilgroup.com",
            "https://www.pooilgroup.com",
          ],
          AllowedMethods: ["GET", "PUT", "HEAD"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3000,
        },
      ],
    },
  }),
);

console.log(`✓ CORS configured on bucket: ${process.env.R2_BUCKET}`);
