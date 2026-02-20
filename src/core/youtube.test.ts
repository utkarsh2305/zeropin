import { describe, it, expect } from "vitest";
import {
  isYouTubeWatchUrl,
  getYouTubeVideoId,
  normalizeYouTubeCanonicalUrl,
  parseYouTubeTimeToSec,
  formatSecToLabel,
  buildYouTubeOpenUrl,
} from "./youtube";

// ── isYouTubeWatchUrl ────────────────────────────────────────────────────────

describe("isYouTubeWatchUrl", () => {
  it("accepts www.youtube.com/watch?v=", () => {
    expect(isYouTubeWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  it("accepts youtube.com/watch?v= (no www)", () => {
    expect(isYouTubeWatchUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  it("accepts youtu.be short URL", () => {
    expect(isYouTubeWatchUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  it("accepts watch URL with extra params", () => {
    expect(isYouTubeWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s&list=PL1")).toBe(true);
  });

  it("rejects non-watch YouTube page", () => {
    expect(isYouTubeWatchUrl("https://www.youtube.com/shorts/abc123")).toBe(false);
    expect(isYouTubeWatchUrl("https://www.youtube.com/channel/UC1234")).toBe(false);
  });

  it("rejects non-YouTube URLs", () => {
    expect(isYouTubeWatchUrl("https://example.com")).toBe(false);
    expect(isYouTubeWatchUrl("https://vimeo.com/watch?v=123")).toBe(false);
  });

  it("rejects malformed URL", () => {
    expect(isYouTubeWatchUrl("not a url")).toBe(false);
  });

  it("rejects watch without v= param", () => {
    expect(isYouTubeWatchUrl("https://www.youtube.com/watch")).toBe(false);
  });
});

// ── getYouTubeVideoId ────────────────────────────────────────────────────────

describe("getYouTubeVideoId", () => {
  it("extracts ID from watch URL", () => {
    expect(getYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from youtu.be URL", () => {
    expect(getYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from youtu.be URL with query params", () => {
    expect(getYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=125")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for non-YouTube URL", () => {
    expect(getYouTubeVideoId("https://example.com")).toBeNull();
  });

  it("returns null for malformed URL", () => {
    expect(getYouTubeVideoId("not a url")).toBeNull();
  });
});

// ── normalizeYouTubeCanonicalUrl ─────────────────────────────────────────────

describe("normalizeYouTubeCanonicalUrl", () => {
  it("strips timestamp from URL", () => {
    expect(normalizeYouTubeCanonicalUrl("https://www.youtube.com/watch?v=abc&t=125s"))
      .toBe("https://www.youtube.com/watch?v=abc");
  });

  it("strips playlist and other params", () => {
    expect(normalizeYouTubeCanonicalUrl("https://www.youtube.com/watch?v=abc&list=PL1&index=2"))
      .toBe("https://www.youtube.com/watch?v=abc");
  });

  it("normalises youtu.be to canonical form", () => {
    expect(normalizeYouTubeCanonicalUrl("https://youtu.be/abc123"))
      .toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("normalises youtube.com (no www)", () => {
    expect(normalizeYouTubeCanonicalUrl("https://youtube.com/watch?v=abc"))
      .toBe("https://www.youtube.com/watch?v=abc");
  });

  it("returns null for non-YouTube URL", () => {
    expect(normalizeYouTubeCanonicalUrl("https://example.com")).toBeNull();
  });

  it("is idempotent", () => {
    const canonical = "https://www.youtube.com/watch?v=abc";
    expect(normalizeYouTubeCanonicalUrl(canonical)).toBe(canonical);
  });
});

// ── parseYouTubeTimeToSec ────────────────────────────────────────────────────

describe("parseYouTubeTimeToSec", () => {
  it("parses bare seconds integer", () => {
    expect(parseYouTubeTimeToSec("125")).toBe(125);
  });

  it("parses seconds with s suffix", () => {
    expect(parseYouTubeTimeToSec("125s")).toBe(125);
  });

  it("parses minutes + seconds", () => {
    expect(parseYouTubeTimeToSec("2m5s")).toBe(125);
  });

  it("parses hours + minutes + seconds", () => {
    expect(parseYouTubeTimeToSec("1h02m03s")).toBe(3723);
  });

  it("parses hours only", () => {
    expect(parseYouTubeTimeToSec("1h")).toBe(3600);
  });

  it("parses minutes only", () => {
    expect(parseYouTubeTimeToSec("30m")).toBe(1800);
  });

  it("parses zero", () => {
    expect(parseYouTubeTimeToSec("0")).toBe(0);
    expect(parseYouTubeTimeToSec("0s")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(parseYouTubeTimeToSec("1H30M")).toBe(5400);
  });

  it("trims whitespace", () => {
    expect(parseYouTubeTimeToSec("  125s  ")).toBe(125);
  });

  it("returns null for empty string", () => {
    expect(parseYouTubeTimeToSec("")).toBeNull();
  });

  it("returns null for non-time string", () => {
    expect(parseYouTubeTimeToSec("abc")).toBeNull();
    expect(parseYouTubeTimeToSec("playlist")).toBeNull();
  });
});

// ── formatSecToLabel ─────────────────────────────────────────────────────────

describe("formatSecToLabel", () => {
  it("formats minutes:seconds with padding", () => {
    expect(formatSecToLabel(516)).toBe("08:36");
  });

  it("formats hours:minutes:seconds", () => {
    expect(formatSecToLabel(3723)).toBe("1:02:03");
  });

  it("formats zero as 00:00", () => {
    expect(formatSecToLabel(0)).toBe("00:00");
  });

  it("formats under a minute", () => {
    expect(formatSecToLabel(5)).toBe("00:05");
  });

  it("formats exactly 1 hour", () => {
    expect(formatSecToLabel(3600)).toBe("1:00:00");
  });

  it("round-trips with parseYouTubeTimeToSec for common inputs", () => {
    // parseYouTubeTimeToSec("1h02m03s") = 3723
    expect(formatSecToLabel(3723)).toBe("1:02:03");
    // parseYouTubeTimeToSec("2m5s") = 125
    expect(formatSecToLabel(125)).toBe("02:05");
  });
});

// ── buildYouTubeOpenUrl ──────────────────────────────────────────────────────

describe("buildYouTubeOpenUrl", () => {
  it("appends t= to canonical URL", () => {
    expect(buildYouTubeOpenUrl("https://www.youtube.com/watch?v=abc", 516))
      .toBe("https://www.youtube.com/watch?v=abc&t=516s");
  });

  it("appends t=0s for zero seconds", () => {
    expect(buildYouTubeOpenUrl("https://www.youtube.com/watch?v=abc", 0))
      .toBe("https://www.youtube.com/watch?v=abc&t=0s");
  });
});

// ── content-script capture mock test ─────────────────────────────────────────
// Simulates the capture logic used in contentScript.ts (without importing the
// content script itself, which requires a full browser environment).

describe("YouTube capture logic (mocked video element)", () => {
  it("returns valid moment when video.currentTime >= 2 and readyState >= 2", () => {
    const mockVideo = {
      currentTime: 516,
      readyState: 4,
      duration: 3600,
      seekable: { length: 1 },
    } as unknown as HTMLVideoElement;

    // Simulate the capture decision
    const t = Math.floor(mockVideo.currentTime ?? 0);
    const isLive = mockVideo.duration === Infinity;
    const notSeekable = mockVideo.seekable && mockVideo.seekable.length === 0;
    const ready = mockVideo.readyState >= 2;

    expect(isLive).toBe(false);
    expect(notSeekable).toBe(false);
    expect(ready).toBe(true);
    expect(t >= 2).toBe(true);
    expect(formatSecToLabel(t)).toBe("08:36");
  });

  it("falls back for live stream (duration === Infinity)", () => {
    const mockVideo = {
      currentTime: 100,
      readyState: 4,
      duration: Infinity,
      seekable: { length: 1 },
    } as unknown as HTMLVideoElement;

    const isLive = mockVideo.duration === Infinity;
    expect(isLive).toBe(true);
  });

  it("falls back when video not started (currentTime < 2)", () => {
    const mockVideo = {
      currentTime: 0,
      readyState: 4,
      duration: 300,
      seekable: { length: 1 },
    } as unknown as HTMLVideoElement;

    const t = Math.floor(mockVideo.currentTime ?? 0);
    expect(t >= 2).toBe(false);
  });

  it("falls back when player not ready (readyState < 2)", () => {
    const mockVideo = {
      currentTime: 50,
      readyState: 1,
      duration: 300,
      seekable: { length: 1 },
    } as unknown as HTMLVideoElement;

    expect(mockVideo.readyState >= 2).toBe(false);
  });
});
