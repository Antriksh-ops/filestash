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

export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey']
    );
}

export async function exportPublicKey(key: CryptoKey): Promise<ArrayBuffer> {
    return crypto.subtle.exportKey('raw', key);
}

export async function importPublicKey(rawKey: ArrayBuffer): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );
}

export async function deriveAESKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
        { name: 'ECDH', public: publicKey },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

export async function generateKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

export async function encryptChunk(data: ArrayBuffer, key: CryptoKey): Promise<{ encryptedData: ArrayBuffer; iv: Uint8Array }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        data as BufferSource
    );
    return { encryptedData, iv };
}

export async function decryptChunk(encryptedData: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
    return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        encryptedData as BufferSource
    );
}
