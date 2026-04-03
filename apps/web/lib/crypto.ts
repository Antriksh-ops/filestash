export async function computeHash(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as BufferSource);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function computeFileHash(file: File): Promise<string> {
    // Hash first 1MB, last 1MB, and metadata to create a unique file ID
    const headerSize = Math.min(file.size, 1024 * 1024);
    const footerSize = Math.min(file.size - headerSize, 1024 * 1024);

    const header = await file.slice(0, headerSize).arrayBuffer();
    const footer = await file.slice(file.size - footerSize, file.size).arrayBuffer();

    const combined = new Uint8Array(header.byteLength + footer.byteLength + 128);
    combined.set(new Uint8Array(header), 0);
    combined.set(new Uint8Array(footer), header.byteLength);

    const metaStr = `${file.name}-${file.size}-${file.lastModified}`;
    const metaBytes = new TextEncoder().encode(metaStr);
    combined.set(metaBytes, header.byteLength + footer.byteLength);

    return computeHash(combined.buffer);
}


