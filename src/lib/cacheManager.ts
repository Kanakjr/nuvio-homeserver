import { useState, useEffect, useCallback } from "react";
import type { Stream } from "../types";

export type CacheStatus = {
  ok: boolean;
  active: boolean;
  completed: boolean;
  downloaded: number;
  streamLen: number;
  percent: number;
  downloadSpeed: number;
  peers: number;
  swarmSize: number;
  error?: string;
};

export function parseStreamTarget(stream: Stream): { hash: string; fileIdx: number } | null {
  if (stream.infoHash && /^[0-9a-f]{40}$/i.test(stream.infoHash.trim())) {
    return {
      hash: stream.infoHash.trim().toLowerCase(),
      fileIdx: stream.fileIdx ?? 0,
    };
  }
  const checkUrl = stream.url || stream.externalUrl;
  if (checkUrl) {
    const match = checkUrl.match(/\/streaming\/([0-9a-fA-F]{40})\/(\d+)/i);
    if (match) {
      return {
        hash: match[1].toLowerCase(),
        fileIdx: parseInt(match[2], 10) || 0,
      };
    }
  }
  return null;
}

export async function startPreCache(infoHash: string, fileIdx: number): Promise<boolean> {
  try {
    const res = await fetch("/api/cache/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ infoHash, fileIdx }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function stopPreCache(infoHash: string, fileIdx: number): Promise<boolean> {
  try {
    const res = await fetch("/api/cache/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ infoHash, fileIdx }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchCacheStatus(infoHash: string, fileIdx: number): Promise<CacheStatus | null> {
  try {
    const res = await fetch(`/api/cache/status?hash=${encodeURIComponent(infoHash)}&fileIdx=${fileIdx}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function usePreCacheStatus(stream: Stream) {
  const target = parseStreamTarget(stream);
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    if (!target) return;
    const res = await fetchCacheStatus(target.hash, target.fileIdx);
    if (res && res.ok) {
      setStatus(res);
    }
  }, [target?.hash, target?.fileIdx]);

  useEffect(() => {
    if (!target) {
      setStatus(null);
      return;
    }
    void check();
    // Poll every 2.5s if active or until completed
    const interval = setInterval(() => {
      void check();
    }, 2500);
    return () => clearInterval(interval);
  }, [target?.hash, target?.fileIdx, check]);

  const triggerStart = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    await startPreCache(target.hash, target.fileIdx);
    await check();
    setLoading(false);
  }, [target, check]);

  const triggerStop = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    await stopPreCache(target.hash, target.fileIdx);
    await check();
    setLoading(false);
  }, [target, check]);

  return {
    isTorrent: !!target,
    status,
    loading,
    start: triggerStart,
    stop: triggerStop,
  };
}
