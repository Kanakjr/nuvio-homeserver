/**
 * Resolves a torrent infoHash into an HTTPS streaming endpoint powered by the
 * local companion streaming server, plus a fallback magnet URL.
 */
export function resolveTorrentStreamUrl(
  infoHash: string | undefined,
  fileIdx = 0,
  filename?: string,
  sources?: unknown[],
): { url: string; externalUrl: string } | null {
  if (!infoHash) return null;
  const hash = infoHash.trim().toLowerCase();
  // Valid BitTorrent infoHash is a 40-char hex string
  if (!/^[0-9a-f]{40}$/i.test(hash)) return null;

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";

  const cleanFilename = filename ? `/${encodeURIComponent(filename)}` : "";

  const trList = Array.isArray(sources)
    ? sources
        .map(String)
        .filter((s) => s.startsWith("tracker:"))
        .map((s) => s.replace(/^tracker:/, ""))
    : [];

  const trQuery =
    trList.length > 0
      ? "?" + trList.map((tr) => `tr=${encodeURIComponent(tr)}`).join("&")
      : "";

  const magnetTr = trList.map((tr) => `&tr=${encodeURIComponent(tr)}`).join("");
  const magnetDn = filename ? `&dn=${encodeURIComponent(filename)}` : "";

  return {
    url: `${origin}/streaming/${hash}/${fileIdx}${cleanFilename}${trQuery}`,
    externalUrl: `magnet:?xt=urn:btih:${hash}${magnetDn}${magnetTr}`,
  };
}
