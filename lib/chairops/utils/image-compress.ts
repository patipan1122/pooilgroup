// Client-side JPEG compression for maid photo uploads.
//
// Maid persona: Android-Go phone · slow mall WiFi · 8-12 MP camera = 4-6 MB JPEG.
// Target: <500 KB before R2 upload so even 2G works.
//
// Strategy: draw image into a canvas at downscaled dimensions (max 1600px on
// long edge), encode JPEG at quality 0.78 (sweet spot for cash/slip photos).
//
// Falls back to original file when:
//   - File is already < 500 KB
//   - Browser lacks Canvas / createImageBitmap (very old Android)
//   - HEIC source (Chrome <80 can't decode → leave for server transcode)

"use client";

const MAX_DIMENSION = 1600;
const TARGET_QUALITY = 0.78;
const TARGET_BYTES = 500 * 1024;
const FALLBACK_BYTES = 8 * 1024 * 1024; // 8 MB hard ceiling (server also enforces)

export interface CompressResult {
  blob: Blob;
  compressed: boolean;
  originalBytes: number;
  outputBytes: number;
  /** Thai-language reason when compression was skipped. */
  note?: string;
}

export async function compressImage(file: File): Promise<CompressResult> {
  const originalBytes = file.size;

  if (file.size <= TARGET_BYTES) {
    return {
      blob: file,
      compressed: false,
      originalBytes,
      outputBytes: originalBytes,
      note: "ไฟล์เล็กพอแล้ว",
    };
  }

  // HEIC — Chrome <80 can't decode; ship as-is and let server handle.
  if (/heic|heif/i.test(file.type)) {
    return {
      blob: file,
      compressed: false,
      originalBytes,
      outputBytes: originalBytes,
      note: "ไฟล์ HEIC · ส่งต้นฉบับ",
    };
  }

  if (
    typeof document === "undefined" ||
    typeof HTMLCanvasElement === "undefined"
  ) {
    return {
      blob: file,
      compressed: false,
      originalBytes,
      outputBytes: originalBytes,
      note: "เครื่องไม่รองรับ · ส่งต้นฉบับ",
    };
  }

  try {
    const bitmap = await loadBitmap(file);
    const { width: nw, height: nh } = bitmapSize(bitmap);
    const { width, height } = scaleDown(nw, nh);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      closeBitmap(bitmap);
      return {
        blob: file,
        compressed: false,
        originalBytes,
        outputBytes: originalBytes,
        note: "วาดภาพไม่ได้ · ส่งต้นฉบับ",
      };
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    closeBitmap(bitmap);

    const blob = await canvasToJpeg(canvas, TARGET_QUALITY);
    if (!blob) {
      return {
        blob: file,
        compressed: false,
        originalBytes,
        outputBytes: originalBytes,
        note: "บีบอัดไม่สำเร็จ · ส่งต้นฉบับ",
      };
    }

    // If compression somehow blew up file size (unlikely), keep original.
    if (blob.size >= originalBytes) {
      return {
        blob: file,
        compressed: false,
        originalBytes,
        outputBytes: originalBytes,
        note: "บีบอัดแล้วใหญ่กว่าเดิม · ส่งต้นฉบับ",
      };
    }
    if (blob.size > FALLBACK_BYTES) {
      return {
        blob: file,
        compressed: false,
        originalBytes,
        outputBytes: originalBytes,
        note: "เกิน 8MB · ส่งต้นฉบับ",
      };
    }

    return {
      blob,
      compressed: true,
      originalBytes,
      outputBytes: blob.size,
    };
  } catch {
    return {
      blob: file,
      compressed: false,
      originalBytes,
      outputBytes: originalBytes,
      note: "บีบอัดไม่สำเร็จ · ส่งต้นฉบับ",
    };
  }
}

type LoadedBitmap = ImageBitmap | HTMLImageElement;

async function loadBitmap(file: File): Promise<LoadedBitmap> {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(file);
  }
  // Fallback: HTMLImageElement via object URL
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}

function bitmapSize(b: LoadedBitmap): { width: number; height: number } {
  if (b instanceof HTMLImageElement) {
    return { width: b.naturalWidth, height: b.naturalHeight };
  }
  return { width: b.width, height: b.height };
}

function closeBitmap(b: LoadedBitmap): void {
  if (typeof ImageBitmap !== "undefined" && b instanceof ImageBitmap) {
    b.close();
  }
}

function scaleDown(w: number, h: number): { width: number; height: number } {
  const longEdge = Math.max(w, h);
  if (longEdge <= MAX_DIMENSION) return { width: w, height: h };
  const ratio = MAX_DIMENSION / longEdge;
  return {
    width: Math.round(w * ratio),
    height: Math.round(h * ratio),
  };
}

function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}
