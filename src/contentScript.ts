/**
 * Content script for snippet anchoring.
 * Handles capturing text anchors and highlighting snippets.
 * 6-stage cascade: exact → prefix/suffix → chat structural → position → fingerprint → fuzzy
 */

import {
  computeTextOffsets,
  getPrefix,
  getSuffix,
  walkTextNodes,
  rangeFromOffsets,
  jaroWinklerSimilarity,
  normalizedSimilarity,
  createRangeFromMatch,
  escapeRegex,
  prefixMatches,
  suffixMatches,
  normalizeText,
  buildNormalizedDocText,
  docTextToRange,
  buildCssPath,
  computeOffsetsInContainer,
  walkTextNodesShadow,
} from "./core/anchor";
import {
  getYouTubeVideoId,
  normalizeYouTubeCanonicalUrl,
  parseYouTubeTimeToSec,
  formatSecToLabel,
  buildYouTubeOpenUrl,
} from "./core/youtube";
import type { YouTubeCaptureResult } from "./core/youtube";
import { getPrefs, type Prefs } from "./core/storage/prefs";

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
    conversationTitle?: string;
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
    githubLineNumber?: number;
    isCodeViewer?: boolean;
  };
  repairedAt?: number;
}

const FUZZY_SIMILARITY_MIN = 0.5;
const PREFIX_SUFFIX_LENGTH = 50;
const FINGERPRINT_FRAG_LENGTH = 30;
let highlightDurationMs = 3000;
const MUTATION_DEBOUNCE_MS = 200;
const INITIAL_DELAY_MS = 100;

// ── Fingerprint helpers ──

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

// ── AI chat context detection ──

interface ChatDetection {
  platform: "chatgpt" | "claude" | "unknown";
  conversationId?: string;
  conversationTitle?: string;
  messageIndex?: number;
  role?: "user" | "assistant";
  messageId?: string;
  turnHash?: string;
  startOffsetInMessage?: number;
  endOffsetInMessage?: number;
}

function simpleTurnHash(text: string): string {
  // Simple hash: take first 100 chars normalized, compute a basic numeric hash
  const sample = normalizeText(text.slice(0, 100));
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function extractConversationId(): string | undefined {
  try {
    const path = window.location.pathname;
    // ChatGPT: /c/<id> or /g/<id>/c/<id>
    const chatgptMatch = path.match(/\/c\/([a-zA-Z0-9-]+)/);
    if (chatgptMatch) return chatgptMatch[1];
    // Claude: /chat/<id>
    const claudeMatch = path.match(/\/chat\/([a-zA-Z0-9-]+)/);
    if (claudeMatch) return claudeMatch[1];
  } catch {
    // ignore
  }
  return undefined;
}

function extractConversationTitle(): string | undefined {
  const title = document.title?.trim();
  if (!title) return undefined;
  const cleaned = title
    .replace(/\s*[-\u2013\u2014|]\s*(ChatGPT|Claude)$/i, "")
    .trim();
  return cleaned && cleaned !== "ChatGPT" && cleaned !== "Claude" ? cleaned : undefined;
}

function detectChatContext(range: Range): ChatDetection | null {
  const container = range.commonAncestorContainer;
  const el = container.nodeType === Node.ELEMENT_NODE
    ? container as Element
    : container.parentElement;
  if (!el) return null;

  const conversationId = extractConversationId();
  const conversationTitle = extractConversationTitle();

  // ChatGPT: messages have data-message-id and data-message-author-role
  const chatgptMsg = el.closest("[data-message-id]")
    ?? el.closest("article[data-message-author-role]")
    ?? el.closest("[data-message-author-role]");
  if (chatgptMsg) {
    const selector = chatgptMsg.hasAttribute("data-message-id")
      ? "[data-message-id]" : "[data-message-author-role]";
    const allMessages = document.querySelectorAll(selector);
    const messageIndex = Array.from(allMessages).indexOf(chatgptMsg);
    const role = chatgptMsg.getAttribute("data-message-author-role");
    const offsets = computeOffsetsInContainer(range, chatgptMsg as Element);
    return {
      platform: "chatgpt",
      conversationId,
      conversationTitle,
      messageIndex: messageIndex >= 0 ? messageIndex : undefined,
      role: role === "user" || role === "assistant" ? role : undefined,
      messageId: chatgptMsg.getAttribute("data-message-id") ?? undefined,
      turnHash: simpleTurnHash(chatgptMsg.textContent ?? ""),
      startOffsetInMessage: offsets.start,
      endOffsetInMessage: offsets.end,
    };
  }

  // Claude: messages with data-testid containing "chat-message"
  const claudeMsg = el.closest("[data-testid*='chat-message']");
  if (claudeMsg) {
    const allMessages = document.querySelectorAll("[data-testid*='chat-message']");
    const messageIndex = Array.from(allMessages).indexOf(claudeMsg);
    const testId = claudeMsg.getAttribute("data-testid") ?? "";
    const role = testId.includes("human") ? "user" : testId.includes("assistant") ? "assistant" : undefined;
    const offsets = computeOffsetsInContainer(range, claudeMsg as Element);
    return {
      platform: "claude",
      conversationId,
      conversationTitle,
      messageIndex: messageIndex >= 0 ? messageIndex : undefined,
      role,
      turnHash: simpleTurnHash(claudeMsg.textContent ?? ""),
      startOffsetInMessage: offsets.start,
      endOffsetInMessage: offsets.end,
    };
  }

  // Unknown: look for common chat message patterns
  const genericMsg = el.closest("[class*='message'], [class*='Message'], [role='row'], [data-role]");
  if (genericMsg) {
    const selector = genericMsg.tagName + (genericMsg.className ? "." + genericMsg.className.split(/\s+/)[0] : "");
    const allMessages = document.querySelectorAll(selector);
    const messageIndex = Array.from(allMessages).indexOf(genericMsg);
    const dataRole = genericMsg.getAttribute("data-role");
    const role = dataRole === "user" || dataRole === "assistant" ? dataRole : undefined;
    const offsets = computeOffsetsInContainer(range, genericMsg as Element);
    return {
      platform: "unknown",
      conversationId,
      conversationTitle,
      messageIndex: messageIndex >= 0 ? messageIndex : undefined,
      role,
      turnHash: simpleTurnHash(genericMsg.textContent ?? ""),
      startOffsetInMessage: offsets.start,
      endOffsetInMessage: offsets.end,
    };
  }

  return null;
}

// ── Container hint capture ──

const CONTAINER_SELECTORS = "article, main, section, [data-message-id], [data-testid*='chat-message']";
const CONTAINER_TEXT_SAMPLE_LENGTH = 120;

function captureContainerHint(range: Range): SnippetAnchor["containerHint"] | null {
  const ancestor = range.commonAncestorContainer;
  const el = ancestor.nodeType === Node.ELEMENT_NODE
    ? ancestor as Element
    : ancestor.parentElement;
  if (!el) return null;

  // Walk up to find a stable container
  const container = el.closest(CONTAINER_SELECTORS);
  if (!container || container === document.body) return null;

  const cssPath = buildCssPath(container);
  const containerTextSample = normalizeText(
    (container as HTMLElement).innerText?.slice(0, CONTAINER_TEXT_SAMPLE_LENGTH) ?? ""
  ) || undefined;

  // GitHub blob: capture the starting line number so the virtual renderer
  // can be scrolled to the right position before text matching runs.
  let githubLineNumber: number | undefined;
  if (
    window.location.hostname === "github.com" &&
    window.location.pathname.includes("/blob/")
  ) {
    let node: Element | null =
      ancestor.nodeType === Node.ELEMENT_NODE
        ? (ancestor as Element)
        : ancestor.parentElement;
    while (node && node !== document.body) {
      // GitHub uses id="L42" on line-number elements and id="LC42" on code
      // elements (both new React viewer and old table viewer). Either matches.
      const lineEl = node.closest("[id^='L']") as HTMLElement | null;
      if (lineEl?.id) {
        const m = lineEl.id.match(/^LC?(\d+)$/);
        if (m) {
          githubLineNumber = parseInt(m[1], 10);
          break;
        }
      }
      node = node.parentElement;
    }
  }

  // Detect code viewer pages at save time so navigate-time can skip DOM matching.
  // URL patterns cover known sites; DOM signatures catch self-hosted editors
  // (Gitea, Codeberg, self-hosted GitLab) using Monaco or CodeMirror.
  let isCodeViewer = false;
  try {
    const { hostname, pathname } = window.location;
    const host = hostname.replace(/^www\./, "");
    if ((host === "github.com" || host === "gitlab.com") && pathname.includes("/blob/")) {
      isCodeViewer = true;
    } else if (host === "github.dev" || host === "vscode.dev") {
      isCodeViewer = true;
    } else if (
      (document.querySelector(".view-lines") ||
        document.querySelector(".cm-editor") ||
        document.querySelector(".CodeMirror")) &&
      (document.querySelector("[id^='L']") ||
        document.querySelector(".blob-num") ||
        document.querySelector(".diff-line-num"))
    ) {
      isCodeViewer = true;
    }
  } catch { /* ignore */ }

  return {
    cssPath: cssPath || undefined,
    containerTextSample,
    ...(githubLineNumber !== undefined ? { githubLineNumber } : {}),
    ...(isCodeViewer ? { isCodeViewer: true } : {}),
  };
}

// ── Capture ──

function captureAnchor(): SnippetAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    console.warn("ZP: No selection found");
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = range.toString();

  if (!text) {
    console.warn("ZP: Selection is empty");
    return null;
  }

  try {
    const { startOffset, endOffset } = computeTextOffsets(range);
    const prefix = getPrefix(range, PREFIX_SUFFIX_LENGTH);
    const suffix = getSuffix(range, PREFIX_SUFFIX_LENGTH);
    const fingerprint = buildFingerprint(text);
    const chatContext = detectChatContext(range) ?? undefined;

    if (chatContext) {
    }

    // Container hint: find a stable ancestor container
    const containerHint = captureContainerHint(range) ?? undefined;
    if (containerHint) {
    }

    return {
      text,
      prefix: prefix || undefined,
      suffix: suffix || undefined,
      startOffset,
      endOffset,
      capturedAt: Date.now(),
      fingerprint,
      chatContext,
      containerHint,
    };
  } catch (err) {
    console.error("ZP: captureAnchor error", err);
    return null;
  }
}

// ── Highlight result type ──

interface HighlightResult {
  found: boolean;
  confidence: number;   // 0..1
  stage?: string;       // which stage matched
  range?: Range;        // the matched range
  container?: Element;  // best container found (for fallback scroll)
  reason?: string;
}

// ── Highlight helpers ──

function findByExactMatch(text: string, root: Node = document.body): Range | null {
  const regex = new RegExp(escapeRegex(text));

  // Fast path: match within a single text node
  for (const node of walkTextNodes(root)) {
    const nodeText = node.textContent ?? "";
    const match = nodeText.match(regex);

    if (match) {
      return createRangeFromMatch(node, match);
    }
  }

  // Cross-node fallback: search in concatenated textContent
  const fullText = root.textContent ?? "";
  const match = fullText.match(regex);
  if (match && match.index != null) {
    return rangeFromOffsets(root, match.index, match.index + text.length);
  }

  return null;
}

function findAllMatches(text: string, root: Node = document.body): Array<{ range: Range; node: Text; index: number }> {
  const matches: Array<{ range: Range; node: Text; index: number }> = [];
  const regex = new RegExp(escapeRegex(text), "g");

  // Fast path: single text node matches
  for (const node of walkTextNodes(root)) {
    const nodeText = node.textContent ?? "";
    let match;

    while ((match = regex.exec(nodeText)) !== null) {
      matches.push({
        range: createRangeFromMatch(node, match),
        node,
        index: match.index,
      });
    }
  }

  // Cross-node fallback: search in concatenated textContent
  if (matches.length === 0) {
    const fullText = root.textContent ?? "";
    const regex2 = new RegExp(escapeRegex(text), "g");
    let match;
    while ((match = regex2.exec(fullText)) !== null) {
      const range = rangeFromOffsets(root, match.index, match.index + text.length);
      if (range) {
        const startNode = range.startContainer;
        matches.push({
          range,
          node: (startNode.nodeType === Node.TEXT_NODE ? startNode : startNode) as Text,
          index: match.index,
        });
      }
    }
  }

  return matches;
}

function scoreByContext(
  range: Range,
  expectedPrefix?: string,
  expectedSuffix?: string,
): number {
  let score = 0;

  if (expectedPrefix) {
    score += prefixMatches(range, expectedPrefix) ? 1 : 0;
  }

  if (expectedSuffix) {
    score += suffixMatches(range, expectedSuffix) ? 1 : 0;
  }

  return score;
}

function isUnique(_range: Range, text: string, root: Node = document.body): boolean {
  const matches = findAllMatches(text, root);
  return matches.length === 1;
}

function findBestFuzzyMatch(
  text: string,
  root: Node = document.body,
): { range: Range; similarity: number } | null {
  let bestMatch: { range: Range; similarity: number } | null = null;

  // Fast path: single text node sliding window
  for (const node of walkTextNodes(root)) {
    const nodeText = node.textContent ?? "";

    for (let i = 0; i <= nodeText.length - text.length; i++) {
      const candidate = nodeText.substring(i, i + text.length);
      const similarity = jaroWinklerSimilarity(text, candidate);

      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = {
          range: createRangeFromMatch(node, { 0: candidate, index: i }),
          similarity,
        };
      }
    }
  }

  // Skip cross-node if single-node already found a strong match
  if (bestMatch && bestMatch.similarity >= 0.85) return bestMatch;

  // Cross-node fallback: use normalized doc text (O(n) substring search)
  // instead of expensive O(n*m) sliding-window Jaro-Winkler
  const docMap = buildNormalizedDocText(root);
  const normText = normalizeText(text);
  const idx = docMap.normalized.indexOf(normText);
  if (idx !== -1) {
    const range = docTextToRange(docMap, idx, idx + normText.length);
    if (range) {
      const similarity = normalizedSimilarity(range.toString(), text);
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { range, similarity };
      }
    }
  }

  return bestMatch && bestMatch.similarity > 0 ? bestMatch : null;
}

// ── Stage C: AI chat structural anchor ──

function findByChatContext(
  text: string,
  chatContext: NonNullable<SnippetAnchor["chatContext"]>,
): Range | null {
  // Try to find the specific message container
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

  // Generic fallback: try by messageIndex with common selectors
  if (!messageEl && chatContext.messageIndex != null) {
    const selectors = [
      "[class*='message']", "[class*='Message']", "[role='row']", "[data-role]",
    ];
    for (const sel of selectors) {
      const all = document.querySelectorAll(sel);
      if (chatContext.messageIndex < all.length) {
        messageEl = all[chatContext.messageIndex];
        break;
      }
    }
  }

  if (!messageEl) return null;

  // Verify via turnHash if available
  if (chatContext.turnHash) {
    const hash = simpleTurnHash(messageEl.textContent ?? "");
    if (hash !== chatContext.turnHash) {
      // Still try — the text itself might match
    }
  }

  // Search within the message container for the text
  const regex = new RegExp(escapeRegex(text));

  // Fast path: single text node
  for (const node of walkTextNodes(messageEl)) {
    const nodeText = node.textContent ?? "";
    const match = nodeText.match(regex);
    if (match) {
      return createRangeFromMatch(node, match);
    }
  }

  // Cross-node fallback within message container
  const fullText = messageEl.textContent ?? "";
  const match = fullText.match(regex);
  if (match && match.index != null) {
    return rangeFromOffsets(messageEl, match.index, match.index + text.length);
  }

  return null;
}

// ── Stage E: Fingerprint pack fallback ──

function findByFingerprint(
  fingerprint: NonNullable<SnippetAnchor["fingerprint"]>,
  root: Node = document.body,
): Range | null {
  const docMap = buildNormalizedDocText(root);
  const { normalized } = docMap;

  const headIdx = normalized.indexOf(fingerprint.head);
  if (headIdx === -1) return null;

  // Search for a region where head, mid, and tail all appear within expected length * 1.5
  const searchWindow = Math.ceil(fingerprint.length * 1.5);
  const regionEnd = Math.min(headIdx + searchWindow, normalized.length);
  const region = normalized.slice(headIdx, regionEnd);

  const midIdx = region.indexOf(fingerprint.mid);
  const tailIdx = region.indexOf(fingerprint.tail);

  if (midIdx === -1 || tailIdx === -1) return null;

  // The region spans from headIdx to roughly headIdx + tailIdx + tail.length
  const normStart = headIdx;
  const normEnd = Math.min(
    headIdx + tailIdx + fingerprint.tail.length,
    normalized.length,
  );

  return docTextToRange(docMap, normStart, normEnd);
}

// ── Confidence thresholds ──

const CONFIDENCE_HIGH = 0.75;
const CONFIDENCE_LOW = 0.5;

// ── Run stages A-F scoped to a given root node ──

function runStages(anchor: SnippetAnchor, root: Node, containerBoost: number): HighlightResult | null {
  let range: Range | null = null;

  // STEP A: Exact Match (unique)
  range = findByExactMatch(anchor.text, root);
  if (range && isUnique(range, anchor.text, root)) {
    return { found: true, confidence: Math.min(1.0, 1.0 + containerBoost), stage: "A", range };
  }

  // STEP B: Prefix/Suffix Disambiguation
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

  // STEP C: AI Chat Structural Anchor
  if (anchor.chatContext) {
    const chatRange = findByChatContext(anchor.text, anchor.chatContext);
    if (chatRange) {
      return { found: true, confidence: Math.min(1.0, 0.90 + containerBoost), stage: "C", range: chatRange };
    }
  }

  // STEP D: Position Selector
  if (anchor.startOffset != null && anchor.endOffset != null) {
    const posRange = rangeFromOffsets(root, anchor.startOffset, anchor.endOffset);
    if (posRange) {
      const similarity = normalizedSimilarity(posRange.toString(), anchor.text);
      if (similarity > 0.55) {
        return { found: true, confidence: Math.min(1.0, similarity + containerBoost), stage: "D", range: posRange };
      }
    }
  }

  // STEP E: Fingerprint Pack Fallback
  if (anchor.fingerprint) {
    const fpRange = findByFingerprint(anchor.fingerprint, root);
    if (fpRange) {
      const similarity = normalizedSimilarity(fpRange.toString(), anchor.text);
      if (similarity > 0.4) {
        const baseConf = 0.5 + similarity * 0.3;
        return { found: true, confidence: Math.min(1.0, baseConf + containerBoost), stage: "E", range: fpRange };
      }
    }
  }

  // STEP F: Fuzzy Match
  const fuzzyMatch = findBestFuzzyMatch(anchor.text, root);
  if (fuzzyMatch && fuzzyMatch.similarity > FUZZY_SIMILARITY_MIN) {
    const baseConf = fuzzyMatch.similarity * 0.7;
    return { found: true, confidence: Math.min(1.0, baseConf + containerBoost), stage: "F", range: fuzzyMatch.range };
  }

  return null;
}

// ── Shadow DOM search helpers ──

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

// ── 6-stage highlight pipeline with confidence + container-first ──

function highlightSnippet(anchor: SnippetAnchor | undefined): HighlightResult {
  if (!anchor) {
    const reason = "No anchor provided";
    console.warn("ZP:", reason);
    return { found: false, confidence: 0, reason };
  }

  if (!anchor.text) {
    const reason = "Anchor has no text";
    console.warn("ZP:", reason);
    return { found: false, confidence: 0, reason };
  }

  // 1. Container-scoped search (if containerHint exists)
  if (anchor.containerHint?.cssPath) {
    const container = document.querySelector(anchor.containerHint.cssPath);
    if (container) {
      // Verify container via text sample similarity
      let containerVerified = true;
      if (anchor.containerHint.containerTextSample) {
        const currentSample = normalizeText(
          (container as HTMLElement).innerText?.slice(0, CONTAINER_TEXT_SAMPLE_LENGTH) ?? ""
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

  // 2. Chat context container search (if chatContext exists and container search didn't succeed)
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

  // 3. Global scan (stages A-F on document.body)
  const globalResult = runStages(anchor, document.body, 0);
  if (globalResult) {
    return globalResult;
  }

  // 4. Stage G: Shadow DOM fallback
  const shadowExact = findByExactMatchShadow(anchor.text);
  if (shadowExact) {
    return { found: true, confidence: 0.90, stage: "G-exact", range: shadowExact };
  }

  const shadowFuzzy = findBestFuzzyMatchShadow(anchor.text);
  if (shadowFuzzy && shadowFuzzy.similarity > FUZZY_SIMILARITY_MIN) {
    const conf = shadowFuzzy.similarity * 0.7;
    return { found: true, confidence: conf, stage: "G-fuzzy", range: shadowFuzzy.range };
  }

  const reason = "All stages failed to locate text";
  console.error("✗ ZP:", reason);
  console.error("  Expected text fragment:", anchor.text.substring(0, 50));
  return { found: false, confidence: 0, reason };
}

// ── Low-confidence notice (content script DOM toast) ──

function showLowConfidenceNotice(): void {
  const existing = document.getElementById("zp-low-confidence-notice");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "zp-low-confidence-notice";
  toast.textContent = "Pinned text may have moved. Showing closest location.";
  toast.style.cssText = [
    "position:fixed", "bottom:20px", "right:20px", "z-index:2147483647",
    "background:rgba(30,30,30,0.9)", "color:#fff", "padding:12px 20px",
    "border-radius:8px", "font-size:14px", "font-family:system-ui,sans-serif",
    "box-shadow:0 4px 12px rgba(0,0,0,0.3)", "pointer-events:none",
    "opacity:0", "transition:opacity 0.3s ease",
  ].join(";");
  document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => { toast.style.opacity = "1"; });

  // Auto-remove after 3s
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Floating snippet card for AI chat pages ──

let snippetDismissMs = 12000;

// Load user prefs and keep in sync with storage changes
getPrefs().then((p: Prefs) => {
  highlightDurationMs = p.highlightDurationMs;
  snippetDismissMs = p.snippetDismissMs;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["zp_prefs"]) {
    const p = changes["zp_prefs"].newValue as Prefs;
    highlightDurationMs = p.highlightDurationMs;
    snippetDismissMs = p.snippetDismissMs;
  }
});
const SNIPPET_CARD_MAX_LENGTH = 400;

const CARD_THEMES = {
  dark: {
    bg: "#1a1a2e",
    text: "#e0e0e0",
    brand: "#a78bfa",
    border: "rgba(139,92,246,0.4)",
    shadow: "rgba(0,0,0,0.4)",
    context: "#999",
    snippetText: "#d4d4d8",
    snippetBg: "rgba(255,255,255,0.05)",
    tip: "#e0e0e0",
    note: "#e0e0e0",
    dismiss: "#888",
  },
  light: {
    bg: "#ffffff",
    text: "#1a1a1a",
    brand: "#7c3aed",
    border: "rgba(139,92,246,0.3)",
    shadow: "rgba(0,0,0,0.12)",
    context: "#666",
    snippetText: "#374151",
    snippetBg: "rgba(0,0,0,0.04)",
    tip: "#1a1a1a",
    note: "#1a1a1a",
    dismiss: "#999",
  },
};

function getSnippetCardTheme(): Promise<typeof CARD_THEMES.dark> {
  return new Promise((resolve) => {
    chrome.storage.local.get("zp_ui_prefs", (items) => {
      const prefs = items["zp_ui_prefs"] as { darkMode?: string } | undefined;
      const pref = prefs?.darkMode ?? "system";
      let isDark: boolean;
      if (pref === "system") {
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      } else {
        isDark = pref === "dark";
      }
      resolve(isDark ? CARD_THEMES.dark : CARD_THEMES.light);
    });
  });
}

async function showSnippetCard(anchor: SnippetAnchor): Promise<void> {
  const existing = document.getElementById("zp-snippet-card");
  if (existing) existing.remove();

  const t = await getSnippetCardTheme();

  const card = document.createElement("div");
  card.id = "zp-snippet-card";

  // Truncate long snippets
  let displayText = anchor.text;
  if (displayText.length > SNIPPET_CARD_MAX_LENGTH) {
    displayText = displayText.slice(0, SNIPPET_CARD_MAX_LENGTH) + "…";
  }

  // Build context line
  const parts: string[] = [];
  if (anchor.chatContext?.platform && anchor.chatContext.platform !== "unknown") {
    parts.push(anchor.chatContext.platform.charAt(0).toUpperCase() + anchor.chatContext.platform.slice(1));
  }
  if (anchor.chatContext?.role) {
    parts.push(anchor.chatContext.role === "assistant" ? "AI response" : "Your prompt");
  }
  if (anchor.chatContext?.conversationTitle) {
    parts.push(`"${anchor.chatContext.conversationTitle}"`);
  }
  const contextLine = parts.length > 0 ? parts.join(" · ") : "";

  // Card container
  card.style.cssText = [
    "position:fixed", "bottom:20px", "right:20px", "z-index:2147483647",
    "max-width:480px", "width:calc(100% - 40px)",
    `background:${t.bg}`, `color:${t.text}`,
    `border:1px solid ${t.border}`, "border-radius:12px",
    "padding:16px", "font-family:system-ui,-apple-system,sans-serif",
    `box-shadow:0 8px 32px ${t.shadow}`, "cursor:default",
    "opacity:0", "transition:opacity 0.3s ease",
  ].join(";");

  // Header with ZeroPin branding + dismiss button
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";

  const brand = document.createElement("span");
  brand.textContent = "📌 ZeroPin";
  brand.style.cssText = `font-size:12px;font-weight:600;color:${t.brand};letter-spacing:0.5px;`;

  const dismiss = document.createElement("button");
  dismiss.textContent = "✕";
  dismiss.style.cssText = [
    "background:none", "border:none", `color:${t.dismiss}`, "cursor:pointer",
    "font-size:16px", "padding:0 4px", "line-height:1",
  ].join(";");
  dismiss.addEventListener("click", () => {
    card.style.opacity = "0";
    setTimeout(() => card.remove(), 300);
  });

  header.appendChild(brand);
  header.appendChild(dismiss);

  // Context line
  if (contextLine) {
    const ctx = document.createElement("div");
    ctx.textContent = contextLine;
    ctx.style.cssText = `font-size:11px;color:${t.context};margin-bottom:8px;`;
    card.appendChild(header);
    card.appendChild(ctx);
  } else {
    card.appendChild(header);
  }

  // Snippet text
  const textEl = document.createElement("div");
  textEl.textContent = displayText;
  textEl.style.cssText = [
    "font-size:13px", "line-height:1.5", `color:${t.snippetText}`,
    `background:${t.snippetBg}`, "border-radius:6px",
    "padding:10px 12px", "max-height:160px", "overflow-y:auto",
    "white-space:pre-wrap", "word-break:break-word",
  ].join(";");
  card.appendChild(textEl);

  // Tip line (platform-aware shortcuts)
  const isMac = /Macintosh|Mac OS/.test(navigator.userAgent);
  const findKey = isMac ? "\u2318F" : "Ctrl+F";
  const pasteKey = isMac ? "\u2318V" : "Ctrl+V";

  const tip = document.createElement("div");
  tip.textContent = `Use ${findKey} to find and ${pasteKey} to paste this text`;
  tip.style.cssText = `font-size:12px;color:${t.tip};margin-top:8px;text-align:right;`;
  card.appendChild(tip);

  // Privacy note (builds confidence for clipboard permission prompt)
  const note = document.createElement("div");
  note.textContent = "ZeroPin copies pinned text to help you search. No data leaves your device.";
  note.style.cssText = `font-size:11px;color:${t.note};margin-top:4px;text-align:right;font-style:italic;`;
  card.appendChild(note);

  document.body.appendChild(card);

  // Fade in
  requestAnimationFrame(() => { card.style.opacity = "1"; });

  // Auto-copy first ~120 chars for Find use
  const copyText = anchor.text.slice(0, 120);
  const onCopied = () => {
    tip.textContent = `Copied to clipboard \u2014 use ${findKey} to find and ${pasteKey} to paste`;
  };
  navigator.clipboard.writeText(copyText).then(onCopied).catch(() => {
    // Fallback: execCommand (works with clipboardWrite manifest permission)
    try {
      const ta = document.createElement("textarea");
      ta.value = copyText;
      ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      if (document.execCommand("copy")) onCopied();
      document.body.removeChild(ta);
    } catch {
      // Both methods failed — keep fallback tip visible
    }
  });

  // Auto-dismiss
  setTimeout(() => {
    if (card.parentNode) {
      card.style.opacity = "0";
      setTimeout(() => card.remove(), 300);
    }
  }, snippetDismissMs);
}

// ── Highlight and scroll ──

function highlightAndScroll(result: HighlightResult): void {
  if (!result.found || !result.range) {
    // No match found — scroll to container if available
    if (result.container) {
      result.container.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    showLowConfidenceNotice();
    return;
  }

  if (result.confidence < CONFIDENCE_LOW) {
    // Low confidence — scroll to best area but show notice
    if (result.container) {
      result.container.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (result.range) {
      const temp = document.createElement("span");
      result.range.insertNode(temp);
      temp.scrollIntoView({ behavior: "smooth", block: "center" });
      temp.remove();
    }
    showLowConfidenceNotice();
    return;
  }

  if (result.confidence < CONFIDENCE_HIGH) {
  }

  try {
    const range = result.range;
    const mark = document.createElement("mark");
    mark.style.backgroundColor = "yellow";
    mark.style.transition = "background 2s ease";
    mark.style.padding = "2px";
    mark.id = "zp-highlight-" + Date.now();

    range.surroundContents(mark);
    mark.scrollIntoView({ behavior: "smooth", block: "center" });

    // Auto-remove after duration
    setTimeout(() => {
      if (mark.parentNode) {
        while (mark.firstChild) {
          mark.parentNode.insertBefore(mark.firstChild, mark);
        }
        mark.parentNode.removeChild(mark);
      }
    }, highlightDurationMs);
  } catch (err) {
    console.error("ZP: highlightAndScroll error", err);
  }
}

// ── YouTube moment capture ───────────────────────────────────────────────────

/** Retry delays in ms. Allows YouTube's SPA to finish mounting the <video>. */
const YT_RETRY_DELAYS_MS = [0, 150, 300, 500, 700];

/**
 * Reads the current playback position from the in-page YouTube player.
 * Fast path: if the URL already has a t= param, use it directly.
 * Otherwise reads video.currentTime with up to 5 attempts.
 * Always resolves (never rejects) — falls back gracefully.
 */
async function captureYouTubeMoment(): Promise<YouTubeCaptureResult> {
  const url = window.location.href;
  const videoId = getYouTubeVideoId(url);
  if (!videoId) {
    return { kind: "fallback", canonicalUrl: url, openUrl: url };
  }

  const canonicalUrl = normalizeYouTubeCanonicalUrl(url)!;

  // Fast path: t= or start= already present in URL
  const urlObj = new URL(url);
  const tParam = urlObj.searchParams.get("t") ?? urlObj.searchParams.get("start");
  if (tParam) {
    const sec = parseYouTubeTimeToSec(tParam);
    if (sec != null && sec >= 2) {
      return {
        kind: "youtube",
        videoId,
        timestampSec: sec,
        timestampLabel: formatSecToLabel(sec),
        canonicalUrl,
        openUrl: buildYouTubeOpenUrl(canonicalUrl, sec),
        captureMethod: "urlParam",
      };
    }
  }

  // Read video element with retries (player may not be mounted yet)
  for (const delay of YT_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise<void>((res) => setTimeout(res, delay));

    const v = document.querySelector<HTMLVideoElement>("video");
    if (!v) continue; // not mounted yet — retry

    // Live streams have no meaningful timestamp
    if (v.duration === Infinity) break;
    if (v.seekable && v.seekable.length === 0) break;

    if (v.readyState < 2) continue; // not enough data yet — retry

    const t = Math.floor(v.currentTime ?? 0);
    if (t >= 2) {
      return {
        kind: "youtube",
        videoId,
        timestampSec: t,
        timestampLabel: formatSecToLabel(t),
        canonicalUrl,
        openUrl: buildYouTubeOpenUrl(canonicalUrl, t),
        captureMethod: "video.currentTime",
      };
    }
    // Video ready but not started (t < 2) — no useful timestamp, don't retry
    break;
  }

  return { kind: "fallback", videoId, canonicalUrl, openUrl: canonicalUrl };
}

// ── In-page save confirmation toast ─────────────────────────────────────────

/**
 * Shows a brief floating toast inside the page.
 * Auto-dismisses after ~2.5 s with a fade transition.
 */
function showSaveConfirmToast(message: string): void {
  const existing = document.getElementById("zp-save-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "zp-save-toast";
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    top: "72px",
    right: "20px",
    zIndex: "2147483647",
    background: "rgba(15,15,15,0.92)",
    color: "#fff",
    padding: "10px 18px",
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "system-ui, sans-serif",
    letterSpacing: "0.01em",
    boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 0.18s ease",
  });
  document.body.appendChild(toast);

  requestAnimationFrame(() => requestAnimationFrame(() => { toast.style.opacity = "1"; }));
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

// ── Message listener ──

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  // Async handler — keep channel open with return true
  if (request.type === "ZP_CAPTURE_YT_MOMENT") {
    captureYouTubeMoment()
      .then(sendResponse)
      .catch(() => {
        const url = window.location.href;
        sendResponse({ kind: "fallback", canonicalUrl: url, openUrl: url });
      });
    return true;
  }

  try {

    if (request.type === "ZP_CAPTURE_ANCHOR") {
      const anchor = captureAnchor();
      sendResponse({ anchor, success: true });
    } else if (request.type === "ZP_GET_SELECTION_PAYLOAD") {
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) {
        const selectedText = sel.toString().trim();
        const anchor = captureAnchor();
        sendResponse({ hasSelection: true, selectedText, anchor });
      } else {
        sendResponse({ hasSelection: false });
      }
    } else if (request.type === "ZP_HIGHLIGHT_SNIPPET") {
      const result = highlightSnippet(request.anchor);
      if (result.found) highlightAndScroll(result);
      sendResponse({ success: result.found, confidence: result.confidence, stage: result.stage, reason: result.reason });
    } else if (request.type === "ZP_SHOW_SAVE_CONFIRM") {
      showSaveConfirmToast(request.message as string);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, reason: "Unknown message type" });
    }
  } catch (err) {
    console.error("ZP: Message listener error", err);
    sendResponse({ success: false, reason: String(err) });
  }
});

// ── DOM stabilization gate ──

function waitForDomStable(
  rootSelector: string,
  stableMs = 700,
  maxWaitMs = 8000,
): Promise<void> {
  return new Promise((resolve) => {
    const root = document.querySelector(rootSelector);
    if (!root) {
      resolve();
      return;
    }

    let lastChildCount = root.childElementCount;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;

    const checkStable = () => {
      const currentCount = root.childElementCount;
      if (currentCount === lastChildCount) {
        // Child count stable — wait 2 animation frames then resolve
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
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

    // Start initial stable check
    stableTimer = setTimeout(checkStable, stableMs);

    // Max wait timeout
    setTimeout(() => {
      observer.disconnect();
      if (stableTimer) clearTimeout(stableTimer);
      resolve();
    }, maxWaitMs);
  });
}

// ── AI chat domain detection ──

const AI_CHAT_DOMAINS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "poe.com",
  "perplexity.ai",
  "grok.com",
  "x.com",
  "deepseek.com",
  "chat.deepseek.com",
  "huggingface.co",
  "chat.mistral.ai",
]);

function isAiChatDomain(): boolean {
  try {
    return AI_CHAT_DOMAINS.has(window.location.hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

/** URL-based fallback for pins saved before the isCodeViewer flag existed.
 *  Catches known code file viewer pages where hash-nav triggers SPA re-renders. */
function isCodeViewerPage(): boolean {
  try {
    const { hostname, pathname } = window.location;
    const host = hostname.replace(/^www\./, "");
    if ((host === "github.com" || host === "gitlab.com") && pathname.includes("/blob/")) return true;
    if (host === "github.dev" || host === "vscode.dev") return true;
    return false;
  } catch {
    return false;
  }
}

// ── Chat page detection for stabilization ──

function isChatPage(anchor: SnippetAnchor): boolean {
  return !!(
    anchor.chatContext &&
    (anchor.chatContext.platform === "chatgpt" || anchor.chatContext.platform === "claude")
  );
}

function getChatRootSelector(anchor: SnippetAnchor): string {
  if (anchor.chatContext?.platform === "chatgpt") return "main";
  if (anchor.chatContext?.platform === "claude") return "main";
  return "body";
}

// ── Anchor resolution + repair ──

const REPAIR_STAGES = new Set(["D", "E", "F", "G-exact", "G-fuzzy"]);

function sendResolution(result: HighlightResult, _anchor: SnippetAnchor, bookmarkId?: string): void {
  if (!bookmarkId) return;
  try {
    const payload: Record<string, unknown> = {
      type: "ZP_ANCHOR_RESOLVED",
      bookmarkId,
      confidence: result.confidence,
      stage: result.stage,
    };

    // Include repair data for non-exact stages
    if (result.range && result.stage && REPAIR_STAGES.has(result.stage)) {
      const range = result.range;
      const offsets = computeTextOffsets(range);
      payload.repair = {
        prefix: getPrefix(range, PREFIX_SUFFIX_LENGTH) || undefined,
        suffix: getSuffix(range, PREFIX_SUFFIX_LENGTH) || undefined,
        startOffset: offsets.startOffset,
        endOffset: offsets.endOffset,
      };
    }

    chrome.runtime.sendMessage(payload);
  } catch (err) {
    console.warn("ZP: sendResolution failed", err);
  }
}

// ── Process highlight request with DOM stabilization ──

const HIGHLIGHT_RETRY_TIMEOUT_MS = 10_000;

function processHighlightRequest(anchor: SnippetAnchor, bookmarkId?: string): void {
  // Recover from the known wrapper bug for previously-saved bookmarks
  const maybeWrapped = anchor as unknown as { anchor?: SnippetAnchor };
  if (!anchor.text && maybeWrapped.anchor?.text) {
    anchor = maybeWrapped.anchor;
  }

  // AI chat pages: show floating snippet card instead of DOM search
  // (virtual scrolling makes DOM text search unreliable on chat platforms)
  if (isAiChatDomain()) {
    showSnippetCard(anchor);
    chrome.storage.local.remove("ZP_HIGHLIGHT_REQUEST");
    return;
  }

  // Code viewer pages (GitHub/GitLab blob, github.dev, vscode.dev, and any
  // Monaco/CodeMirror site detected at save time): syntax highlighting fragments
  // text across spans and hash-nav triggers expensive SPA re-renders.
  // Show snippet card (same pattern as AI chat) — user uses Ctrl+F + Ctrl+V.
  if (anchor.containerHint?.isCodeViewer || isCodeViewerPage()) {
    showSnippetCard(anchor);
    chrome.storage.local.remove("ZP_HIGHLIGHT_REQUEST");
    return;
  }

  const doHighlight = () => {
    const result = highlightSnippet(anchor);
    if (result.found) {
      highlightAndScroll(result);
      sendResolution(result, anchor, bookmarkId);
      chrome.storage.local.remove("ZP_HIGHLIGHT_REQUEST");
      return;
    }

    // Text not in DOM yet (dynamic pages). Retry via debounced MutationObserver.
    startMutationRetry(anchor, bookmarkId);
  };

  // Use DOM stabilization gate for chat pages, simple delay for others
  if (isChatPage(anchor)) {
    waitForDomStable(getChatRootSelector(anchor)).then(doHighlight);
  } else {
    setTimeout(doHighlight, INITIAL_DELAY_MS);
  }
}

function startMutationRetry(anchor: SnippetAnchor, bookmarkId?: string): void {
  let done = false;
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;

  const finish = (found: boolean) => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(timeoutHandle);
    if (debounceHandle) clearTimeout(debounceHandle);
    chrome.storage.local.remove("ZP_HIGHLIGHT_REQUEST");
    if (!found) {
      console.warn("ZP: Gave up waiting for snippet to appear in DOM");
    }
  };

  const observer = new MutationObserver(() => {
    if (done) return;
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      if (done) return;
      try {
        const retry = highlightSnippet(anchor);
        if (retry.found) {
          highlightAndScroll(retry);
          sendResolution(retry, anchor, bookmarkId);
          finish(true);
        }
      } catch (err) {
        console.warn("[ZeroPin] highlightSnippet threw in MutationObserver, aborting retry:", err);
        finish(false);
      }
    }, MUTATION_DEBOUNCE_MS);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  const timeoutHandle = setTimeout(() => finish(false), HIGHLIGHT_RETRY_TIMEOUT_MS);
}

// ── URL normalisation helper ──────────────────────────────────────────────────
// Hash fragments are ephemeral (GitHub line links, etc.) and must not prevent
// anchor resolution.  Strip them before comparing stored vs. current URL.

function stripHash(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

// ── Storage listener for highlight requests ──

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes["ZP_HIGHLIGHT_REQUEST"]) {
    const newValue = changes["ZP_HIGHLIGHT_REQUEST"].newValue as {
      tabId?: number;
      url?: string;
      anchor?: SnippetAnchor;
      bookmarkId?: string;
      timestamp?: number;
    } | undefined;
    if (
      newValue &&
      stripHash(newValue.url ?? "") === stripHash(window.location.href) &&
      newValue.anchor
    ) {
      processHighlightRequest(newValue.anchor, newValue.bookmarkId);
    }
  }
});

// ── On-load poll for race condition fix ──

const MAX_REQUEST_AGE_MS = 30_000;

chrome.storage.local.get("ZP_HIGHLIGHT_REQUEST", (items) => {
  if (chrome.runtime.lastError) return;
  const pending = items["ZP_HIGHLIGHT_REQUEST"] as {
    tabId?: number;
    url?: string;
    anchor?: SnippetAnchor;
    bookmarkId?: string;
    timestamp?: number;
  } | undefined;
  if (!pending || !pending.anchor) return;
  if (stripHash(pending.url ?? "") !== stripHash(window.location.href)) {
    console.warn(
      `ZP: highlight request URL mismatch — stored: "${pending.url}", current: "${window.location.href}"`
    );
    return;
  }
  if (pending.timestamp && Date.now() - pending.timestamp > MAX_REQUEST_AGE_MS) {
    console.warn("ZP: highlight request expired (>30 s old)");
    chrome.storage.local.remove("ZP_HIGHLIGHT_REQUEST");
    return;
  }
  processHighlightRequest(pending.anchor, pending.bookmarkId);
});

