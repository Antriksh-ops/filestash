export const CHUNK_SIZES = {
    SMALL: 250 * 1024,      // 250KB (Most optimal for high-speed local transfer within 256KB limit)
    MEDIUM: 250 * 1024,     
    LARGE: 250 * 1024,      
    XLARGE: 250 * 1024      
};

export interface Chunk {
    chunk_id: number;
    file_id: string;
    offset: number;
    size: number;
    data: ArrayBuffer;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getAdaptiveChunkSize(_fileSize: number): number {
    return CHUNK_SIZES.SMALL;
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
