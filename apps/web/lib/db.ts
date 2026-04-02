/**
 * IndexedDB wrapper for storing transfer resume state.
 * 
 * Supports chunk-level resume: stores which specific chunks have been
 * received so the sender can skip already-transferred data on reconnect.
 */
const DB_NAME = 'FiledropDB';
const STORE_NAME = 'transfers';
const VERSION = 2; // Bumped for schema upgrade

export interface TransferState {
    sessionId: string;
    files: { name: string; size: number }[];
    receivedSize: number;
    lastUpdate: number;
    status: 'active' | 'completed' | 'paused';
    totalChunks: number;
    /** Sparse array: completedChunks[chunkId] = true if received & verified */
    completedChunks: boolean[];
    /** Per-file chunk boundaries for multi-file resume */
    fileChunkOffsets?: number[];
}

export const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
            }
            // v2 migration: no schema changes needed, just version bump
            // Old records will get new fields on next save
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const saveTransferState = async (state: TransferState) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(state);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

export const getTransferState = async (sessionId: string): Promise<TransferState | null> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(sessionId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
};

export const deleteTransferState = async (sessionId: string) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(sessionId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

/**
 * Mark a specific chunk as completed in the transfer state.
 * Uses a debounced write — only persists every N chunks to avoid IDB thrashing.
 */
let pendingSave: TransferState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const markChunkCompleted = async (
    sessionId: string,
    chunkId: number,
    state: TransferState
): Promise<void> => {
    if (!state.completedChunks) {
        state.completedChunks = [];
    }
    state.completedChunks[chunkId] = true;
    state.lastUpdate = Date.now();

    // Debounce: batch IDB writes every 500ms
    pendingSave = state;
    if (!saveTimer) {
        saveTimer = setTimeout(async () => {
            if (pendingSave) {
                await saveTransferState(pendingSave);
                pendingSave = null;
            }
            saveTimer = null;
        }, 500);
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

/** Get list of chunk IDs that are NOT yet completed */
export const getMissingChunks = (state: TransferState): number[] => {
    const missing: number[] = [];
    for (let i = 0; i < state.totalChunks; i++) {
        if (!state.completedChunks[i]) {
            missing.push(i);
        }
    }
    return missing;
};
