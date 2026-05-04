import { Uploader } from "./uploader";

export default function UploadPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-2 text-2xl font-semibold">Upload to Cloudflare R2</h1>
      <p className="mb-6 text-sm text-zinc-500">
        เลือกรูปหรือวิดีโอเพื่อทดสอบการอัพโหลดเข้า bucket
      </p>
      <Uploader />
    </main>
  );
}
