import { useEffect, useState } from "react";
import { Loader2, Check, AlertCircle, X, Download, HardDrive } from "lucide-react";
import { backgroundPreCache, type PreCacheJob } from "../lib/backgroundPreCache";

export function FloatingPreCacheStatus({
  onGoToDownloads,
}: {
  onGoToDownloads?: () => void;
}) {
  const [jobs, setJobs] = useState<PreCacheJob[]>([]);

  useEffect(() => {
    return backgroundPreCache.subscribe(setJobs);
  }, []);

  // Filter to running jobs or jobs finished within the last 8 seconds
  const activeJobs = jobs.filter((job) => {
    if (job.status === "running") return true;
    if (job.completedAt && Date.now() - job.completedAt < 8000) return true;
    return false;
  });

  if (!activeJobs.length) return null;

  return (
    <div className="floating-precache-container">
      {activeJobs.map((job) => {
        const percent = job.total > 0 ? Math.round((job.current / job.total) * 100) : 0;
        const isRunning = job.status === "running";
        const isSuccess = job.status === "completed";

        return (
          <aside
            key={job.id}
            className={`floating-precache-card ${job.status}`}
            role="status"
            aria-live="polite"
          >
            <div className="floating-precache-icon">
              {isRunning ? (
                <Loader2 size={18} className="spin-icon" />
              ) : isSuccess ? (
                <Check size={18} className="success-icon" />
              ) : (
                <AlertCircle size={18} className="error-icon" />
              )}
            </div>

            <div className="floating-precache-body">
              <div className="floating-precache-head">
                <strong>
                  {isSuccess
                    ? "Pre-cache Complete"
                    : isRunning
                    ? "Pre-caching in Background"
                    : "Pre-cache Incomplete"}
                </strong>
                <button
                  type="button"
                  className="floating-precache-close"
                  onClick={() => backgroundPreCache.dismissJob(job.id)}
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="floating-precache-title">
                {job.title} · {job.scopeName} ({job.quality})
              </div>

              {isRunning && (
                <>
                  <div className="floating-precache-status-text">
                    <span>{job.currentTitle}</span>
                    <span>
                      {job.current} of {job.total} ({percent}%)
                    </span>
                  </div>
                  <div className="floating-precache-bar">
                    <div
                      className="floating-precache-fill"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </>
              )}

              {isSuccess && (
                <div className="floating-precache-status-text success">
                  <span>
                    {job.summary ||
                      `Queued ${job.queuedCount} item${job.queuedCount === 1 ? "" : "s"} to HomeServer SSD`}
                  </span>
                </div>
              )}

              {job.error && (
                <div className="floating-precache-status-text error">
                  <span>{job.error}</span>
                </div>
              )}

              {onGoToDownloads && (
                <div className="floating-precache-actions">
                  <button
                    type="button"
                    className="floating-action-link"
                    onClick={() => {
                      onGoToDownloads();
                      backgroundPreCache.dismissJob(job.id);
                    }}
                  >
                    View in Downloads Manager →
                  </button>
                </div>
              )}
            </div>
          </aside>
        );
      })}
    </div>
  );
}
