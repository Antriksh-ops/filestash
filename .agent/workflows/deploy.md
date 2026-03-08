---
description: How to deploy FILEDROP to production
---

### 1. Redis Initialization
1. Sign up at [Upstash](https://upstash.com/).
2. Create a Redis database and copy the `REDIS_URL`.

### 2. Signaling Server Deployment (Render)
1. Sign up at [Render](https://render.com/).
2. Create a new **Web Service** and connect your repo.
3. Set **Root Directory** to `apps/signaling`.
4. Set **Environment Variables**:
   - `REDIS_URL`: Your Upstash link.
5. Click **Deploy**. Note: Free tier has a ~1m cold start after 15m inactivity.

### 3. Vercel Frontend Deployment
1. Go to [Vercel Dashboard](https://vercel.com/dashboard).
2. "New Project" -> Select Repo.
3. **Framework Preset**: Next.js.
4. **Root Directory**: `apps/web`.
5. **Environment Variables**:
   - `NEXT_PUBLIC_SIGNALING_URL`: `wss://your-signaling-domain.com`
   - `NEXT_PUBLIC_SIGNALING_URL_HTTP`: `https://your-signaling-domain.com`
6. Click Deploy.
