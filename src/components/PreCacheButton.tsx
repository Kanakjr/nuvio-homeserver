import { Download as DownloadIcon, CheckCircle2, Loader2 } from "lucide-react";
import type { Stream } from "../types";
import { usePreCacheStatus } from "../lib/cacheManager";

export function PreCacheButton({ stream }: { stream: Stream }) {
  const { isTorrent, status, loading, start } = usePreCacheStatus(stream);

  if (!isTorrent) return null;

  if (status?.completed) {
    return (
      <span className="pre-cache-pill completed" title="100% Cached on HomeServer disk">
        <CheckCircle2 size={12} /> Cached (100%)
      </span>
    );
  }

  if (status?.active) {
    const speed = status.downloadSpeed > 0
      ? status.downloadSpeed < 1024 * 1024
        ? `${(status.downloadSpeed / 1024).toFixed(0)} KB/s`
        : `${(status.downloadSpeed / (1024 * 1024)).toFixed(1)} MB/s`
      : "";
    return (
      <span className="pre-cache-pill active" title={`Downloading: ${status.percent}%`}>
        <Loader2 size={12} className="spin-icon" /> Caching {status.percent}% {speed ? `· ${speed}` : ""}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="pre-cache-trigger"
      title="Pre-download to HomeServer disk cache"
      disabled={loading}
      onClick={(e) => {
        e.stopPropagation();
        void start();
      }}
    >
      <DownloadIcon size={12} /> {loading ? "Starting…" : "Pre-cache"}
    </button>
  );
}
