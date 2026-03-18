import { describe, expect, it } from "vitest";
import {
  filterLocalVoices,
  normalizeSummaryForSpeech,
  splitTextForTts,
  SUMMARY_AUDIO_MAX_CHARS,
  TTS_MAX_UTTERANCE_LENGTH,
} from "./tts";

describe("splitTextForTts", () => {
  it("returns empty array for blank input", () => {
    expect(splitTextForTts("   ")).toEqual([]);
  });

  it("splits long text into safe chunks", () => {
    const text = "sentence ".repeat(1200);
    const chunks = splitTextForTts(text, 700);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 700)).toBe(true);
  });

  it("never exceeds chrome utterance max", () => {
    const text = "a".repeat(TTS_MAX_UTTERANCE_LENGTH + 1000);
    const chunks = splitTextForTts(text, TTS_MAX_UTTERANCE_LENGTH + 5000);
    expect(chunks.every((c) => c.length <= TTS_MAX_UTTERANCE_LENGTH)).toBe(true);
  });
});

describe("filterLocalVoices", () => {
  it("removes remote voices only", () => {
    const voices = [
      { voiceName: "Local 1", remote: false },
      { voiceName: "Local 2" },
      { voiceName: "Remote 1", remote: true },
    ] as chrome.tts.TtsVoice[];
    const local = filterLocalVoices(voices);
    expect(local).toHaveLength(2);
    expect(local.map((v) => v.voiceName)).toEqual(["Local 1", "Local 2"]);
  });
});

describe("normalizeSummaryForSpeech", () => {
  it("strips markdown and technical noise", () => {
    const input = [
      "# Summary of Bookmarks",
      "## 1) Overall Summary",
      "- **Highlighted Insight:** Something happened (snippet: abc123)",
      "- [Source](https://example.com/path)",
      "### Folder: ZeroPin",
    ].join("\n");
    const out = normalizeSummaryForSpeech(input);
    expect(out.wasTrimmed).toBe(false);
    expect(out.text).not.toMatch(/[#*`]/);
    expect(out.text).not.toContain("snippet:");
    expect(out.text).not.toContain("https://");
    expect(out.text).toContain("Summary of Bookmarks.");
    expect(out.text).toContain("Highlighted Insight:");
  });

  it("caps audio text and appends trim note", () => {
    const input = `# Title\n${"long text ".repeat(5000)}`;
    const out = normalizeSummaryForSpeech(input);
    expect(out.wasTrimmed).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(SUMMARY_AUDIO_MAX_CHARS);
    expect(out.text.endsWith("Summary shortened for audio.")).toBe(true);
  });
});
