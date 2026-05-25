// IndexedDB outbox stub for offline-tolerant maid submissions.
//
// Use case (W6 / EPIC A): maid is on slow mall WiFi · taps "ยืนยันบันทึก" ·
// connection drops mid-upload · we must NOT lose the form data.
//
// Strategy:
//   1. Save draft (form fields + photo Blob + idempotency key) to IndexedDB
//      BEFORE attempting submit.
//   2. On submit success → delete draft.
//   3. On failure or navigator.onLine === false → keep draft, show
//      "ออฟฟไลน์ · จะส่งเมื่อเชื่อมต่อ" banner.
//   4. On window 'online' event → drain outbox (best-effort retry).
//
// TODO[claude-design]: real impl uses `idb` package (3 KB) or raw IDBRequest.
// Wave 1 stub: in-memory Map fallback when IndexedDB unavailable (SSR / test).
// Wave 2: wire 'online' event listener in MaidShell to auto-drain.

"use client";

import { newIdempotencyKey } from "./idempotency";

export interface OutboxDraft {
  /** Idempotency key — primary key in outbox + sent to server */
  key: string;
  /** Route the draft targets (e.g. "/chairops/m/collect/new") */
  route: string;
  /** Serialized form payload (already validated client-side) */
  payload: Record<string, unknown>;
  /** Optional Blob for the photo (kept until upload succeeds) */
  photoBlob?: Blob | null;
  /** ISO timestamp the draft was saved */
  savedAt: string;
  /** Last submit attempt error (Thai message) */
  lastError?: string;
}

const DB_NAME = "chairops_maid_outbox";
const STORE = "drafts";
const VERSION = 1;

// In-memory fallback when IDB is unavailable (SSR or older Chrome <80 edge cases)
const memFallback = new Map<string, OutboxDraft>();

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
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class MaidOutbox {
  /** Save (or upsert) a draft into the outbox. */
  static async put(draft: OutboxDraft): Promise<void> {
    if (!hasIDB()) {
      memFallback.set(draft.key, draft);
      return;
    }
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  /** Remove a draft (after successful server submit). */
  static async delete(key: string): Promise<void> {
    if (!hasIDB()) {
      memFallback.delete(key);
      return;
    }
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  /** List all pending drafts (for badge count / debug). */
  static async list(): Promise<OutboxDraft[]> {
    if (!hasIDB()) {
      return Array.from(memFallback.values());
    }
    const db = await openDb();
    const items = await new Promise<OutboxDraft[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as OutboxDraft[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items;
  }

  /** Convenience — create a fresh key. */
  static newKey(): string {
    return newIdempotencyKey();
  }
}

/** Quick check used by form banners. */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}
