/**
 * YouTube URL utilities for ZeroPin's YouTube Moment Pins.
 * Pure functions — no DOM, no storage; safe in both page and service-worker contexts.
 */

// ── Type ────────────────────────────────────────────────────────────────────

/** Message response returned by the content script after a ZP_CAPTURE_YT_MOMENT request. */
export type YouTubeCaptureResult =
  | {
      kind: "youtube";
      videoId: string;
      timestampSec: number;
      timestampLabel: string;
      canonicalUrl: string;
      openUrl: string;
      captureMethod: "video.currentTime" | "urlParam";
    }
  | {
      kind: "fallback";
      videoId?: string;
      canonicalUrl: string;
      openUrl: string;
    };

// ── URL predicates ───────────────────────────────────────────────────────────

/** Returns true for youtube.com/watch?v=… and youtu.be/… URLs. */
export function isYouTubeWatchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (
      (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") &&
      u.pathname === "/watch" &&
      u.searchParams.has("v")
    ) return true;
    if (u.hostname === "youtu.be" && u.pathname.length > 1) return true;
    return false;
  } catch {
    return false;
  }
}

/** Extracts the video ID from a YouTube watch or youtu.be URL. Returns null if not found. */
export function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") {
      return u.searchParams.get("v");
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1).split("?")[0];
      return id || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the canonical form: https://www.youtube.com/watch?v=VIDEO_ID
 * Strips all other parameters (playlist, timestamp, etc.).
 * Returns null if the URL is not a recognizable YouTube watch URL.
 */
export function normalizeYouTubeCanonicalUrl(url: string): string | null {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ── Time parsing / formatting ────────────────────────────────────────────────

/**
 * Parses a YouTube time string to total seconds.
 * Supports: "125"  "125s"  "2m5s"  "1h02m03s"  "1h"  "30m"
 * Returns null if value is empty or does not match any recognised pattern.
 */
export function parseYouTubeTimeToSec(value: string): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  // Match any combination of hours, minutes, seconds (at least one must be present)
  const match = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const h = parseInt(match[1] ?? "0");
  const m = parseInt(match[2] ?? "0");
  const s = parseInt(match[3] ?? "0");
  return h * 3600 + m * 60 + s;
}

/**
 * Formats total seconds to a display label.
 * Examples:  516 → "08:36"   3723 → "1:02:03"   0 → "00:00"
 */
export function formatSecToLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Appends the timestamp query parameter to a canonical YouTube watch URL.
 * buildYouTubeOpenUrl("https://www.youtube.com/watch?v=abc", 516)
 *   → "https://www.youtube.com/watch?v=abc&t=516s"
 */
export function buildYouTubeOpenUrl(canonicalUrl: string, sec: number): string {
  return `${canonicalUrl}&t=${sec}s`;
}
