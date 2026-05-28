// Playland · Offline cache + scan queue (IndexedDB · no deps) · /bigfeature Phase B
//
// Per [[playland-offline-first-decision]]: cashier tablet must keep working when
// internet drops. We cache the active-wristband whitelist for the branch, validate
// scans locally, and queue scan events to sync when back online.
//
// Browser-only · all functions guard against SSR (typeof indexedDB).

const DB_NAME = "playland-offline";
const DB_VERSION = 1;
const STORE_WRISTBANDS = "wristbands";   // keyPath: code
const STORE_QUEUE = "scanQueue";         // keyPath: id (autoIncrement)
const STORE_META = "meta";               // keyPath: key

export interface CachedWristband {
  code: string;
  status: string;          // ISSUED | ACTIVE | RETURNED | LOST
  branchId: string;
  memberName: string | null;
  cachedAt: number;
}

export interface QueuedScan {
  id?: number;
  code: string;
  branchId: string;
  scannedAt: number;       // epoch ms
  outcome: string;         // local decision: open / deny / unknown
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_WRISTBANDS)) db.createObjectStore(STORE_WRISTBANDS, { keyPath: "code" });
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ── Wristband whitelist cache ────────────────────────────────────────────────
export async function cacheWristbands(list: CachedWristband[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE_WRISTBANDS, STORE_META], "readwrite");
    const ws = t.objectStore(STORE_WRISTBANDS);
    ws.clear();
    for (const w of list) ws.put(w);
    t.objectStore(STORE_META).put({ key: "wristbandsCachedAt", value: Date.now() });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function lookupCached(code: string): Promise<CachedWristband | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const w = await tx<CachedWristband | undefined>(STORE_WRISTBANDS, "readonly", (s) => s.get(code.trim().toUpperCase()));
    return w ?? null;
  } catch {
    return null;
  }
}

export async function cacheAge(): Promise<number | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const m = await tx<{ key: string; value: number } | undefined>(STORE_META, "readonly", (s) => s.get("wristbandsCachedAt"));
    return m?.value ? Date.now() - m.value : null;
  } catch {
    return null;
  }
}

// ── Scan queue (offline) ─────────────────────────────────────────────────────
export async function enqueueScan(scan: QueuedScan): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await tx(STORE_QUEUE, "readwrite", (s) => s.add(scan));
}

export async function getQueue(): Promise<QueuedScan[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    return await tx<QueuedScan[]>(STORE_QUEUE, "readonly", (s) => s.getAll());
  } catch {
    return [];
  }
}

export async function clearQueue(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await tx(STORE_QUEUE, "readwrite", (s) => s.clear());
}

export async function queueCount(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  try {
    return await tx<number>(STORE_QUEUE, "readonly", (s) => s.count());
  } catch {
    return 0;
  }
}
