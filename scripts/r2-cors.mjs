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
