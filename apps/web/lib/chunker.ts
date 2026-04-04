/**
 * High-performance file chunker with read-ahead pipeline.
 * 
 * Uses 1MB chunks to minimize per-chunk overhead (file reads, buffer copies,
 * dc.send() calls). The browser's SCTP layer handles internal fragmentation.
 * 
 * Read-ahead: starts reading the NEXT chunk from disk while the current
 * chunk is being sent, overlapping I/O with network transfer.
 */

export const CHUNK_SIZE = 1024 * 1024; // 1MB — 4x fewer iterations than 256KB

export interface Chunk {
    chunk_id: number;
    file_id: string;
    offset: number;
    size: number;
    data: ArrayBuffer;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getAdaptiveChunkSize(_fileSize: number): number {
    return CHUNK_SIZE;
}

export async function* getFileChunks(file: File, fileId: string): AsyncGenerator<Chunk> {
    const fileSize = file.size;
    let offset = 0;
    let chunkId = 0;

    // Read-ahead pipeline: start reading next chunk while current is being processed/sent
    let pendingRead: Promise<ArrayBuffer> | null = null;

    while (offset < fileSize) {
        const end = Math.min(offset + CHUNK_SIZE, fileSize);

        // Use pre-read buffer if available, otherwise read now
        let arrayBuffer: ArrayBuffer;
        if (pendingRead) {
            arrayBuffer = await pendingRead;
        } else {
            arrayBuffer = await file.slice(offset, end).arrayBuffer();
        }

        // Immediately kick off read of NEXT chunk (overlaps with send)
        const nextOffset = end;
        if (nextOffset < fileSize) {
            const nextEnd = Math.min(nextOffset + CHUNK_SIZE, fileSize);
            pendingRead = file.slice(nextOffset, nextEnd).arrayBuffer();
        } else {
            pendingRead = null;
        }

        yield {
            chunk_id: chunkId++,
            file_id: fileId,
            offset,
            size: arrayBuffer.byteLength,
            data: arrayBuffer,
        };

        offset = end;
    }
}
