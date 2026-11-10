import type { Meta, Video, Stream, InstalledAddon } from "../types";
import { type TargetQuality, pickBestTorrentStream, enqueuePreCacheItem } from "./batchPreCache";
import { loadStreams } from "./addons";

export type PreCacheJob = {
  id: string;
  meta: Meta;
  title: string;
  scopeName: string;
  quality: TargetQuality;
  current: number;
  total: number;
  currentTitle: string;
  status: "running" | "completed" | "error";
  error?: string;
  summary?: string;
  queuedCount: number;
  skippedCount: number;
  noStreamsCount: number;
  failedCount: number;
  startedAt: number;
  completedAt?: number;
};

type Listener = (jobs: PreCacheJob[]) => void;

class BackgroundPreCacheService {
  private jobs: PreCacheJob[] = [];
  private listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener([...this.jobs]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const copy = [...this.jobs];
    for (const l of this.listeners) {
      try {
        l(copy);
      } catch (_) {}
    }
  }

  getJobs(): PreCacheJob[] {
    return [...this.jobs];
  }

  dismissJob(id: string) {
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.notify();
  }

  startJob({
    meta,
    addons,
    episodes,
    quality,
    scopeName,
  }: {
    meta: Meta;
    addons: InstalledAddon[];
    episodes?: Video[];
    quality: TargetQuality;
    scopeName: string;
  }) {
    const id = `${meta.id}-${Date.now()}`;
    const targetEpisodes = episodes && episodes.length > 0 ? episodes : undefined;
    const total = targetEpisodes ? targetEpisodes.length : 1;

    const job: PreCacheJob = {
      id,
      meta,
      title: meta.name,
      scopeName,
      quality,
      current: 0,
      total,
      currentTitle: targetEpisodes ? (targetEpisodes[0]?.title || `Episode 1`) : meta.name,
      status: "running",
      queuedCount: 0,
      skippedCount: 0,
      noStreamsCount: 0,
      failedCount: 0,
      startedAt: Date.now(),
    };

    this.jobs.unshift(job);
    this.notify();

    // Run asynchronously without blocking the UI
    (async () => {
      try {
        // Query currently cached/downloaded items from HomeServer to avoid re-downloading
        const existingCompleted = new Set<string>();
        try {
          const res = await fetch("/api/cache/list");
          if (res.ok) {
            const data = await res.json();
            for (const item of data.items || []) {
              if (item.status === "completed") {
                if (item.videoId) existingCompleted.add(String(item.videoId));
                if (item.contentId) existingCompleted.add(String(item.contentId));
              }
            }
          }
        } catch (_) {}

        if (!targetEpisodes) {
          // Single movie
          if (existingCompleted.has(meta.id)) {
            job.current = 1;
            job.skippedCount = 1;
            job.status = "completed";
            job.summary = "Movie is already cached on HomeServer SSD.";
            job.completedAt = Date.now();
            return;
          }

          job.currentTitle = meta.name;
          this.notify();
          const streams = await loadStreams(meta.type, meta.id, addons).catch(() => []);
          const best = pickBestTorrentStream(streams, quality);
          if (best) {
            const ok = await enqueuePreCacheItem({ meta, stream: best, quality });
            if (ok) {
              job.queuedCount = 1;
              job.current = 1;
              job.status = "completed";
              job.summary = "Queued movie to HomeServer SSD";
              job.completedAt = Date.now();
            } else {
              job.status = "error";
              job.error = "Could not queue to server cache.";
            }
          } else {
            job.status = "error";
            job.error = "No torrent stream found.";
          }
        } else {
          // Series batch
          for (let i = 0; i < targetEpisodes.length; i++) {
            const ep = targetEpisodes[i];
            job.current = i + 1;
            job.currentTitle = ep.title || `S${ep.season ?? 1}E${ep.episode ?? i + 1}`;

            // Skip episodes already completed on disk
            if (existingCompleted.has(ep.id)) {
              job.skippedCount++;
              job.currentTitle = `${ep.title || `Episode ${ep.episode ?? i + 1}`} (already cached)`;
              this.notify();
              continue;
            }

            this.notify();

            try {
              const streams = await loadStreams(meta.type, ep.id, addons).catch(() => []);
              const best = pickBestTorrentStream(streams, quality);
              if (best) {
                const ok = await enqueuePreCacheItem({
                  meta,
                  video: ep,
                  stream: best,
                  quality,
                });
                if (ok) job.queuedCount++;
                else job.failedCount++;
              } else {
                job.noStreamsCount++;
              }
            } catch {
              job.failedCount++;
            }
            this.notify();
          }

          // Build clear, informative status
          if (job.queuedCount > 0) {
            job.status = "completed";
            const parts = [`Queued ${job.queuedCount} episode${job.queuedCount === 1 ? "" : "s"}`];
            if (job.skippedCount > 0) parts.push(`${job.skippedCount} already cached`);
            if (job.noStreamsCount > 0) parts.push(`${job.noStreamsCount} unreleased / no torrents`);
            job.summary = parts.join(" · ");
          } else if (job.skippedCount > 0) {
            job.status = "completed";
            job.summary = `All available episodes already cached on SSD${
              job.noStreamsCount > 0 ? ` (${job.noStreamsCount} unreleased / no torrents yet)` : ""
            }`;
          } else if (job.noStreamsCount > 0) {
            job.status = "error";
            job.error = `${job.noStreamsCount} episode${
              job.noStreamsCount === 1 ? "" : "s"
            } have no torrent streams available yet (not aired).`;
          } else {
            job.status = "error";
            job.error = "No suitable torrents found for episodes.";
          }
          job.completedAt = Date.now();
        }
      } catch (err) {
        job.status = "error";
        job.error = err instanceof Error ? err.message : "Failed to pre-cache.";
      } finally {
        this.notify();
      }
    })();
  }
}

export const backgroundPreCache = new BackgroundPreCacheService();
