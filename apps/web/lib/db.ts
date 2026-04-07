/**
 * IndexedDB wrapper for storing transfer resume state.
 * 
 * Optimized for large files (100GB+): stores only receivedSize and
 * highWaterChunk instead of per-chunk boolean arrays. This keeps IDB
 * writes tiny even for multi-million chunk transfers.
 */
const DB_NAME = 'FiledropDB';
const STORE_NAME = 'transfers';
const VERSION = 3; // v3: simplified schema for large file support

export interface TransferState {
    sessionId: string;
    files: { name: string; size: number }[];
    receivedSize: number;
    lastUpdate: number;
    status: 'active' | 'completed' | 'paused';
    totalChunks: number;
    /** Highest sequential chunkId fully received (for resume) */
    highWaterChunk: number;
    // Legacy field — kept for migration only, not used in new code
    completedChunks?: boolean[];
}

export const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const saveTransferState = async (state: TransferState) => {
    try {
        const db = await initDB();
        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            // Strip legacy completedChunks to keep IDB write small
            const leanState = { ...state };
            delete leanState.completedChunks;
            const request = store.put(leanState);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn('[DB] Failed to save transfer state:', e);
    }
};

export const getTransferState = async (sessionId: string): Promise<TransferState | null> => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(sessionId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn('[DB] Failed to get transfer state:', e);
        return null;
    }
};

export const deleteTransferState = async (sessionId: string) => {
    try {
        const db = await initDB();
        return new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(sessionId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn('[DB] Failed to delete transfer state:', e);
    }
};

/**
 * Update transfer progress. Debounced — only persists every 2 seconds
 * to avoid IDB thrashing on large files (100GB = ~1.5M chunks).
 */
let pendingSave: TransferState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_INTERVAL = 2000; // 2 seconds

export const updateTransferProgress = (
    state: TransferState,
    receivedSize: number,
    highWaterChunk: number,
): void => {
    state.receivedSize = receivedSize;
    state.highWaterChunk = highWaterChunk;
    state.lastUpdate = Date.now();

    pendingSave = state;
    if (!saveTimer) {
        saveTimer = setTimeout(async () => {
            if (pendingSave) {
                await saveTransferState(pendingSave);
                pendingSave = null;
            }
            saveTimer = null;
        }, SAVE_INTERVAL);
    }
};

/** Flush any pending debounced save immediately */
export const flushPendingSave = async (): Promise<void> => {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (pendingSave) {
        await saveTransferState(pendingSave);
        pendingSave = null;
    }
};
