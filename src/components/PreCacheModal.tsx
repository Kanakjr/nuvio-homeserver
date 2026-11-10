import { useState, useMemo, useEffect } from "react";
import { Check, X, HardDrive, Zap } from "lucide-react";
import type { InstalledAddon, Meta, Video } from "../types";
import { type TargetQuality } from "../lib/batchPreCache";
import { backgroundPreCache } from "../lib/backgroundPreCache";

export interface PreCacheModalProps {
  meta: Meta;
  addons: InstalledAddon[];
  initialSeason?: number;
  initialScope?: "all" | "season";
  isOpen: boolean;
  onClose: () => void;
  onGoToDownloads?: () => void;
}

export function PreCacheModal({
  meta,
  addons,
  initialSeason,
  initialScope = "season",
  isOpen,
  onClose,
  onGoToDownloads,
}: PreCacheModalProps) {
  const [quality, setQuality] = useState<TargetQuality>("1080P");
  const [scope, setScope] = useState<"season" | "all">(initialScope);
  const [season, setSeason] = useState<number>(initialSeason ?? 1);
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (initialSeason != null) setSeason(initialSeason);
  }, [initialSeason]);

  useEffect(() => {
    if (initialScope) setScope(initialScope);
  }, [initialScope]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/cache/list")
      .then((res) => res.json())
      .then((data) => {
        if (data?.items && Array.isArray(data.items)) {
          const ids = new Set<string>();
          for (const itm of data.items) {
            if (itm.status === "completed") {
              if (itm.videoId) ids.add(String(itm.videoId));
              if (itm.contentId) ids.add(String(itm.contentId));
            }
          }
          setCachedIds(ids);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  const seasons = useMemo(() => {
    if (meta.type !== "series" || !meta.videos) return [];
    return [...new Set(meta.videos.map((v) => v.season ?? 0))].sort((a, b) => a - b);
  }, [meta]);

  const targetEpisodes = useMemo(() => {
    if (meta.type !== "series" || !meta.videos) return [];
    if (scope === "all") {
      return meta.videos.filter((v) => (v.season ?? 0) > 0 || meta.videos.length <= 1);
    }
    return meta.videos.filter((v) => (v.season ?? 0) === season);
  }, [meta, scope, season]);

  const cachedEpisodesCount = useMemo(() => {
    if (meta.type !== "series") return cachedIds.has(meta.id) ? 1 : 0;
    return targetEpisodes.filter((ep) => cachedIds.has(ep.id)).length;
  }, [meta, cachedIds, targetEpisodes]);

  if (!isOpen) return null;

  function handleStart() {
    const scopeName =
      meta.type === "movie"
        ? "Movie"
        : scope === "season"
        ? `Season ${season}`
        : "All Seasons";

    // Launch background task immediately - no UI waiting!
    backgroundPreCache.startJob({
      meta,
      addons,
      episodes: meta.type === "series" ? targetEpisodes : undefined,
      quality,
      scopeName,
    });

    // Close the modal immediately so the user can continue browsing freely
    onClose();
  }

  return (
    <div className="precache-modal-overlay" onClick={onClose}>
      <div
        className="precache-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="precache-modal-header">
          <div className="precache-title-wrap">
            <span className="precache-icon-badge">
              <HardDrive size={18} />
            </span>
            <div>
              <h3>Pre-cache to HomeServer SSD</h3>
              <p>{meta.name}</p>
            </div>
          </div>
          <button
            type="button"
            className="precache-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="precache-modal-body">
          {meta.type === "series" && (
            <div className="precache-section">
              <label className="section-label">Select Scope</label>
              <div className="precache-scope-options">
                <button
                  type="button"
                  className={`scope-pill ${scope === "season" ? "active" : ""}`}
                  onClick={() => setScope("season")}
                >
                  Season {season} ({meta.videos?.filter((v) => (v.season ?? 0) === season).length || 0} eps)
                </button>
                <button
                  type="button"
                  className={`scope-pill ${scope === "all" ? "active" : ""}`}
                  onClick={() => setScope("all")}
                >
                  Entire Series ({meta.videos?.length || 0} eps)
                </button>
              </div>
              {scope === "season" && seasons.length > 1 && (
                <div className="season-picker-row">
                  <span>Season:</span>
                  <select
                    value={season}
                    onChange={(e) => setSeason(Number(e.target.value))}
                    className="precache-select"
                  >
                    {seasons.map((s) => (
                      <option key={s} value={s}>
                        {s === 0 ? "Specials" : `Season ${s}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {cachedEpisodesCount > 0 && (
            <div className="precache-cached-pill">
              <Check size={15} />
              <span>
                {cachedEpisodesCount === targetEpisodes.length
                  ? `All ${targetEpisodes.length} episodes are already cached on SSD.`
                  : `${cachedEpisodesCount} of ${targetEpisodes.length} episodes already cached on SSD (will skip).`}
              </span>
            </div>
          )}

          <div className="precache-section">
            <label className="section-label">Preferred Quality</label>
            <div className="precache-quality-grid">
              <button
                type="button"
                className={`quality-card ${quality === "4K" ? "active" : ""}`}
                onClick={() => setQuality("4K")}
              >
                <strong>4K UHD</strong>
                <small>2160p · HDR / DV</small>
              </button>
              <button
                type="button"
                className={`quality-card ${quality === "1080P" ? "active" : ""}`}
                onClick={() => setQuality("1080P")}
              >
                <span className="rec-badge">Recommended</span>
                <strong>1080p FHD</strong>
                <small>Fast & Sharp</small>
              </button>
              <button
                type="button"
                className={`quality-card ${quality === "720P" ? "active" : ""}`}
                onClick={() => setQuality("720P")}
              >
                <strong>720p HD</strong>
                <small>Compact Storage</small>
              </button>
            </div>
            <span className="precache-hint">
              Runs in the background without interrupting playback. Automatically selects the highest-seeded torrent for each episode directly to HomeServer SSD cache.
            </span>
          </div>

          <div className="precache-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={handleStart}>
              <Zap size={16} />
              <span>
                {cachedEpisodesCount === targetEpisodes.length && targetEpisodes.length > 0
                  ? "All Cached (Re-verify)"
                  : `Pre-cache in Background (${
                      meta.type === "movie"
                        ? "Movie"
                        : scope === "season"
                        ? `Season ${season}`
                        : "All"
                    })`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
