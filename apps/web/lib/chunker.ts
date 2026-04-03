export const CHUNK_SIZES = {
    SMALL: 60 * 1024,      // 60KB (Guarantees safe passage under 65535 byte SCTP limit)
    MEDIUM: 60 * 1024,     
    LARGE: 60 * 1024,      
    XLARGE: 60 * 1024      
};

import { computeHash } from './crypto';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getAdaptiveChunkSize(_fileSize: number): number {
    // WebRTC DataChannel message limit is generally 256KB.
    // Sending larger chunks (e.g. 2MB or 32MB) directly to dc.send() 
    // causes an immediate "OperationError: Failure to send data" and drops the connection.
    return CHUNK_SIZES.SMALL;
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
