# Changelog & Delta from Upstream

This document tracks all modifications, enhancements, and architectural extensions added in this repository compared to upstream [`lucaboox/nuvio-web`](https://github.com/lucaboox/nuvio-web).

---

## 🚀 HomeServer Superpower Additions

### 1. Playback & Codec Mastery
- **WebCodecs Seeking Engine** ([`src/lib/mediabunnyPlayer.ts`](src/lib/mediabunnyPlayer.ts)):
  - Resolved deadlock where seeking forward or backward stalled the browser.
  - Added cancellation token for obsolete in-flight frame decodes.
  - Removed per-frame 33MB memory allocation in 4K HEVC rendering loops.
  - Added dynamic frame-drop threshold to prevent A/V desync under CPU/GPU spikes.
- **Player Quality Diagnostics & Release Switcher** ([`src/components/Player.tsx`](src/components/Player.tsx)):
  - Allowed direct switching between streams/releases without unmounting player.
  - Real-time diagnostic overlays for buffer health and audio demuxing.

### 2. Direct Server-Side Torrent Pre-Caching
- **Daemon Architecture** ([`server.cjs`](server.cjs)):
  - Built-in lightweight Node.js sync & cache daemon running on port 8787.
  - Endpoints:
    - `GET /api/cache/list` - Enumerate active and historical cached torrents.
    - `POST /api/cache/enqueue` - Trigger server-side background fetch to SSD.
    - `POST /api/cache/cancel` - Halt active swarm download.
    - `POST /api/cache/retry` - Resume stalled torrent swarm.
    - `POST /api/cache/remove` - Prune torrent cache item.
  - Direct integration with Stremio Streaming companion (`stremio-streaming-server:11470`).
  - Added `streamProgress` validation to accurately mark items 100% completed when already on disk.

### 3. Smart Batch & Quality Pre-Caching
- **Quality Matcher** ([`src/lib/qualityMatcher.ts`](src/lib/qualityMatcher.ts)):
  - Automatic detection of video resolution (`4K`, `1080p`, `720p`), HDR, Dolby Vision, and seeders.
- **Batch Pre-Cache Engine** ([`src/lib/batchPreCache.ts`](src/lib/batchPreCache.ts)):
  - Resolves streams for entire TV seasons or single movies across all active addons.
  - Selects the optimal seed count for the selected resolution.
- **Pre-Cache Modal** ([`src/components/PreCacheModal.tsx`](src/components/PreCacheModal.tsx)):
  - Intuitive dialog on media details page to choose quality and initiate batch cache.
- **Floating Status Widget** ([`src/components/FloatingPreCacheStatus.tsx`](src/components/FloatingPreCacheStatus.tsx)):
  - Non-blocking background worker with floating progress bar and live item tracking.

### 4. Library Downloads Manager
- **Downloads Tab** ([`src/components/Downloads.tsx`](src/components/Downloads.tsx)):
  - Embedded directly into Library view (`/library?tab=downloads`).
  - Live swarm metrics: Download speed (MB/s), downloaded size, percentage, active peers.
  - One-click instant stream button for zero-latency local playback while downloading.
- **Active Downloads Badge** ([`src/App.tsx`](src/App.tsx)):
  - Live count pill rendered next to "Library" in sidebar and mobile navigation bar.

### 5. Identity, SSO & Sync
- **Cloudflare Access Zero Trust SSO** ([`src/lib/account.ts`](src/lib/account.ts)):
  - Automatic authentication using `x-user-email` request headers.
  - Self-hosted Supabase session exchange via `/api/auth/sso`.
- **Decoupled Configuration**:
  - All sensitive credentials loaded from environment variables or `data/config.json`.
  - Zero hardcoded tokens in codebase.

### 6. Containerization & Proxy
- **Multi-Stage Dockerfile** ([`Dockerfile`](Dockerfile)):
  - Alpine Node builder for Vite bundle.
  - Alpine Nginx runtime with embedded Node.js daemon.
- **Nginx Reverse Proxy** ([`nginx.conf`](nginx.conf)):
  - Reverse proxies `/api/` to local Node daemon (:8787).
  - Reverse proxies `/streaming/` to Stremio companion (:11470).
  - Configures optimal gzip compression and SPA routing.
