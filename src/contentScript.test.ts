/**
 * End-to-end tests for the 6-stage anchoring pipeline.
 *
 * We cannot import contentScript.ts directly because it has side effects
 * (chrome listeners, on-load poll). Instead we extract and test the core
 * logic by re-implementing the pipeline helpers inline, using the same
 * anchor.ts utilities that the real content script uses.
 */
import { describe, it, expect, beforeEach } from "vitest";

// Polyfill CSS.escape for jsdom
if (typeof CSS === "undefined" || !CSS.escape) {
  (globalThis as any).CSS = {
    escape: (s: string) => s.replace(/([^\w-])/g, "\\$1"),
  };
}
import {
  normalizeText,
  buildNormalizedDocText,
  docTextToRange,
  walkTextNodes,
  escapeRegex,
  createRangeFromMatch,
  rangeFromOffsets,
  jaroWinklerSimilarity,
  normalizedSimilarity,
  prefixMatches,
  suffixMatches,
  walkTextNodesShadow,
} from "./core/anchor";

// ── Types (mirrors contentScript.ts) ──

interface SnippetAnchor {
  text: string;
  prefix?: string;
  suffix?: string;
  startOffset?: number;
  endOffset?: number;
  capturedAt?: number;
  fingerprint?: {
    head: string;
    mid: string;
    tail: string;
    length: number;
  };
  chatContext?: {
    platform: "chatgpt" | "claude" | "unknown";
    conversationId?: string;
    messageIndex?: number;
    role?: "user" | "assistant";
    messageId?: string;
    turnHash?: string;
    startOffsetInMessage?: number;
    endOffsetInMessage?: number;
  };
  containerHint?: {
    cssPath?: string;
    xpath?: string;
    containerTextSample?: string;
  };
  repairedAt?: number;
}

interface HighlightResult {
  found: boolean;
  confidence: number;
  stage?: string;
  range?: Range;
  container?: Element;
  reason?: string;
}

// ── Re-implement pipeline helpers (same logic as contentScript.ts) ──

const FUZZY_SIMILARITY_MIN = 0.6;
const FINGERPRINT_FRAG_LENGTH = 30;

function buildFingerprint(text: string): SnippetAnchor["fingerprint"] {
  const len = text.length;
  if (len < FINGERPRINT_FRAG_LENGTH) {
    const norm = normalizeText(text);
    return { head: norm, mid: norm, tail: norm, length: len };
  }
  const midStart = Math.floor(len / 2) - Math.floor(FINGERPRINT_FRAG_LENGTH / 2);
  return {
    head: normalizeText(text.slice(0, FINGERPRINT_FRAG_LENGTH)),
    mid: normalizeText(text.slice(midStart, midStart + FINGERPRINT_FRAG_LENGTH)),
    tail: normalizeText(text.slice(-FINGERPRINT_FRAG_LENGTH)),
    length: len,
  };
}

function findByExactMatch(text: string, root: Node = document.body): Range | null {
  const regex = new RegExp(escapeRegex(text));
  for (const node of walkTextNodes(root)) {
    const nodeText = node.textContent ?? "";
    const match = nodeText.match(regex);
    if (match) return createRangeFromMatch(node, match);
  }
  return null;
}

function findAllMatches(text: string, root: Node = document.body): Array<{ range: Range; node: Text; index: number }> {
  const matches: Array<{ range: Range; node: Text; index: number }> = [];
  const regex = new RegExp(escapeRegex(text), "g");
  for (const node of walkTextNodes(root)) {
    const nodeText = node.textContent ?? "";
    let match;
    while ((match = regex.exec(nodeText)) !== null) {
      matches.push({ range: createRangeFromMatch(node, match), node, index: match.index });
    }
  }
  return matches;
}

function isUnique(_range: Range, text: string, root: Node = document.body): boolean {
  return findAllMatches(text, root).length === 1;
}

function scoreByContext(range: Range, expectedPrefix?: string, expectedSuffix?: string): number {
  let score = 0;
  if (expectedPrefix) score += prefixMatches(range, expectedPrefix) ? 1 : 0;
  if (expectedSuffix) score += suffixMatches(range, expectedSuffix) ? 1 : 0;
  return score;
}

function simpleTurnHash(text: string): string {
  const sample = normalizeText(text.slice(0, 100));
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function findByChatContext(
  text: string,
  chatContext: NonNullable<SnippetAnchor["chatContext"]>,
): Range | null {
  let messageEl: Element | null = null;

  if (chatContext.platform === "chatgpt" && chatContext.messageId) {
    messageEl = document.querySelector(`[data-message-id="${CSS.escape(chatContext.messageId)}"]`);
  }
  if (!messageEl && chatContext.platform === "claude") {
    const allMessages = document.querySelectorAll("[data-testid*='chat-message']");
    if (chatContext.messageIndex != null && chatContext.messageIndex < allMessages.length) {
      messageEl = allMessages[chatContext.messageIndex];
    }
  }
  if (!messageEl && chatContext.platform === "chatgpt") {
    const allMessages = document.querySelectorAll("[data-message-id]");
    if (chatContext.messageIndex != null && chatContext.messageIndex < allMessages.length) {
      messageEl = allMessages[chatContext.messageIndex];
    }
  }
  if (!messageEl && chatContext.messageIndex != null) {
    const selectors = ["[class*='message']", "[class*='Message']", "[role='row']", "[data-role]"];
    for (const sel of selectors) {
      const all = document.querySelectorAll(sel);
      if (chatContext.messageIndex < all.length) {
        messageEl = all[chatContext.messageIndex];
        break;
      }
    }
  }
  if (!messageEl) return null;

  const regex = new RegExp(escapeRegex(text));
  for (const node of walkTextNodes(messageEl)) {
    const nodeText = node.textContent ?? "";
    const match = nodeText.match(regex);
    if (match) return createRangeFromMatch(node, match);
  }
  return null;
}

function findByFingerprint(fingerprint: NonNullable<SnippetAnchor["fingerprint"]>, root: Node = document.body): Range | null {
  const docMap = buildNormalizedDocText(root);
  const { normalized } = docMap;
  const headIdx = normalized.indexOf(fingerprint.head);
  if (headIdx === -1) return null;

  const searchWindow = Math.ceil(fingerprint.length * 1.5);
  const regionEnd = Math.min(headIdx + searchWindow, normalized.length);
  const region = normalized.slice(headIdx, regionEnd);

  const midIdx = region.indexOf(fingerprint.mid);
  const tailIdx = region.indexOf(fingerprint.tail);
  if (midIdx === -1 || tailIdx === -1) return null;

  const normStart = headIdx;
  const normEnd = Math.min(headIdx + tailIdx + fingerprint.tail.length, normalized.length);
  return docTextToRange(docMap, normStart, normEnd);
}

function findBestFuzzyMatch(text: string, root: Node = document.body): { range: Range; similarity: number } | null {
  let bestMatch: { range: Range; similarity: number } | null = null;
  for (const node of walkTextNodes(root)) {
    const nodeText = node.textContent ?? "";
    for (let i = 0; i <= nodeText.length - text.length; i++) {
      const candidate = nodeText.substring(i, i + text.length);
      const similarity = jaroWinklerSimilarity(text, candidate);
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { range: createRangeFromMatch(node, { 0: candidate, index: i }), similarity };
      }
    }
  }
  return bestMatch && bestMatch.similarity > 0 ? bestMatch : null;
}

/** Run stages A-F scoped to a given root node */
function runStages(anchor: SnippetAnchor, root: Node, containerBoost: number): HighlightResult | null {
  let range: Range | null = null;

  // A: Exact unique
  range = findByExactMatch(anchor.text, root);
  if (range && isUnique(range, anchor.text, root)) {
    return { found: true, confidence: Math.min(1.0, 1.0 + containerBoost), stage: "A", range };
  }

  // B: Prefix/suffix
  if (range) {
    const candidates = findAllMatches(anchor.text, root);
    const scored = candidates.map((c) => ({
      range: c.range,
      score: scoreByContext(c.range, anchor.prefix, anchor.suffix),
    }));
    const best = scored.sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= (anchor.prefix && anchor.suffix ? 2 : 1)) {
      const baseConf = best.score >= 2 ? 0.95 : 0.80;
      return { found: true, confidence: Math.min(1.0, baseConf + containerBoost), stage: "B", range: best.range };
    }
  }

  // C: Chat structural
  if (anchor.chatContext) {
    const chatRange = findByChatContext(anchor.text, anchor.chatContext);
    if (chatRange) return { found: true, confidence: Math.min(1.0, 0.90 + containerBoost), stage: "C", range: chatRange };
  }

  // D: Position offsets
  if (anchor.startOffset != null && anchor.endOffset != null) {
    const posRange = rangeFromOffsets(root, anchor.startOffset, anchor.endOffset);
    if (posRange) {
      const sim = normalizedSimilarity(posRange.toString(), anchor.text);
      if (sim > 0.7) return { found: true, confidence: Math.min(1.0, sim + containerBoost), stage: "D", range: posRange };
    }
  }

  // E: Fingerprint
  if (anchor.fingerprint) {
    const fpRange = findByFingerprint(anchor.fingerprint, root);
    if (fpRange) {
      const sim = normalizedSimilarity(fpRange.toString(), anchor.text);
      if (sim > 0.5) {
        const baseConf = 0.5 + sim * 0.3;
        return { found: true, confidence: Math.min(1.0, baseConf + containerBoost), stage: "E", range: fpRange };
      }
    }
  }

  // F: Fuzzy
  const fuzzy = findBestFuzzyMatch(anchor.text, root);
  if (fuzzy && fuzzy.similarity > FUZZY_SIMILARITY_MIN) {
    const baseConf = fuzzy.similarity * 0.7;
    return { found: true, confidence: Math.min(1.0, baseConf + containerBoost), stage: "F", range: fuzzy.range };
  }

  return null;
}

// Shadow DOM search helpers
function findByExactMatchShadow(text: string): Range | null {
  const regex = new RegExp(escapeRegex(text));
  for (const node of walkTextNodesShadow(document.body)) {
    const nodeText = node.textContent ?? "";
    const match = nodeText.match(regex);
    if (match) return createRangeFromMatch(node, match);
  }
  return null;
}

function findBestFuzzyMatchShadow(text: string): { range: Range; similarity: number } | null {
  let bestMatch: { range: Range; similarity: number } | null = null;
  for (const node of walkTextNodesShadow(document.body)) {
    const nodeText = node.textContent ?? "";
    for (let i = 0; i <= nodeText.length - text.length; i++) {
      const candidate = nodeText.substring(i, i + text.length);
      const similarity = jaroWinklerSimilarity(text, candidate);
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { range: createRangeFromMatch(node, { 0: candidate, index: i }), similarity };
      }
    }
  }
  return bestMatch && bestMatch.similarity > 0 ? bestMatch : null;
}

/** Full pipeline with container-first + confidence (mirrors contentScript.ts highlightSnippet) */
function locateSnippet(anchor: SnippetAnchor | undefined): HighlightResult {
  if (!anchor) return { found: false, confidence: 0, reason: "No anchor provided" };
  if (!anchor.text) return { found: false, confidence: 0, reason: "Anchor has no text" };

  // 1. Container-scoped search
  if (anchor.containerHint?.cssPath) {
    const container = document.querySelector(anchor.containerHint.cssPath);
    if (container) {
      let containerVerified = true;
      if (anchor.containerHint.containerTextSample) {
        const currentSample = normalizeText(
          (container as HTMLElement).innerText?.slice(0, 120) ?? ""
        );
        const sim = normalizedSimilarity(currentSample, anchor.containerHint.containerTextSample);
        containerVerified = sim >= 0.6;
      }
      if (containerVerified) {
        const result = runStages(anchor, container, 0.05);
        if (result) {
          result.container = container as Element;
          return result;
        }
      }
    }
  }

  // 2. Chat context container search
  if (anchor.chatContext) {
    let messageEl: Element | null = null;
    if (anchor.chatContext.platform === "chatgpt" && anchor.chatContext.messageId) {
      messageEl = document.querySelector(`[data-message-id="${CSS.escape(anchor.chatContext.messageId)}"]`);
    }
    if (!messageEl && anchor.chatContext.platform === "claude") {
      const allMessages = document.querySelectorAll("[data-testid*='chat-message']");
      if (anchor.chatContext.messageIndex != null && anchor.chatContext.messageIndex < allMessages.length) {
        messageEl = allMessages[anchor.chatContext.messageIndex];
      }
    }
    if (!messageEl && anchor.chatContext.platform === "chatgpt") {
      const allMessages = document.querySelectorAll("[data-message-id]");
      if (anchor.chatContext.messageIndex != null && anchor.chatContext.messageIndex < allMessages.length) {
        messageEl = allMessages[anchor.chatContext.messageIndex];
      }
    }
    if (messageEl) {
      const result = runStages(anchor, messageEl, 0.05);
      if (result) {
        result.container = messageEl;
        return result;
      }
    }
  }

  // 3. Global scan
  const globalResult = runStages(anchor, document.body, 0);
  if (globalResult) return globalResult;

  // 4. Stage G: Shadow DOM fallback
  const shadowExact = findByExactMatchShadow(anchor.text);
  if (shadowExact) {
    return { found: true, confidence: 0.90, stage: "G-exact", range: shadowExact };
  }
  const shadowFuzzy = findBestFuzzyMatchShadow(anchor.text);
  if (shadowFuzzy && shadowFuzzy.similarity > FUZZY_SIMILARITY_MIN) {
    return { found: true, confidence: shadowFuzzy.similarity * 0.7, stage: "G-fuzzy", range: shadowFuzzy.range };
  }

  return { found: false, confidence: 0, reason: "All stages failed" };
}

// ── Tests ──

describe("Fingerprint building", () => {
  it("builds head/mid/tail for long text", () => {
    const text = "The quick brown fox jumps over the lazy dog and then some more text to reach thirty chars";
    const fp = buildFingerprint(text)!;
    expect(fp.head).toBe(normalizeText(text.slice(0, 30)));
    expect(fp.tail).toBe(normalizeText(text.slice(-30)));
    expect(fp.length).toBe(text.length);
  });

  it("handles short text (all fragments are same)", () => {
    const text = "short";
    const fp = buildFingerprint(text)!;
    expect(fp.head).toBe("short");
    expect(fp.mid).toBe("short");
    expect(fp.tail).toBe("short");
    expect(fp.length).toBe(5);
  });
});

describe("Stage A: Exact unique match", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("finds unique text", () => {
    document.body.innerHTML = "<p>The quick brown fox jumps over the lazy dog.</p>";
    const result = locateSnippet({ text: "quick brown fox" });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("A");
    expect(result.range!.toString()).toBe("quick brown fox");
  });

  it("does not use stage A for duplicate text", () => {
    document.body.innerHTML = "<p>hello world</p><p>hello world</p>";
    const result = locateSnippet({ text: "hello world" });
    // Should NOT match stage A (not unique), will fall through
    expect(result.found).toBe(true);
    expect(result.stage).not.toBe("A");
  });
});

describe("Stage B: Prefix/suffix disambiguation", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("disambiguates duplicates with prefix", () => {
    document.body.innerHTML = "<p>AAA hello world BBB</p><p>CCC hello world DDD</p>";
    const result = locateSnippet({
      text: "hello world",
      prefix: "CCC ",
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("B");
  });

  it("disambiguates with both prefix and suffix", () => {
    document.body.innerHTML = "<p>AAA hello world BBB</p><p>CCC hello world DDD</p>";
    const result = locateSnippet({
      text: "hello world",
      prefix: "AAA ",
      suffix: " BBB",
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("B");
  });
});

describe("Stage C: AI chat structural anchor", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("finds text in ChatGPT message by messageId (chat-scoped)", () => {
    document.body.innerHTML = `
      <div data-message-id="msg-1" data-message-author-role="user">
        <p>Please explain this concept clearly.</p>
      </div>
      <div data-message-id="msg-2" data-message-author-role="assistant">
        <p>Let me explain this concept clearly.</p>
        <p>Please explain this concept clearly.</p>
      </div>
    `;
    const result = locateSnippet({
      text: "Please explain this concept clearly.",
      chatContext: {
        platform: "chatgpt",
        messageId: "msg-1",
        messageIndex: 0,
        role: "user",
      },
    });
    expect(result.found).toBe(true);
    // Chat-scoped search finds it unique within msg-1 → stage A with container boost
    expect(result.stage).toBe("A");
    expect(result.container).toBeTruthy();
    expect(result.confidence).toBeGreaterThanOrEqual(1.0);
  });

  it("finds text in Claude message by messageIndex (chat-scoped)", () => {
    document.body.innerHTML = `
      <div data-testid="chat-message-human"><p>Hello there</p></div>
      <div data-testid="chat-message-assistant"><p>Hello there</p><p>How can I help?</p></div>
    `;
    const result = locateSnippet({
      text: "Hello there",
      chatContext: {
        platform: "claude",
        messageIndex: 0,
        role: "user",
      },
    });
    expect(result.found).toBe(true);
    // Chat-scoped search finds it unique within the first message → stage A with container boost
    expect(result.stage).toBe("A");
    expect(result.container).toBeTruthy();
  });

  it("falls through when chatContext doesn't match", () => {
    document.body.innerHTML = "<p>Just a regular page with some text.</p>";
    const result = locateSnippet({
      text: "some text",
      chatContext: {
        platform: "chatgpt",
        messageId: "nonexistent",
        messageIndex: 99,
      },
    });
    // Should fall through to stage A (unique match)
    expect(result.found).toBe(true);
    expect(result.stage).toBe("A");
  });
});

describe("Stage D: Position offsets", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("finds text by character offsets", () => {
    document.body.innerHTML = "<p>AAA target text BBB</p><p>AAA target text CCC</p>";
    // "target text" appears at offset 4 and offset 24 (approx).
    // If we give the correct offsets for the first occurrence, it should match.
    const result = locateSnippet({
      text: "target text",
      startOffset: 4,
      endOffset: 15,
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("D");
    expect(result.range!.toString()).toBe("target text");
  });

  it("rejects if position content differs too much", () => {
    document.body.innerHTML = "<p>completely different content here</p>";
    const result = locateSnippet({
      text: "target text that does not exist anywhere",
      startOffset: 0,
      endOffset: 39,
    });
    // Position offset content won't match well
    expect(result.stage).not.toBe("D");
  });
});

describe("Stage E: Fingerprint pack", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("finds text via fingerprint when exact match fails", () => {
    // Original text the user selected (long enough for distinct head/mid/tail)
    const original = "The quick brown fox jumps over the lazy dog and some extra padding text to make it longer than sixty characters total";
    const fp = buildFingerprint(original)!;

    // Page has text that is rearranged in the middle but keeps head/mid/tail fragments.
    // The difference is big enough that fuzzy (Jaro-Winkler on same-length window) won't exceed 0.6
    // but the fingerprint head/mid/tail fragments are still present in the normalized text.
    const modified = "The quick brown fox jumps over XXXXX YYYYY ZZZZZ and some extra padding text to make it longer than sixty characters total";
    document.body.innerHTML = `<p>${modified}</p>`;

    const result = locateSnippet({
      text: original,
      fingerprint: fp,
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("E");
  });

  it("falls through when fingerprint fragments not found", () => {
    document.body.innerHTML = "<p>Completely unrelated content.</p>";
    const result = locateSnippet({
      text: "something that was here before but is now gone entirely",
      fingerprint: {
        head: "something that was here before",
        mid: "here before but is now gone",
        tail: "is now gone entirely",
        length: 54,
      },
    });
    expect(result.found).toBe(false);
  });
});

describe("Stage F: Fuzzy match", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("finds near-match text via fuzzy", () => {
    document.body.innerHTML = "<p>The quick brown fox jumps over the lazy dog</p>";
    const result = locateSnippet({
      text: "The quick brown fox jumps over the lazy dOg",
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("F");
  });

  it("fails for completely different text", () => {
    document.body.innerHTML = "<p>Hello world</p>";
    const result = locateSnippet({
      text: "Completely different text with no overlap whatsoever in this document",
    });
    expect(result.found).toBe(false);
  });
});

describe("Full pipeline: stage cascade", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("prefers exact unique (A) over all other stages", () => {
    document.body.innerHTML = "<p>unique snippet text here</p>";
    const result = locateSnippet({
      text: "unique snippet text here",
      prefix: "xxx",
      suffix: "yyy",
      startOffset: 0,
      endOffset: 24,
      fingerprint: buildFingerprint("unique snippet text here"),
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("A");
  });

  it("falls through stages correctly for non-unique text", () => {
    document.body.innerHTML = `
      <p>PREFIX1 target text SUFFIX1</p>
      <p>PREFIX2 target text SUFFIX2</p>
    `;
    // Non-unique → skip A
    // Prefix matches second occurrence → stage B
    const result = locateSnippet({
      text: "target text",
      prefix: "PREFIX2 ",
      suffix: " SUFFIX2",
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("B");
  });

  it("handles undefined anchor gracefully", () => {
    const result = locateSnippet(undefined);
    expect(result.found).toBe(false);
    expect(result.reason).toBe("No anchor provided");
  });

  it("handles empty text gracefully", () => {
    const result = locateSnippet({ text: "" });
    expect(result.found).toBe(false);
    expect(result.reason).toBe("Anchor has no text");
  });
});

describe("Chat context detection (DOM inspection)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("simpleTurnHash produces consistent results", () => {
    const hash1 = simpleTurnHash("Hello, how are you?");
    const hash2 = simpleTurnHash("Hello, how are you?");
    expect(hash1).toBe(hash2);
  });

  it("simpleTurnHash differs for different text", () => {
    const hash1 = simpleTurnHash("Hello");
    const hash2 = simpleTurnHash("World");
    expect(hash1).not.toBe(hash2);
  });
});

describe("Backward compatibility", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("old anchors without fingerprint/chatContext/containerHint still work via stages A-D,F", () => {
    document.body.innerHTML = "<p>Some text that was saved before the upgrade.</p>";
    const result = locateSnippet({
      text: "saved before the upgrade",
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("A");
  });

  it("old anchor with only prefix/suffix works", () => {
    document.body.innerHTML = "<p>AAA target BBB</p><p>CCC target DDD</p>";
    const result = locateSnippet({
      text: "target",
      prefix: "CCC ",
      suffix: " DDD",
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("B");
  });
});

// ── Confidence scoring ──

describe("Confidence scoring", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("returns confidence 1.0 for exact unique match (stage A)", () => {
    document.body.innerHTML = "<p>unique text here</p>";
    const result = locateSnippet({ text: "unique text here" });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("A");
    expect(result.confidence).toBe(1.0);
  });

  it("returns confidence 0.95 for prefix+suffix match (stage B, score 2)", () => {
    document.body.innerHTML = "<p>AAA target BBB</p><p>CCC target DDD</p>";
    const result = locateSnippet({
      text: "target",
      prefix: "CCC ",
      suffix: " DDD",
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("B");
    expect(result.confidence).toBe(0.95);
  });

  it("returns confidence 0.80 for prefix-only match (stage B, score 1)", () => {
    document.body.innerHTML = "<p>AAA target BBB</p><p>CCC target DDD</p>";
    const result = locateSnippet({
      text: "target",
      prefix: "CCC ",
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("B");
    expect(result.confidence).toBe(0.80);
  });

  it("returns low confidence for fuzzy match (stage F)", () => {
    document.body.innerHTML = "<p>The quick brown fox jumps over the lazy dog</p>";
    const result = locateSnippet({
      text: "The quick brown fox jumps over the lazy dOg",
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("F");
    // Fuzzy confidence = similarity * 0.7, should be < 0.85
    expect(result.confidence).toBeLessThan(0.85);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns confidence 0 when not found", () => {
    document.body.innerHTML = "<p>Hello world</p>";
    const result = locateSnippet({
      text: "Completely different text with no overlap whatsoever in this document",
    });
    expect(result.found).toBe(false);
    expect(result.confidence).toBe(0);
  });
});

// ── Container-scoped search ──

describe("Container-scoped search", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("finds text inside container via cssPath", () => {
    document.body.innerHTML = `
      <article id="main-article">
        <p>The target text is here.</p>
      </article>
      <aside><p>The target text is here.</p></aside>
    `;
    // Don't use containerTextSample (jsdom innerText may not work), test pure cssPath scoping
    const result = locateSnippet({
      text: "The target text is here.",
      containerHint: {
        cssPath: "#main-article",
      },
    });
    expect(result.found).toBe(true);
    // Should find via container-scoped A with boost (unique within #main-article)
    expect(result.stage).toBe("A");
    expect(result.confidence).toBeGreaterThanOrEqual(1.0);
    expect(result.container).toBeTruthy();
  });

  it("falls back to global when containerHint cssPath not found", () => {
    document.body.innerHTML = "<p>unique text only here</p>";
    const result = locateSnippet({
      text: "unique text only here",
      containerHint: {
        cssPath: "#nonexistent",
      },
    });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("A");
    expect(result.confidence).toBe(1.0);
  });

  it("falls back to global when container text sample doesn't match", () => {
    document.body.innerHTML = `
      <article id="art1">
        <p>Completely different content now.</p>
        <p>unique target text</p>
      </article>
    `;
    const result = locateSnippet({
      text: "unique target text",
      containerHint: {
        cssPath: "#art1",
        containerTextSample: "this was the old content that no longer matches at all",
      },
    });
    // Container verification fails (similarity < 0.6), falls back to global
    expect(result.found).toBe(true);
    expect(result.stage).toBe("A");
  });
});

// ── DOM stabilization gate ──

describe("waitForDomStable (inline re-implementation)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  // Re-implement a simplified version for testing the concept
  function waitForDomStable(root: Element, stableMs: number, maxWaitMs: number): Promise<void> {
    return new Promise((resolve) => {
      let lastChildCount = root.childElementCount;
      let stableTimer: ReturnType<typeof setTimeout> | null = null;

      const checkStable = () => {
        const currentCount = root.childElementCount;
        if (currentCount === lastChildCount) {
          resolve();
          observer.disconnect();
          return;
        }
        lastChildCount = currentCount;
        stableTimer = setTimeout(checkStable, stableMs);
      };

      const observer = new MutationObserver(() => {
        if (stableTimer) clearTimeout(stableTimer);
        stableTimer = setTimeout(checkStable, stableMs);
      });

      observer.observe(root, { childList: true, subtree: true });
      stableTimer = setTimeout(checkStable, stableMs);

      setTimeout(() => {
        observer.disconnect();
        if (stableTimer) clearTimeout(stableTimer);
        resolve();
      }, maxWaitMs);
    });
  }

  it("resolves when DOM is already stable", async () => {
    document.body.innerHTML = "<div id='root'><p>Stable</p></div>";
    const root = document.getElementById("root")!;
    await waitForDomStable(root, 50, 2000);
    expect(true).toBe(true);
  });

  it("resolves after maxWaitMs even if DOM keeps changing", async () => {
    document.body.innerHTML = "<div id='root'></div>";
    const root = document.getElementById("root")!;
    const interval = setInterval(() => {
      root.appendChild(document.createElement("p"));
    }, 10);

    const start = Date.now();
    await waitForDomStable(root, 200, 500);
    const elapsed = Date.now() - start;
    clearInterval(interval);

    expect(elapsed).toBeLessThan(1000);
  });
});

// ── Chat context container search ──

describe("Chat context container search (confidence)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("finds text scoped to chat message with confidence boost", () => {
    document.body.innerHTML = `
      <div data-message-id="msg-1"><p>Hello there friend</p></div>
      <div data-message-id="msg-2"><p>Hello there friend</p><p>More text</p></div>
    `;
    const result = locateSnippet({
      text: "Hello there friend",
      chatContext: {
        platform: "chatgpt",
        messageId: "msg-1",
        messageIndex: 0,
        role: "user",
      },
    });
    expect(result.found).toBe(true);
    // Found in container-scoped search with boost (unique inside msg-1)
    expect(result.confidence).toBeGreaterThanOrEqual(1.0);
    expect(result.container).toBeTruthy();
  });
});

// ── Shadow DOM fallback ──

describe("Shadow DOM fallback (stage G)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("finds text inside shadow root when regular search fails", () => {
    // Text only exists inside a shadow root — regular walkTextNodes won't find it
    document.body.innerHTML = "<div id='host'></div>";
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<span>Shadow secret text</span>";

    const result = locateSnippet({ text: "Shadow secret text" });
    expect(result.found).toBe(true);
    expect(result.stage).toBe("G-exact");
    expect(result.confidence).toBe(0.90);
  });

  it("without shadow roots, behaves same as regular search", () => {
    document.body.innerHTML = "<p>Normal visible text</p>";
    const result = locateSnippet({ text: "Normal visible text" });
    expect(result.found).toBe(true);
    // Should find via regular stage A (before reaching stage G)
    expect(result.stage).toBe("A");
  });
});

// ── ZP_GET_SELECTION_PAYLOAD handler logic ──

describe("ZP_GET_SELECTION_PAYLOAD handler logic", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("returns hasSelection=true with selectedText when selection exists", () => {
    document.body.innerHTML = "<p>Hello world of testing</p>";
    // Simulate a selection
    const range = document.createRange();
    const textNode = document.body.querySelector("p")!.firstChild!;
    range.setStart(textNode, 0);
    range.setEnd(textNode, 11); // "Hello world"
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Simulate the handler logic
    const selObj = window.getSelection();
    const hasSelection = selObj !== null && selObj.toString().trim().length > 0;
    expect(hasSelection).toBe(true);
    expect(selObj!.toString().trim()).toBe("Hello world");
  });

  it("returns hasSelection=false when no selection", () => {
    document.body.innerHTML = "<p>Some text</p>";
    const sel = window.getSelection()!;
    sel.removeAllRanges();

    const hasSelection = sel.toString().trim().length > 0;
    expect(hasSelection).toBe(false);
  });

  it("returns hasSelection=false when selection is collapsed (empty)", () => {
    document.body.innerHTML = "<p>Some text</p>";
    const range = document.createRange();
    const textNode = document.body.querySelector("p")!.firstChild!;
    range.setStart(textNode, 3);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const hasSelection = sel.toString().trim().length > 0;
    expect(hasSelection).toBe(false);
  });
});
