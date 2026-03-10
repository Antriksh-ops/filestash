# FILEDROP — AI Development Guide

> **Purpose**: This document is a comprehensive reference for any AI model (or developer) working on the FILEDROP codebase. It covers architecture, file-by-file breakdown, what's implemented, what's missing, known bugs, and exact instructions for common tasks.

---

## 1. Project Overview

**FILEDROP** is a peer-to-peer file transfer web app ("Internet AirDrop"). Files are transferred directly between browsers via WebRTC DataChannels. A signaling server handles only peer discovery and ICE negotiation. A WebSocket relay fallback is available if P2P fails.

**Core principle**: Files NEVER touch central servers. Servers only handle signaling, peer discovery, and session metadata.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15.1 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 |
| P2P | WebRTC DataChannel |
| Encryption | AES-256-GCM via WebCrypto API |
| Key Exchange | ECDH (P-256 curve) |
| File I/O | `File.slice()`, `FileSystem Access API` |
| Resume | IndexedDB |
| Signaling | Node.js + `ws` library (WebSocket) |
| Session Store | Redis (Upstash, with in-memory fallback) |
| TURN | Metered.ca (fetched dynamically via API route) |
| Frontend Hosting | Vercel |
| Signaling Hosting | Render (or Hetzner) |

---

## 3. Monorepo Structure

```
Filedrop/                          # npm workspaces monorepo
├── package.json                   # Root: workspaces config, concurrently
├── apps/
│   ├── signaling/
│   │   ├── server.js              # THE signaling server (Node.js + ws + Redis)
│   │   └── package.json           # deps: ws, ioredis, uuid
│   └── web/
│       ├── app/
│       │   ├── layout.tsx         # Root layout, SEO metadata, JSON-LD
│       │   ├── page.tsx           # THE main page (817 lines, all UI + transfer logic)
│       │   ├── globals.css        # Tailwind imports
│       │   ├── favicon.ico
│       │   └── api/
│       │       ├── ice-servers/route.ts  # Fetches TURN creds from Metered.ca
│       │       └── manifest/route.ts     # Proxies manifest updates to signaling
│       ├── components/
│       │   └── DropZone.tsx       # Drag-and-drop file selector
│       ├── hooks/
│       │   └── useWebRTC.ts       # WebRTC hook (connection, data channel, relay)
│       ├── lib/
│       │   ├── chunker.ts         # Adaptive file chunking + SHA-256 per chunk
│       │   ├── config.ts          # Runtime config (signaling URL resolution)
│       │   ├── crypto.ts          # ECDH, AES-GCM encrypt/decrypt, SHA-256
│       │   ├── db.ts              # IndexedDB wrapper for transfer resume state
│       │   └── turn.ts            # Client-side ICE server fetcher with fallback
│       ├── .env.local             # Environment variables (see section 5)
│       ├── next.config.ts         # Empty (no custom config)
│       └── package.json           # deps: next, qrcode.react
└── packages/
    └── shared/
        ├── types.ts               # Shared TypeScript types (minimal)
        └── index.ts               # Re-exports
```

---

## 4. File-by-File Reference

### `apps/signaling/server.js`
- HTTP server with CORS for session management
- `POST /session/create` — creates a session ID (6-char alphanumeric), stores metadata in Redis (or in-memory fallback)
- `GET /session/:id` — returns session data
- `GET /session/:id/manifest` — returns chunk hash manifest
- `PUT /session/:id/manifest` — updates chunk manifest
- WebSocket server on same port for signaling + relay
- Anti-abuse: rate limiting (5 sessions/IP/hour), relay bandwidth cap (1GB/session)
- Binary WebSocket messages are treated as relay data (broadcast to other peers)
- JSON WebSocket messages are signaling (offer/answer/candidate, broadcast to others)

### `apps/web/hooks/useWebRTC.ts`
- Custom React hook managing the entire WebRTC lifecycle
- Dynamically fetches TURN servers via `getIceServers()` from `lib/turn.ts`
- Creates RTCPeerConnection with `iceCandidatePoolSize: 10`
- Handles: offer/answer exchange, ICE candidates, data channel setup
- ECDH key exchange embedded in signaling messages (public keys sent with offer/answer)
- Relay fallback: activates when user consents after P2P stall (15s timer)
- Relay mode sends/receives binary data over the WebSocket directly
- Returns: `sendData`, `waitForBuffer`, `sharedKey`, `isRelayActive`, `activateRelay`, `reconnectP2P`, etc.
- ICE diagnostic logging: `🎯 [ICE Diagnostics] Gathered candidate type: relay/srflx/host`

### `apps/web/app/page.tsx` (817 lines)
- Single-page app with all UI states: idle → sending → receiving → completed
- **Sender flow**: Drop files → session created via POST → session ID + QR code + share link shown → wait for peer → start transfer
- **Receiver flow**: Join via 6-digit code or URL `?s=XXXXXX` → receive metadata → decrypt chunks → download
- Transfer: iterates file chunks, encrypts each with AES-GCM, packs as `[chunkId(4B)][iv(12B)][ciphertext]`, sends via DataChannel or relay
- Receiver decrypts, verifies SHA-256 hash against manifest, writes to FileSystem Access API or accumulates in memory
- Progress sync: receiver sends `progress-sync` messages back to sender
- Wake Lock API to prevent screen sleep during transfers
- Cancel support: broadcasts cancel signal via both DataChannel and signaling
- Resume: checks IndexedDB on mount for active sessions

### `apps/web/lib/chunker.ts`
- Adaptive chunk sizes: `<10MB → 256KB`, `<500MB → 2MB`, `<5GB → 8MB`, `>5GB → 32MB`
- `getFileChunks()` async generator: yields `{ chunk_id, file_id, offset, size, data, hash, encrypted }`
- Uses `File.slice()` to avoid loading entire file into memory
- SHA-256 hash computed per chunk

### `apps/web/lib/crypto.ts`
- `computeHash(data)` — SHA-256
- `computeFileHash(file)` — partial hash (first 1MB + last 1MB + metadata) for unique file ID
- `generateECDHKeyPair()` — P-256 ECDH key pair
- `exportPublicKey()` / `importPublicKey()` — raw key format
- `deriveAESKey(privateKey, publicKey)` — ECDH → AES-256-GCM
- `encryptChunk(data, key)` / `decryptChunk(data, key, iv)` — AES-256-GCM

### `apps/web/lib/db.ts`
- IndexedDB database `FiledropDB` with `transfers` object store
- `TransferState`: `{ sessionId, files[], receivedSize, lastUpdate, status }`
- CRUD: `saveTransferState`, `getTransferState`, `deleteTransferState`

### `apps/web/lib/turn.ts`
- `getIceServers()` — fetches from `/api/ice-servers`, returns `RTCIceServer[]`
- Falls back to Google STUN servers on failure

### `apps/web/lib/config.ts`
- Resolves signaling URL from: URL param `?signaling=` → `NEXT_PUBLIC_SIGNALING_URL` env → `ws://localhost:8080` fallback
- Derives HTTP URL from WS URL automatically

### `apps/web/app/api/ice-servers/route.ts`
- Server-side only — reads `METERED_API_KEY` and `METERED_APP_NAME` from env
- Fetches TURN credentials from `https://{appName}.metered.live/api/v1/turn/credentials?apiKey={key}`
- Returns ICE servers array with `Cache-Control: no-store`

### `apps/web/app/api/manifest/route.ts`
- Proxies manifest updates from client to signaling server
- `POST` with `{ sessionId, manifest }` → `PUT` to `/session/{id}/manifest` on signaling

---

## 5. Environment Variables

### `apps/web/.env.local`
```env
NEXT_PUBLIC_SIGNALING_URL=wss://your-signaling-server.com
NEXT_PUBLIC_SIGNALING_URL_HTTP=https://your-signaling-server.com

# Metered.ca TURN (server-side only, NEVER prefix with NEXT_PUBLIC_)
METERED_API_KEY=your_metered_api_key
METERED_APP_NAME=your_app_subdomain
```

### `apps/signaling` (environment)
```env
PORT=8080                          # default
REDIS_URL=redis://localhost:6379   # or Upstash URL
```

---

## 6. How to Run Locally

```bash
# Install all dependencies (from root)
npm install

# Run both signaling + web concurrently
npm run dev

# Or run separately:
npm run dev:signaling   # → http://localhost:8080
npm run dev:web         # → http://localhost:3000

# For HTTPS (needed for WebCrypto on non-localhost):
cd apps/web && npm run dev:https
```

**Testing a transfer locally**: Open two browser tabs at `http://localhost:3000`. Tab 1: drop a file. Tab 2: enter the 6-digit code or paste the URL.

---

## 7. Deployment

See `.agent/workflows/deploy.md` for full instructions. Summary:

1. **Redis**: Create Upstash free-tier Redis, get `REDIS_URL`
2. **Signaling server**: Deploy `apps/signaling` to Render (or Hetzner). Set `REDIS_URL` env var
3. **Frontend**: Deploy `apps/web` to Vercel. Set `NEXT_PUBLIC_SIGNALING_URL`, `NEXT_PUBLIC_SIGNALING_URL_HTTP`, `METERED_API_KEY`, `METERED_APP_NAME` env vars. Root directory: `apps/web`

---

## 8. Implementation Status vs Spec

### ✅ Phase 1 — Core (IMPLEMENTED)
| Feature | Status | Notes |
|---|---|---|
| Next.js frontend with drag & drop | ✅ | `DropZone.tsx`, `page.tsx` |
| WebSocket signaling server | ✅ | `server.js` with Redis + fallback |
| WebRTC DataChannel P2P transfer | ✅ | `useWebRTC.ts` |
| Adaptive chunking | ✅ | `chunker.ts` (256KB/2MB/8MB/32MB) |
| SHA-256 chunk verification | ✅ | `crypto.ts` → `computeHash()` |
| AES-256-GCM encryption | ✅ | ECDH key exchange + encrypt/decrypt |
| Session ID + QR code generation | ✅ | 6-char code + `qrcode.react` |
| WebSocket relay fallback | ✅ | Binary relay in `server.js` + `useWebRTC.ts` |
| TURN servers (Metered.ca) | ✅ | Dynamic fetch via API route |
| Transfer resume (IndexedDB) | ✅ | `db.ts` (basic — see gaps) |
| Progress UI with speed + ETA | ✅ | `updateProgressUi()` in `page.tsx` |
| Cancel support | ✅ | Via DataChannel + signaling |
| Wake Lock | ✅ | Prevents screen sleep |
| Manifest sync | ✅ | Progressive manifest upload |
| Anti-abuse (rate limiting) | ✅ | Server-side IP rate limit + relay cap |
| SEO metadata | ✅ | `layout.tsx` with OG + JSON-LD |

### ❌ Phase 1 — Gaps & Issues

| Gap | Severity | Details |
|---|---|---|
| **Single-file page.tsx (817 lines)** | 🟡 Medium | All UI + logic in one component. Should be split into `SendView`, `ReceiveView`, `TransferProgress`, etc. |
| **Resume is incomplete** | 🟡 Medium | `db.ts` stores `receivedSize` but NOT individual chunk completion (`completed_chunks: boolean[]`). Resume only works if receiver rejoins same session and sender is still online. No re-request of specific missing chunks. |
| **No chunk-level resume protocol** | 🔴 High | The spec requires `completed_chunks: boolean[]` in IndexedDB and requesting only missing chunks. Currently the receiver can't tell the sender "I already have chunks 0-50, send from 51". |
| **Receiver memory accumulation** | 🟡 Medium | If `FileSystem Access API` is declined (which happens on mobile), all chunks accumulate in `chunksRef.current` (memory). For large files this will crash. |
| **Batch file download** | 🟡 Medium | `downloadAll()` creates a single Blob from all chunks and names it `bridged-files.zip` but doesn't actually create a ZIP. Multi-file transfers will produce corrupted output. |
| **No parallel chunk streams** | 🟡 Medium | Spec calls for 10-50 simultaneous streams. Current implementation sends chunks sequentially. |
| **`page.tsx` uses CONFIG on server** | 🟢 Low | `manifest/route.ts` imports `CONFIG` which calls `window` — this works because `getSignalingURL()` has SSR guards, but is fragile. |
| **No error recovery on send** | 🟡 Medium | If `sendData()` returns false, the chunk is silently dropped. No retry logic. |
| **Relay mode progress sync** | 🟢 Low | In relay mode, progress-sync messages are sent as JSON strings through the WebSocket, but the sender may not correctly process them since `handleRawMessage` checks for `data instanceof ArrayBuffer`. This was a known bug from previous conversations. |
| **`computeFileHash` is partial** | 🟢 Low | Only hashes first+last 1MB — acceptable for file ID but NOT a true integrity check. The spec says "SHA-256 of full file" for `file_id`. |

---

## 9. Phase 2 & 3 — NOT YET IMPLEMENTED

These features from the spec are **not started**:

| Feature | Phase | Priority |
|---|---|---|
| **LAN detection + mDNS peer discovery** | 2 | High for local use |
| **Streaming file I/O (WritableStream)** | 2 | Partially done (FileSystem Access API) |
| **Parallel chunk streams (10+)** | 2 | High for speed |
| **Swarm distribution (BitTorrent-style)** | 3 | Future |
| **Peer relay (intermediary peers)** | 3 | Future |
| **Rarest-first + endgame mode** | 3 | Future |
| **Low-data mode + transfer scheduling** | 3 | Future |
| **Incremental transfer (skip existing chunks)** | 3 | Future |
| **WebTransport (QUIC)** | 3 | Future |
| **User accounts (Supabase)** | 4 | Future |
| **Stripe payments** | 4 | Future |
| **Password-protected links** | 4 | Future |
| **Transfer history** | 4 | Future |
| **API for developers** | 4 | Future |

---

## 10. Known Bugs & Technical Debt

1. **`page.tsx` is too large** — 817 lines in a single component. Extract: `SendView`, `ReceiveView`, `TransferProgress`, `RelayPromptModal`, `CompletionView`.

2. **Multi-file download is broken** — `downloadAll()` concatenates all chunk buffers into one blob. When multiple files are in a batch, boundaries between files are lost. Need to either:
   - Track chunks per file separately, or
   - Actually create a ZIP archive (use `fflate` or `jszip`)

3. **Mobile FileSystem Access API** — `showSaveFilePicker` is not supported on mobile browsers. The fallback (accumulating in memory) will OOM for large files. Consider using a Service Worker + `ReadableStream` approach for mobile.

4. **Shared key race condition** — If chunks arrive before ECDH key exchange completes, `sharedKeyRef.current` is null and chunks are silently dropped (line 175 in `page.tsx`).

5. **Manifest proxy uses client-side config** — `manifest/route.ts` imports `CONFIG` from `lib/config.ts`, which tries to read `window`. The SSR guard works, but this should use a server-only config pattern.

---

## 11. Common Tasks for AI Models

### Task: Add a new API route
1. Create `apps/web/app/api/{name}/route.ts`
2. Export `GET`, `POST`, etc. as async functions
3. Use `NextResponse.json()` for responses
4. Never expose secrets — use `process.env.VARIABLE_NAME` (no `NEXT_PUBLIC_` prefix)

### Task: Modify WebRTC behavior
1. Edit `apps/web/hooks/useWebRTC.ts`
2. The hook is complex — it manages: WebSocket signaling, RTCPeerConnection, DataChannel, ECDH keys, relay mode, stall detection
3. State is split between React state and refs (refs for values used in callbacks, state for re-rendering)
4. Test by opening two tabs and transferring a file

### Task: Add a new UI component
1. Create in `apps/web/components/{Name}.tsx`
2. Must be `'use client'` if it uses React hooks or browser APIs
3. Styling: use Tailwind CSS classes (v4 config, no `tailwind.config.js`)
4. Follow the existing neo-brutalist design: `border-4 border-black`, `shadow-[Xpx_Xpx_0px_0px_rgba(0,0,0,1)]`, `rounded-2xl`, `font-black uppercase`

### Task: Modify the signaling server
1. Edit `apps/signaling/server.js` (plain JavaScript, CommonJS)
2. Test with `npm run dev:signaling`
3. The server handles both HTTP endpoints and WebSocket connections on the same port
4. Session data is stored in Redis (with in-memory `Map` fallback)

### Task: Fix build errors
1. Run `cd apps/web && npm run build`
2. Common issues: TypeScript strict mode, ESLint rules, `any` types
3. The project uses `eslint-config-next` with React compiler babel plugin

### Task: Deploy changes
1. Follow `.agent/workflows/deploy.md`
2. Push to `main` branch — Vercel auto-deploys
3. For signaling changes, Render auto-deploys from the repo

---

## 12. Architecture Decisions & Rationale

1. **Why WebSocket relay instead of TURN?**  
   TURN servers cost money per GB. The signaling server already has a WebSocket connection to both peers, so relay through it is free (uses Hetzner's included 20TB/month bandwidth). Metered.ca TURN is now also integrated for better NAT traversal.

2. **Why single-page app instead of separate routes?**  
   Sender and receiver share the same URL (`/?s=SESSION_ID`). This simplifies sharing — one link works for everything.

3. **Why ECDH + AES-GCM instead of simpler encryption?**  
   Provides perfect forward secrecy. Each session generates a new ephemeral key pair. Even if one session's key is compromised, other sessions remain secure.

4. **Why adaptive chunk sizes?**  
   Small files need small chunks to avoid wasting the last chunk. Large files need large chunks to reduce per-chunk overhead (hash computation, encryption, framing).

5. **Why `File.slice()` instead of loading files into memory?**  
   The spec requires `<50MB` memory usage. `File.slice()` reads from disk on demand and is garbage-collected after sending.

---

## 13. Transfer Protocol (Binary Wire Format)

Each encrypted chunk is sent as a binary message with this format:

```
Bytes 0-3:   chunk_id (uint32, big-endian)
Bytes 4-15:  AES-GCM IV (12 bytes, random per chunk)
Bytes 16+:   AES-GCM ciphertext of original chunk data
```

JSON control messages are sent as text:
- `{ type: "batch-metadata", files: [{name, size}], sessionId }` — initiates transfer
- `{ type: "file-start", index: N }` — marks start of file N in batch
- `{ type: "file-end", index: N }` — marks end of file N
- `{ type: "transfer-complete" }` — all files sent
- `{ type: "progress-sync", received: N }` — receiver reports bytes received
- `{ type: "cancel" }` — cancel transfer
- `{ type: "force-relay" }` — switch to relay mode
- `{ type: "error", message: "..." }` — error notification

---

## 14. Priority Improvements (Recommended Order)

1. **Split `page.tsx`** into smaller components (~2 hours)
2. **Fix multi-file download** — use `fflate` for ZIP or track per-file chunks (~1 hour)
3. **Add chunk-level resume** — store `completed_chunks[]` in IndexedDB, add "resume-from" protocol message (~4 hours)
4. **Add retry on send failure** — if `sendData()` returns false, queue and retry with backoff (~2 hours)
5. **Add mobile download fallback** — Service Worker + `ReadableStream` for browsers without `showSaveFilePicker` (~4 hours)
6. **Implement parallel chunk streams** — use N DataChannels or multiplexed sending (~6 hours)
7. **LAN detection** — Use RTCPeerConnection's local candidate IP to detect same-subnet peers (~4 hours)

---

## 15. Testing Checklist

When making changes, verify:

- [ ] `cd apps/web && npm run build` succeeds
- [ ] Two tabs on same machine can transfer a file (P2P mode)
- [ ] Transfer works between different devices on same network
- [ ] Relay mode activates when P2P fails (test by blocking UDP)
- [ ] Progress bar updates on both sender and receiver
- [ ] Cancel works mid-transfer
- [ ] QR code and share link work
- [ ] Small file (<1MB) transfers correctly
- [ ] Medium file (10-100MB) transfers correctly
- [ ] File hash verification passes (check console for "Verified chunk N")
- [ ] ICE diagnostics show `relay` candidates (proves TURN works)
