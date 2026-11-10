import type { InstalledAddon, Meta, Stream, Video } from "../types";
import { loadStreams } from "../lib/addons";
import { parseStreamTarget } from "./cacheManager";
import { matchStreamQuality } from "./qualityMatcher";
import { platform } from "../platform/index";

export type TargetQuality = "4K" | "1080P" | "720P";

/** Extracts peer/seeder count from standard Stremio torrent stream descriptions (e.g. Torrentio). */
export function extractStreamSeeds(stream: Stream): number {
  const text = [stream.name, stream.title, stream.description, stream.behaviorHints?.filename]
    .filter(Boolean)
    .join(" ");

  // Torrentio format: 👤 55 or 👤55
  const peerMatch = text.match(/👤\s*(\d+)/);
  if (peerMatch) return parseInt(peerMatch[1], 10);

  // "55 seeds" or "seeds: 55"
  const seedMatch = text.match(/(\d+)\s*seeds?/i) || text.match(/seeds?[:\s]+(\d+)/i);
  if (seedMatch) return parseInt(seedMatch[1], 10);

  // [S: 55] or (S: 55)
  const sMatch = text.match(/\[S:\s*(\d+)/i) || text.match(/\(S:\s*(\d+)/i);
  if (sMatch) return parseInt(sMatch[1], 10);

  return 0;
}

/**
 * Given a set of streams and a preferred quality tier (4K, 1080p, 720p),
 * selects the healthiest (highest seeded) torrent stream matching the quality,
 * falling back gracefully to adjacent tiers if the exact resolution isn't found.
 */
export function pickBestTorrentStream(
  streams: Stream[],
  preferredQuality: TargetQuality,
): Stream | null {
  // Only consider torrent streams with valid infoHashes
  const torrents = streams.filter((s) => parseStreamTarget(s) !== null);
  if (!torrents.length) return null;

  // Quality fallback hierarchy
  const hierarchy: Record<TargetQuality, TargetQuality[]> = {
    "4K": ["4K", "1080P", "720P"],
    "1080P": ["1080P", "720P", "4K"],
    "720P": ["720P", "1080P", "4K"],
  };

  const tiers = hierarchy[preferredQuality] || ["1080P", "720P", "4K"];

  for (const tier of tiers) {
    const matching = torrents.filter((s) => matchStreamQuality(s, tier));
    if (matching.length > 0) {
      // Sort matching candidates by highest seeders first
      matching.sort((a, b) => extractStreamSeeds(b) - extractStreamSeeds(a));
      return matching[0];
    }
  }

  // If none matched any specific label, pick the top seeded torrent among all
  torrents.sort((a, b) => extractStreamSeeds(b) - extractStreamSeeds(a));
  return torrents[0] ?? null;
}

/** Enqueue a single pre-cache stream item into HomeServer Downloads */
export async function enqueuePreCacheItem({
  meta,
  video,
  stream,
  quality,
}: {
  meta: Meta;
  video?: Video;
  stream: Stream;
  quality?: string;
}): Promise<boolean> {
  const target = parseStreamTarget(stream);
  if (!target) return false;

  const title = video?.title || meta.name;
  const showName = meta.type === "series" ? meta.name : undefined;
  const url = stream.url || `/streaming/${target.hash}/${target.fileIdx}`;

  try {
    if (platform.downloads) {
      await platform.downloads.enqueue({
        contentId: meta.id,
        contentType: meta.type,
        videoId: video?.id ?? meta.id,
        title,
        showName,
        season: video?.season,
        episode: video?.episode,
        posterUrl: meta.poster,
        backdropUrl: meta.background || meta.banner,
        url,
        requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
        sourceName: `${stream.name || "Torrentio"} · ${quality || "Auto"} (${extractStreamSeeds(stream)} seeds)`,
        filename: stream.behaviorHints?.filename,
      });
      return true;
    } else {
      // Direct API fallback
      const res = await fetch("/api/cache/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId: meta.id,
          contentType: meta.type,
          videoId: video?.id ?? meta.id,
          title,
          showName,
          season: video?.season,
          episode: video?.episode,
          posterUrl: meta.poster,
          backdropUrl: meta.background || meta.banner,
          url,
          infoHash: target.hash,
          fileIdx: target.fileIdx,
          quality,
          sourceName: `${stream.name || "Torrentio"} · ${quality || "Auto"}`,
        }),
      });
      return res.ok;
    }
  } catch (err) {
    console.error("[pre-cache] Failed to enqueue item:", err);
    return false;
  }
}

/** Pre-caches a single movie */
export async function preCacheMovieSingle({
  meta,
  addons,
  preferredQuality,
}: {
  meta: Meta;
  addons: InstalledAddon[];
  preferredQuality: TargetQuality;
}): Promise<{ ok: boolean; stream?: Stream; error?: string }> {
  try {
    const streams = await loadStreams(meta.type, meta.id, addons);
    const best = pickBestTorrentStream(streams, preferredQuality);
    if (!best) {
      return { ok: false, error: "No torrent streams found for this movie." };
    }

    const enqueued = await enqueuePreCacheItem({
      meta,
      stream: best,
      quality: preferredQuality,
    });

    if (enqueued) {
      return { ok: true, stream: best };
    }
    return { ok: false, error: "Failed to queue stream to server cache." };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error resolving movie streams",
    };
  }
}

/** Batch pre-caches a list of series episodes with live progress */
export async function batchPreCacheSeries({
  meta,
  addons,
  episodes,
  preferredQuality,
  onProgress,
}: {
  meta: Meta;
  addons: InstalledAddon[];
  episodes: Video[];
  preferredQuality: TargetQuality;
  onProgress: (current: number, total: number, episodeTitle: string) => void;
}): Promise<{ total: number; queued: number; failed: number }> {
  let queued = 0;
  let failed = 0;
  const total = episodes.length;

  for (let i = 0; i < total; i++) {
    const ep = episodes[i];
    const epTitle = ep.title || `S${ep.season ?? 1}E${ep.episode ?? i + 1}`;
    onProgress(i + 1, total, epTitle);

    try {
      const streams = await loadStreams(meta.type, ep.id, addons).catch(() => []);
      const best = pickBestTorrentStream(streams, preferredQuality);
      if (best) {
        const ok = await enqueuePreCacheItem({
          meta,
          video: ep,
          stream: best,
          quality: preferredQuality,
        });
        if (ok) queued++;
        else failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { total, queued, failed };
}
