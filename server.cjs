// server.cjs - Minimal self-hosted identity & sync daemon for Nuvio
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "8787", 10);
const DATA_DIR = process.env.DATA_DIR || "/data/users";

// Optional config file in data directory: /data/config.json
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(path.dirname(DATA_DIR), "config.json");
let localConfig = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    localConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  }
} catch (err) {
  console.warn("[config] Could not read local config file:", err.message);
}

const SUPABASE_INTERNAL_URL = process.env.SUPABASE_INTERNAL_URL || localConfig.supabaseInternalUrl || "http://host.docker.internal:8008";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || localConfig.serviceRoleKey || "";
const ANON_KEY = process.env.ANON_KEY || localConfig.anonKey || "";

let parsedMappings = {};
if (process.env.SSO_EMAIL_MAPPINGS) {
  try {
    parsedMappings = JSON.parse(process.env.SSO_EMAIL_MAPPINGS);
  } catch (e) {
    console.error("[config] Invalid SSO_EMAIL_MAPPINGS JSON:", e.message);
  }
}
// Mapping: Cloudflare email -> Supabase email & profile
const EMAIL_MAPPINGS = Object.keys(parsedMappings).length > 0 ? parsedMappings : (localConfig.emailMappings || {});

// Active background cache tasks: "infoHash:fileIdx" -> task
const activeCacheTasks = new Map();
const STREMIO_INTERNAL_URL = process.env.STREMIO_INTERNAL_URL || "http://stremio-streaming-server:11470";
const DOWNLOADS_FILE = path.join(DATA_DIR, "downloads.json");

function loadDownloads() {
  try {
    if (fs.existsSync(DOWNLOADS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DOWNLOADS_FILE, "utf-8"));
      if (Array.isArray(parsed.items)) return parsed;
    }
  } catch (err) {
    console.error("[cache] Error loading downloads.json:", err);
  }
  return { items: [] };
}

function saveDownloads(data) {
  try {
    const tmp = `${DOWNLOADS_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, DOWNLOADS_FILE);
  } catch (err) {
    console.error("[cache] Error saving downloads.json:", err);
  }
}

function getFileStats(hash, fileIdx) {
  return new Promise((resolve) => {
    const req = http.get(`${STREMIO_INTERNAL_URL}/${hash}/${fileIdx}/stats.json`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function startBackgroundCache(infoHash, fileIdx) {
  const hash = String(infoHash || "").toLowerCase();
  const idx = Number.isInteger(fileIdx) ? fileIdx : parseInt(fileIdx, 10) || 0;
  const key = `${hash}:${idx}`;
  if (activeCacheTasks.has(key)) return activeCacheTasks.get(key);

  const targetUrl = `${STREMIO_INTERNAL_URL}/${hash}/${idx}`;
  const req = http.get(targetUrl, (streamRes) => {
    streamRes.on("data", () => {});
    streamRes.on("end", () => {
      activeCacheTasks.delete(key);
      getFileStats(hash, idx).then((stats) => {
        if (stats && (stats.streamProgress >= 0.99 || (stats.downloaded >= stats.streamLen * 0.99))) {
          const store = loadDownloads();
          const itm = store.items.find((x) => x.id === key);
          if (itm) {
            itm.status = "completed";
            itm.bytesDownloaded = itm.totalBytes || stats.streamLen;
            saveDownloads(store);
          }
        }
      });
    });
    streamRes.on("error", (err) => {
      console.error(`[cache-task] Stream error for ${key}:`, err);
      activeCacheTasks.delete(key);
    });
  });

  req.on("error", (err) => {
    console.error(`[cache-task] Request error for ${key}:`, err);
    activeCacheTasks.delete(key);
  });

  const task = {
    key,
    infoHash: hash,
    fileIdx: idx,
    startedAt: Date.now(),
    stop: () => {
      try { req.destroy(); } catch (_) {}
      activeCacheTasks.delete(key);
    }
  };

  activeCacheTasks.set(key, task);
  return task;
}

// Auto-resume active downloads from disk
setTimeout(() => {
  try {
    const store = loadDownloads();
    for (const item of store.items) {
      if (item.status === "downloading" && item.infoHash) {
        console.log(`[cache] Auto-resuming download task ${item.infoHash}:${item.fileIdx || 0}`);
        startBackgroundCache(item.infoHash, item.fileIdx || 0);
      }
    }
  } catch (e) {
    console.error("[cache] Auto-resume failed:", e);
  }
}, 1000);

// Ensure data directory exists
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error("Failed to create data dir:", e);
}

function sanitizeId(str) {
  if (!str) return "guest";
  return str.toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });
  res.end(payload);
}

function postHttp(urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // 1. Identity endpoint
  if (pathname === "/api/auth/me" && req.method === "GET") {
    const email = req.headers["x-user-email"] ? String(req.headers["x-user-email"]).trim() : "";
    const name = req.headers["x-user-name"] ? String(req.headers["x-user-name"]).trim() : "";

    if (email && email.includes("@")) {
      return sendJson(res, 200, {
        authenticated: true,
        email,
        name: name || email.split("@")[0],
      });
    }

    return sendJson(res, 200, {
      authenticated: false,
      email: null,
      isGuest: true,
    });
  }

  // 2. SSO endpoint: Exchanges Cloudflare Access identity for full Supabase session
  if (pathname === "/api/auth/sso" && req.method === "GET") {
    const cfEmail = req.headers["x-user-email"] ? String(req.headers["x-user-email"]).trim().toLowerCase() : "";
    const defaultName = cfEmail.includes("@") ? cfEmail.split("@")[0] : "User";
    const mapping = EMAIL_MAPPINGS[cfEmail] || (cfEmail.includes("@") ? { supabaseEmail: cfEmail, defaultProfileIndex: 1, defaultProfileName: defaultName } : null);

    if (!mapping) {
      return sendJson(res, 200, { ok: false, error: "No mapped Cloudflare identity" });
    }

    try {
      // Step A: Generate one-time magiclink OTP
      const linkRes = await postHttp(`${SUPABASE_INTERNAL_URL}/auth/v1/admin/generate_link`, {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`
      }, { type: "magiclink", email: mapping.supabaseEmail });

      const otp = linkRes.data?.email_otp;
      if (!otp) {
        console.error("[nuvio-sso] generate_link failed:", linkRes);
        return sendJson(res, 500, { ok: false, error: "Failed to generate session link" });
      }

      // Step B: Verify OTP to mint genuine Supabase access_token and refresh_token
      const verifyRes = await postHttp(`${SUPABASE_INTERNAL_URL}/auth/v1/verify`, {
        apikey: ANON_KEY
      }, { type: "email", email: mapping.supabaseEmail, token: otp });

      if (verifyRes.data?.access_token && verifyRes.data?.refresh_token) {
        return sendJson(res, 200, {
          ok: true,
          email: mapping.supabaseEmail,
          session: {
            access_token: verifyRes.data.access_token,
            refresh_token: verifyRes.data.refresh_token,
            user: verifyRes.data.user
          },
          defaultProfileIndex: mapping.defaultProfileIndex,
          defaultProfileName: mapping.defaultProfileName
        });
      }

      return sendJson(res, 500, { ok: false, error: "Failed to exchange session tokens" });
    } catch (err) {
      console.error("[nuvio-sso] Exception in SSO exchange:", err);
      return sendJson(res, 500, { ok: false, error: String(err) });
    }
  }

  // 3. Sync endpoint
  if (pathname === "/api/sync") {
    const email = req.headers["x-user-email"] ? String(req.headers["x-user-email"]).trim() : "";
    const userId = sanitizeId(email || "guest");
    const filePath = path.join(DATA_DIR, `${userId}.json`);

    if (req.method === "GET") {
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(raw);
          return sendJson(res, 200, { ok: true, data: parsed });
        }
      } catch (err) {
        console.error("Error reading sync file:", err);
      }
      return sendJson(res, 200, { ok: true, data: null });
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 20 * 1024 * 1024) {
          req.destroy();
        }
      });

      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          parsed.updatedAt = Date.now();
          const tmpPath = `${filePath}.tmp.${Date.now()}`;
          fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2), "utf-8");
          fs.renameSync(tmpPath, filePath);
          return sendJson(res, 200, { ok: true, updatedAt: parsed.updatedAt });
        } catch (err) {
          console.error("Error writing sync file:", err);
          return sendJson(res, 400, { ok: false, error: "Invalid JSON payload" });
        }
      });
      return;
    }
  }

  // 4. Pre-download / Cache to HomeServer endpoints
  if (pathname === "/api/cache/list" && req.method === "GET") {
    const store = loadDownloads();
    // Query stremio-streaming-server global swarm stats
    http.get(`${STREMIO_INTERNAL_URL}/stats.json`, (statsRes) => {
      let data = "";
      statsRes.on("data", (c) => (data += c));
      statsRes.on("end", async () => {
        let swarms = {};
        try {
          swarms = JSON.parse(data) || {};
        } catch (_) {}

        let storeNeedsSave = false;

        const items = await Promise.all(
          store.items.map(async (item) => {
            const hash = String(item.infoHash || "").toLowerCase();
            const fileIdx = Number(item.fileIdx) || 0;
            const key = `${hash}:${fileIdx}`;
            const isTaskActive = activeCacheTasks.has(key);
            const swarm = swarms[hash];

            let bytesDownloaded = item.bytesDownloaded || 0;
            let totalBytes = item.totalBytes || 0;
            let downloadSpeed = 0;
            let peers = 0;
            let status = item.status || "queued";

            if (swarm) {
              bytesDownloaded = Number(swarm.downloaded) || bytesDownloaded;
              downloadSpeed = Number(swarm.downloadSpeed) || 0;
              peers = Number(swarm.peers ?? swarm.swarmConnections ?? 0);
              if (Array.isArray(swarm.files) && swarm.files[fileIdx]) {
                totalBytes = Number(swarm.files[fileIdx].length) || totalBytes;
                if (!item.filePath && swarm.files[fileIdx].name) {
                  item.filePath = swarm.files[fileIdx].name;
                }
              }
            }

            // Check individual stream stats for actual progress on disk
            if (status !== "completed") {
              const fileStats = await getFileStats(hash, fileIdx);
              if (fileStats) {
                if (fileStats.streamLen) totalBytes = Number(fileStats.streamLen);
                if (fileStats.streamName && !item.filePath) item.filePath = fileStats.streamName;
                if (fileStats.downloadSpeed) downloadSpeed = Number(fileStats.downloadSpeed);
                if (fileStats.peers) peers = Number(fileStats.peers);
                const streamProgress = Number(fileStats.streamProgress) || 0;
                if (streamProgress >= 0.99) {
                  status = "completed";
                  bytesDownloaded = totalBytes;
                  item.status = "completed";
                  item.bytesDownloaded = totalBytes;
                  storeNeedsSave = true;
                } else if (streamProgress > 0 && totalBytes > 0) {
                  bytesDownloaded = Math.max(bytesDownloaded, Math.round(totalBytes * streamProgress));
                }
              }
            }

            const completed = totalBytes > 0 && bytesDownloaded >= totalBytes * 0.99;

            if (completed) {
              status = "completed";
              bytesDownloaded = totalBytes;
              if (item.status !== "completed") {
                item.status = "completed";
                item.bytesDownloaded = totalBytes;
                storeNeedsSave = true;
              }
            } else if (isTaskActive) {
              status = "downloading";
            } else if (status === "downloading" && !isTaskActive) {
              // Task completed or stream idle
              status = completed ? "completed" : "downloading";
            }

            return {
              ...item,
              bytesDownloaded,
              totalBytes,
              downloadSpeed,
              peers,
              status,
              playUrl: item.playUrl || `/streaming/${hash}/${fileIdx}`,
              artworkCached: !!(item.posterUrl || item.artworkCached),
              skipSegments: item.skipSegments || [],
            };
          })
        );

        if (storeNeedsSave) {
          saveDownloads(store);
        }

        return sendJson(res, 200, {
          ok: true,
          root: "HomeServer SSD (/root/.stremio-server/stremio-cache)",
          items,
        });
      });
    }).on("error", () => {
      // Return stored items without live swarm enrichments if server unreachable
      return sendJson(res, 200, {
        ok: true,
        root: "HomeServer SSD (/root/.stremio-server/stremio-cache)",
        items: store.items,
      });
    });
    return;
  }

  if (pathname === "/api/cache/enqueue" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const incoming = Array.isArray(payload.items) ? payload.items : [payload];
        const store = loadDownloads();
        let queuedCount = 0;

        for (const reqItem of incoming) {
          let hash = String(reqItem.infoHash || "").toLowerCase();
          let fileIdx = Number(reqItem.fileIdx) || 0;

          if (!hash && reqItem.url) {
            const match = String(reqItem.url).match(/\/streaming\/([0-9a-fA-F]{40})\/(\d+)/i);
            if (match) {
              hash = match[1].toLowerCase();
              fileIdx = parseInt(match[2], 10) || 0;
            }
          }

          if (!hash || !/^[0-9a-f]{40}$/i.test(hash)) {
            continue;
          }

          const id = `${hash}:${fileIdx}`;
          const existingIdx = store.items.findIndex((x) => x.id === id);

          const itemObj = {
            id,
            contentId: reqItem.contentId || "",
            contentType: reqItem.contentType || "movie",
            videoId: reqItem.videoId || reqItem.contentId || "",
            title: reqItem.title || "Pre-cached media",
            showName: reqItem.showName || undefined,
            season: reqItem.season != null ? Number(reqItem.season) : undefined,
            episode: reqItem.episode != null ? Number(reqItem.episode) : undefined,
            sourceName: reqItem.sourceName || "HomeServer Torrent",
            status: "downloading",
            bytesDownloaded: 0,
            totalBytes: reqItem.totalBytes || 0,
            filePath: reqItem.filename || undefined,
            playUrl: `/streaming/${hash}/${fileIdx}`,
            posterUrl: reqItem.posterUrl,
            artworkCached: !!reqItem.posterUrl,
            createdAt: Date.now(),
            skipSegments: [],
            infoHash: hash,
            fileIdx,
            quality: reqItem.quality || undefined,
          };

          if (existingIdx >= 0) {
            store.items[existingIdx] = { ...store.items[existingIdx], ...itemObj, status: "downloading" };
          } else {
            store.items.unshift(itemObj);
          }

          startBackgroundCache(hash, fileIdx);
          queuedCount++;
        }

        saveDownloads(store);
        return sendJson(res, 200, { ok: true, queued: queuedCount });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON payload" });
      }
    });
    return;
  }

  if (pathname === "/api/cache/cancel" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { id, infoHash, fileIdx } = JSON.parse(body);
        const store = loadDownloads();
        const targetId = id || (infoHash ? `${String(infoHash).toLowerCase()}:${Number(fileIdx) || 0}` : null);
        const item = store.items.find((x) => x.id === targetId);

        if (item) {
          const hash = item.infoHash || (targetId ? targetId.split(":")[0] : "");
          const idx = item.fileIdx != null ? item.fileIdx : (targetId ? parseInt(targetId.split(":")[1], 10) : 0);
          const task = activeCacheTasks.get(`${hash}:${idx}`);
          if (task) task.stop();
          item.status = "cancelled";
          saveDownloads(store);
        }
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
      }
    });
    return;
  }

  if (pathname === "/api/cache/retry" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { id, infoHash, fileIdx } = JSON.parse(body);
        const store = loadDownloads();
        const targetId = id || (infoHash ? `${String(infoHash).toLowerCase()}:${Number(fileIdx) || 0}` : null);
        const item = store.items.find((x) => x.id === targetId);

        if (item) {
          const hash = item.infoHash || (targetId ? targetId.split(":")[0] : "");
          const idx = item.fileIdx != null ? item.fileIdx : (targetId ? parseInt(targetId.split(":")[1], 10) : 0);
          item.status = "downloading";
          startBackgroundCache(hash, idx);
          saveDownloads(store);
        }
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
      }
    });
    return;
  }

  if (pathname === "/api/cache/remove" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { id, infoHash, fileIdx } = JSON.parse(body);
        const store = loadDownloads();
        const targetId = id || (infoHash ? `${String(infoHash).toLowerCase()}:${Number(fileIdx) || 0}` : null);
        const item = store.items.find((x) => x.id === targetId);

        if (item) {
          const hash = item.infoHash || (targetId ? targetId.split(":")[0] : "");
          const idx = item.fileIdx != null ? item.fileIdx : (targetId ? parseInt(targetId.split(":")[1], 10) : 0);
          const task = activeCacheTasks.get(`${hash}:${idx}`);
          if (task) task.stop();
        }

        store.items = store.items.filter((x) => x.id !== targetId);
        saveDownloads(store);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
      }
    });
    return;
  }

  if (pathname === "/api/cache/start" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { infoHash, fileIdx } = JSON.parse(body);
        if (!infoHash || !/^[0-9a-f]{40}$/i.test(infoHash)) {
          return sendJson(res, 400, { ok: false, error: "Invalid infoHash" });
        }
        const idx = Number.isInteger(fileIdx) ? fileIdx : parseInt(fileIdx, 10) || 0;
        startBackgroundCache(infoHash.toLowerCase(), idx);
        return sendJson(res, 200, { ok: true, active: true });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
      }
    });
    return;
  }

  if (pathname === "/api/cache/stop" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { infoHash, fileIdx } = JSON.parse(body);
        const idx = Number.isInteger(fileIdx) ? fileIdx : parseInt(fileIdx, 10) || 0;
        const key = `${String(infoHash).toLowerCase()}:${idx}`;
        const task = activeCacheTasks.get(key);
        if (task) task.stop();
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
      }
    });
    return;
  }

  if (pathname === "/api/cache/status" && req.method === "GET") {
    const infoHash = (url.searchParams.get("hash") || "").toLowerCase();
    const fileIdx = parseInt(url.searchParams.get("fileIdx") || "0", 10);
    if (!infoHash || !/^[0-9a-f]{40}$/i.test(infoHash)) {
      return sendJson(res, 400, { ok: false, error: "Invalid infoHash" });
    }
    const key = `${infoHash}:${fileIdx}`;
    const isActive = activeCacheTasks.has(key);

    http.get(`${STREMIO_INTERNAL_URL}/${infoHash}/${fileIdx}/stats.json`, (statsRes) => {
      let data = "";
      statsRes.on("data", (c) => (data += c));
      statsRes.on("end", () => {
        try {
          const stats = JSON.parse(data);
          if (!stats) {
            return sendJson(res, 200, {
              ok: true,
              active: isActive,
              completed: false,
              downloaded: 0,
              streamLen: 0,
              percent: 0,
              downloadSpeed: 0,
              peers: 0,
              swarmSize: 0,
            });
          }
          const downloaded = Number(stats.downloaded) || 0;
          const streamLen = Number(stats.streamLen) || 0;
          const downloadSpeed = Number(stats.downloadSpeed) || 0;
          const percent = streamLen > 0 ? Math.min(100, Math.round((downloaded / streamLen) * 100)) : 0;
          const completed = streamLen > 0 && downloaded >= streamLen * 0.99;
          return sendJson(res, 200, {
            ok: true,
            active: isActive,
            completed,
            downloaded,
            streamLen,
            percent,
            downloadSpeed,
            peers: Number(stats.peers ?? stats.swarmConnections) || 0,
            swarmSize: Number(stats.swarmSize) || 0,
          });
        } catch {
          return sendJson(res, 200, { ok: false, active: isActive, error: "Could not parse stream stats" });
        }
      });
    }).on("error", (err) => {
      return sendJson(res, 200, { ok: false, active: isActive, error: err.message });
    });
    return;
  }

  // Fallback 404
  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[nuvio-sync] Server listening on http://127.0.0.1:${PORT}`);
});
