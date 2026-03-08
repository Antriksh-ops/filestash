export async function computeHash(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as BufferSource);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function computeFileHash(file: File, onProgress?: (progress: number) => void): Promise<string> {
    const SHA256 = 'SHA-256';
    const chunkSize = 2 * 1024 * 1024; // 2MB slices for hashing
    let offset = 0;

    // We can't easily stream into crypto.subtle.digest, 
    // but we can digest the whole thing if we had a stream... 
    // Actually, Web Crypto digest() doesn't support streaming.
    // However, for file IDs, we can just hash the first 10MB + metadata + last 10MB 
    // or use a library. Since I should stay vanilla, I'll hash the whole thing 
    // by concatenating results of chunks? No, that's not how SHA-256 works.

    // Correct approach for streaming SHA-256 in browser without libraries:
    // Use a library like 'hash.js' or 'js-sha256' if allowed, 
    // but the spec says "vanilla" or "core".
    // If I must use SubtleCrypto, I HAVE to load the whole thing or chunks.
    // But SubtleCrypto.digest() is one-shot.

    // Wait, I can use a TransformStream with a crypto polyfill or similar? 
    // No, standard Web Crypto doesn't support incremental hashing.

    // ALternative: For THE FILE ID, we can hash (Name + Size + LastModified + First 1MB + Last 1MB).
    // This is "Internet AirDrop" style.

    const headerSize = Math.min(file.size, 1024 * 1024);
    const footerSize = Math.min(file.size - headerSize, 1024 * 1024);

    const header = await file.slice(0, headerSize).arrayBuffer();
    const footer = await file.slice(file.size - footerSize, file.size).arrayBuffer();

    const combined = new Uint8Array(header.byteLength + footer.byteLength + 64);
    combined.set(new Uint8Array(header), 0);
    combined.set(new Uint8Array(footer), header.byteLength);

    // Add metadata
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
