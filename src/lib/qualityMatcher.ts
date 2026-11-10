import type { Stream } from "../types";

export type QualityFilter = "ALL" | "4K" | "1080P" | "720P" | "HDR";

export function matchStreamQuality(stream: Stream, filter: QualityFilter): boolean {
  if (filter === "ALL") return true;
  const text = [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (filter === "4K") {
    return /\b(2160p|4k|uhd)\b/i.test(text);
  }
  if (filter === "1080P") {
    return /\b(1080p|fhd)\b/i.test(text);
  }
  if (filter === "720P") {
    return /\b(720p|hd)\b/i.test(text);
  }
  if (filter === "HDR") {
    return /\b(hdr|hdr10|hdr10\+|dovi|dv|dolby\s*vision)\b/i.test(text);
  }
  return true;
}

export function detectStreamQualityTag(stream: Stream): string {
  const text = [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
  ]
    .filter(Boolean)
    .join(" ");

  const has4K = /\b(2160p|4k|uhd)\b/i.test(text);
  const has1080 = /\b(1080p|fhd)\b/i.test(text);
  const has720 = /\b(720p|hd)\b/i.test(text);
  const hasHDR = /\b(hdr|hdr10|hdr10\+|dovi|dv|dolby\s*vision)\b/i.test(text);

  const parts: string[] = [];
  if (has4K) parts.push("4K");
  else if (has1080) parts.push("1080p");
  else if (has720) parts.push("720p");

  if (hasHDR) parts.push("HDR");
  return parts.join(" ");
}
