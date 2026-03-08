export const CHUNK_SIZES = {
    SMALL: 256 * 1024,      // 256KB
    MEDIUM: 2 * 1024 * 1024,   // 2MB
    LARGE: 8 * 1024 * 1024,    // 8MB
    XLARGE: 32 * 1024 * 1024   // 32MB
};

import { computeHash } from './crypto';

export function getAdaptiveChunkSize(fileSize: number): number {
    if (fileSize < 10 * 1024 * 1024) return CHUNK_SIZES.SMALL;
    if (fileSize < 500 * 1024 * 1024) return CHUNK_SIZES.MEDIUM;
    if (fileSize < 5 * 1024 * 1024 * 1024) return CHUNK_SIZES.LARGE;
    return CHUNK_SIZES.XLARGE;
}

export interface Chunk {
    chunk_id: number;
    file_id: string;
    offset: number;
    size: number;
    data: ArrayBuffer;
    hash: string;
    encrypted: boolean;
}

export async function* getFileChunks(file: File, fileId: string): AsyncGenerator<Chunk> {
    const fileSize = file.size;
    const chunkSize = getAdaptiveChunkSize(fileSize);
    let offset = 0;
    let chunkId = 0;

    while (offset < fileSize) {
        const end = Math.min(offset + chunkSize, fileSize);
        const blob = file.slice(offset, end);
        const arrayBuffer = await blob.arrayBuffer();
        const hash = await computeHash(arrayBuffer);

        yield {
            chunk_id: chunkId++,
            file_id: fileId,
            offset,
            size: arrayBuffer.byteLength,
            data: arrayBuffer,
            hash,
            encrypted: false,
        };

        offset = end;
    }
}
