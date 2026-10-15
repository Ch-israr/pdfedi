/**
 * IndexedDB persistence for the PDF editor.
 * Saves document state locally for recovery after refresh.
 * PDF bytes are stored as ArrayBuffer (IndexedDB handles large binaries).
 */

const DB_NAME = 'pdfeditor';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

interface StoredDocument {
  id: string; // 'current' — single active document
  fileName: string | null;
  fileSize: number;
  pdfBytes: ArrayBuffer | null;
  pages: unknown[];
  elements: Record<string, unknown>;
  historyLog: unknown[];
  savedAt: number;
}

/**
 * Local-save time-to-live: recovery snapshots older than this are treated
 * as expired and deleted, Sejda-style. Exported for unit testing.
 */
export const LOCAL_SAVE_TTL_MS = 30 * 60 * 1000;

/** Pure predicate so the expiry rule is unit-testable without IndexedDB. */
export function isSaveExpired(savedAt: number, now: number = Date.now()): boolean {
  return now - savedAt > LOCAL_SAVE_TTL_MS;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function saveDocument(doc: Omit<StoredDocument, 'id' | 'savedAt'>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({
      ...doc,
      id: 'current',
      savedAt: Date.now(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function loadDocument(): Promise<StoredDocument | null> {
  try {
    const db = await openDb();
    const doc = await new Promise<StoredDocument | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get('current');
      req.onsuccess = () => resolve((req.result as StoredDocument) ?? null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
    if (!doc) return null;
    // Expired local saves are deleted and never reach the recovery prompt
    // (or recoverDocument) — the user is not offered stale work.
    if (isSaveExpired(doc.savedAt)) {
      await clearDocument();
      return null;
    }
    return doc;
  } catch {
    return null;
  }
}

export async function clearDocument(): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete('current');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
