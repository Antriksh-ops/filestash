/**
 * High-performance file chunker.
 * 
 * Uses 64KB chunks — the optimal size for WebRTC SCTP.
 * Provides both async generator (for compatibility) and a bulk
 * synchronous reader for maximum throughput.
 */

// 256KB per chunk — max safe size for Safari's SCTP limit.
// With ordered:false, larger chunks reduce per-message overhead.
export const CHUNK_SIZE = 256 * 1024;

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

/**
 * Read a batch of chunks from a file synchronously (one await for the whole batch).
 * This eliminates the per-chunk microtask overhead of async generators.
 * 
 * @param file - The source file
 * @param fileId - Unique file identifier
 * @param startOffset - Byte offset to start reading from
 * @param startChunkId - Chunk ID counter start
 * @param batchBytes - How many bytes to read in this batch (default 2MB)
 * @returns Array of chunks + the next offset
 */
export async function readChunkBatch(
    file: File, 
    fileId: string, 
    startOffset: number, 
    startChunkId: number,
    batchBytes: number = 2 * 1024 * 1024
): Promise<{ chunks: Chunk[]; nextOffset: number; nextChunkId: number }> {
    const fileSize = file.size;
    const endBatch = Math.min(startOffset + batchBytes, fileSize);
    
    // Single large read — one await for the entire batch
    const batchBuffer = await file.slice(startOffset, endBatch).arrayBuffer();
    
    const chunks: Chunk[] = [];
    let localOffset = 0;
    let chunkId = startChunkId;
    
    while (startOffset + localOffset < endBatch) {
        const chunkEnd = Math.min(localOffset + CHUNK_SIZE, batchBuffer.byteLength);
        const chunkData = batchBuffer.slice(localOffset, chunkEnd);
        
        chunks.push({
            chunk_id: chunkId++,
            file_id: fileId,
            offset: startOffset + localOffset,
            size: chunkData.byteLength,
            data: chunkData,
        });
        
        localOffset = chunkEnd;
    }
    
    return { chunks, nextOffset: endBatch, nextChunkId: chunkId };
}

// Legacy async generator — kept for compatibility but NOT used in hot path
export async function* getFileChunks(file: File, fileId: string): AsyncGenerator<Chunk> {
    const fileSize = file.size;
    let offset = 0;
    let chunkId = 0;

    let pendingRead: Promise<ArrayBuffer> | null = null;

    while (offset < fileSize) {
        const end = Math.min(offset + CHUNK_SIZE, fileSize);

        let arrayBuffer: ArrayBuffer;
        if (pendingRead) {
            arrayBuffer = await pendingRead;
        } else {
            arrayBuffer = await file.slice(offset, end).arrayBuffer();
        }

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
