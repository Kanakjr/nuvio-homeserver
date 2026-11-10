/**
 * What a browser can do, assembled from the pieces that already did it.
 *
 * Nothing new is implemented here. The web client's existing modules are the
 * implementation; this file only states which of them answer which capability,
 * so the UI can stop importing them by name and ask for the ability instead.
 *
 * `downloads` and `debrid` are absent, which is the whole point of them being
 * optional. See `types.ts` for why neither is a matter of trying harder.
 *
 * `fileSave` is the one that goes the other way: the browser has a download
 * manager of its own, and this is the capability that says so.
 */

import {
  copyStreamUrl,
  externalPlayerLabel,
  externalPlayerOptions,
  isExternalPlayerAvailable,
  launchExternalPlayer,
} from "../lib/externalPlayer.ts";
import { authVault } from "../lib/authVault.ts";
import { saveToDevice } from "../lib/fileDownload.ts";
import { deleteValue, getValue, setValue } from "../lib/idb.ts";
import { webRequest } from "../lib/webRequest.ts";
import type { DownloadsApi, DownloadsSnapshot, DownloadRequest, Platform } from "./types.ts";

export const homeServerDownloads: DownloadsApi = {
  async list(): Promise<DownloadsSnapshot> {
    try {
      const res = await fetch("/api/cache/list");
      if (!res.ok) {
        return { root: "HomeServer SSD", items: [] };
      }
      const data = await res.json();
      return {
        root: data.root || "HomeServer SSD (/root/.stremio-server/stremio-cache)",
        items: data.items || [],
      };
    } catch {
      return { root: "HomeServer SSD", items: [] };
    }
  },

  async enqueue(request: DownloadRequest): Promise<void> {
    await fetch("/api/cache/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  },

  async cancel(id: string): Promise<void> {
    await fetch("/api/cache/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  },

  async retry(id: string): Promise<void> {
    await fetch("/api/cache/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  },

  async remove(id: string): Promise<void> {
    await fetch("/api/cache/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  },

  async artwork(): Promise<string | null> {
    return null;
  },

  async openFolder(): Promise<void> {
    alert("HomeServer SSD Cache location:\n/root/.stremio-server/stremio-cache\n\nDirect high-speed torrent cache on HomeServer.");
  },

  async chooseFolder(): Promise<string | null> {
    return null;
  },

  async moveStorage(): Promise<void> {},
};

export const webPlatform: Platform = {
  auth: authVault,
  downloads: homeServerDownloads,
  fileSave: { save: saveToDevice },
  externalPlayer: {
    options: externalPlayerOptions,
    label: externalPlayerLabel,
    isAvailable: isExternalPlayerAvailable,
    launch: launchExternalPlayer,
    copyUrl: copyStreamUrl,
  },
  request: webRequest,
  // IndexedDB rather than localStorage: it stores structured values without a
  // JSON round trip, and it is reachable from a Worker, which is where the
  // session is kept.
  storage: {
    get: getValue,
    set: setValue,
    remove: deleteValue,
  },
};
