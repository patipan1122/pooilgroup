"use client";
// ClawOS · คิวรูปถ่ายแบบทนการปิดแอป (IndexedDB)
//
// ปัญหาเดิม: PhotoCaptureButton เก็บ blob ที่รอส่ง "ในหน่วยความจำ" (pendingRef).
// พนักงานอยู่หน้าตู้ 7-11 สัญญาณอ่อน · ถ้าปิดแอป LINE (หรือ OS ฆ่า tab) ระหว่างที่ยังอัปไม่สำเร็จ
// → blob หาย → รูปที่ "ถ่ายแล้ว" ไม่เคยขึ้น R2 → หลักฐานมิเตอร์/เงินหาย.
//
// วิธีแก้: เก็บ blob ที่รอส่งลง IndexedDB ทันทีที่ถ่าย · ข้ามการปิด/เปิดแอปได้
// → เปิดแอปใหม่ → flush คิวที่ค้าง → อัปต่อจนสำเร็จ → ค่อยลบออกจากคิว.
//
// Fallback graceful: ถ้า IndexedDB ไม่มี/เปิดไม่ได้ (private mode · เบราว์เซอร์เก่า)
// → คืน interface แบบ no-op (ทุกฟังก์ชันไม่ทำอะไร · ไม่ throw)
// → คอมโพเนนต์ fall back เป็น in-memory เดิม · ไม่พัง.

const DB_NAME = "clawfleet-photo-queue";
const STORE = "photos";
const VERSION = 1;

// 1 งานในคิว = 1 รูปที่รอส่งขึ้น R2 (พร้อม metadata ที่ /api/clawfleet/upload ต้องใช้)
export interface QueuedPhoto {
  /** primary key — สุ่มตอน enqueue */
  id: string;
  /** blob รูป (WebP ที่ resize แล้ว) — เก็บทั้งก้อนใน IndexedDB */
  blob: Blob;
  orgId: string;
  machineCode: string;
  eventScopeId: string;
  phase: string;
  /**
   * ป้ายช่องรูป (เช่น "เฟือง (บน)") — จำเป็นเพราะบางเฟส (prize_meter · meter_after)
   * มี 2 ช่องใช้ phase เดียวกัน · label ทำให้ flush ตอนเปิดแอปใหม่จับคู่งานกลับช่องเดิมได้ถูกต้อง
   * (กันช่องหนึ่งไปลบรูปที่ค้างของอีกช่องทิ้งเพราะคิดว่าซ้ำ)
   */
  label: string;
  /** epoch ms ตอน enqueue */
  createdAt: number;
  /** จำนวนครั้งที่พยายามอัป (ไว้ debug / กันวนไม่จบ) */
  attempts: number;
}

// รูปแบบ interface ที่คอมโพเนนต์เรียกใช้ (จริง = IndexedDB · fallback = no-op)
export interface PhotoQueue {
  /** พร้อมใช้จริงไหม (false = fallback no-op · คอมโพเนนต์ต้องพึ่ง in-memory เอง) */
  readonly available: boolean;
  enqueue(item: QueuedPhoto): Promise<void>;
  /** ลบงานที่อัปสำเร็จแล้วออกจากคิว */
  remove(id: string): Promise<void>;
  /** อ่านงานทั้งหมดที่ยังค้าง (flush ตอน mount / online) */
  all(): Promise<QueuedPhoto[]>;
  /** อัปเดต field บางส่วน (เช่น attempts++) · no-op ถ้าหา id ไม่เจอ */
  update(id: string, patch: Partial<Omit<QueuedPhoto, "id">>): Promise<void>;
  /** เอาไปใช้ dequeue: อ่าน 1 งานตาม id (null = ไม่มี) */
  dequeue(id: string): Promise<QueuedPhoto | null>;
}

function hasIDB(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined" &&
    window.indexedDB !== null
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// no-op interface — ทุกฟังก์ชันเงียบ · ไม่ throw · คอมโพเนนต์ fall back in-memory
const NOOP_QUEUE: PhotoQueue = {
  available: false,
  async enqueue() {
    /* no-op */
  },
  async remove() {
    /* no-op */
  },
  async all() {
    return [];
  },
  async update() {
    /* no-op */
  },
  async dequeue() {
    return null;
  },
};

// IndexedDB-backed implementation. ทุกเมธอด try-catch → ถ้าพังกลางคัน (โควตาเต็ม ฯลฯ)
// จะ log แล้ว degrade แบบเงียบ (no-op behaviour) แทนที่จะโยน error ทำ UI พัง.
function makeIdbQueue(): PhotoQueue {
  async function withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await openDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  return {
    available: true,

    async enqueue(item: QueuedPhoto): Promise<void> {
      try {
        await withStore("readwrite", (s) => s.put(item));
      } catch (e) {
        console.error("[photo-queue] enqueue failed:", e);
      }
    },

    async remove(id: string): Promise<void> {
      try {
        await withStore("readwrite", (s) => s.delete(id));
      } catch (e) {
        console.error("[photo-queue] remove failed:", e);
      }
    },

    async all(): Promise<QueuedPhoto[]> {
      try {
        const items = await withStore<QueuedPhoto[]>("readonly", (s) => s.getAll());
        return Array.isArray(items) ? items : [];
      } catch (e) {
        console.error("[photo-queue] all failed:", e);
        return [];
      }
    },

    async dequeue(id: string): Promise<QueuedPhoto | null> {
      try {
        const item = await withStore<QueuedPhoto | undefined>("readonly", (s) => s.get(id));
        return item ?? null;
      } catch (e) {
        console.error("[photo-queue] dequeue failed:", e);
        return null;
      }
    },

    async update(id: string, patch: Partial<Omit<QueuedPhoto, "id">>): Promise<void> {
      try {
        const current = await this.dequeue(id);
        if (!current) return; // หา id ไม่เจอ → no-op
        const next: QueuedPhoto = { ...current, ...patch, id: current.id };
        await withStore("readwrite", (s) => s.put(next));
      } catch (e) {
        console.error("[photo-queue] update failed:", e);
      }
    },
  };
}

// เปิดคิว: ถ้า IndexedDB ใช้ได้ → IDB queue · ไม่ได้ → no-op queue.
// ไม่ throw ทุกกรณี (call site เรียกได้อย่างปลอดภัยตอน render/mount).
export function getPhotoQueue(): PhotoQueue {
  if (!hasIDB()) return NOOP_QUEUE;
  try {
    return makeIdbQueue();
  } catch (e) {
    console.error("[photo-queue] init failed, fallback to no-op:", e);
    return NOOP_QUEUE;
  }
}

// สร้าง id สุ่มสำหรับงานในคิว (ไม่พึ่ง crypto ถ้าไม่มี — กันเบราว์เซอร์เก่า)
export function newQueueId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
