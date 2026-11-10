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
  queuedCount: number;
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
      failedCount: 0,
      startedAt: Date.now(),
    };

    this.jobs.unshift(job);
    this.notify();

    // Run asynchronously without blocking the UI
    (async () => {
      try {
        if (!targetEpisodes) {
          // Single movie
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
                job.failedCount++;
              }
            } catch {
              job.failedCount++;
            }
            this.notify();
          }

          job.status = job.queuedCount > 0 ? "completed" : "error";
          if (job.queuedCount === 0) {
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
