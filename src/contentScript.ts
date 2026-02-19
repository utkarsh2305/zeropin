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
  };
  repairedAt?: number;
}

const FUZZY_SIMILARITY_MIN = 0.6;
const PREFIX_SUFFIX_LENGTH = 50;
const FINGERPRINT_FRAG_LENGTH = 30;
const HIGHLIGHT_DURATION_MS = 3000;
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

  return {
    cssPath: cssPath || undefined,
    containerTextSample,
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

  for (const node of walkTextNodes(root)) {
    const nodeText = node.textContent ?? "";
    const match = nodeText.match(regex);

    if (match) {
      return createRangeFromMatch(node, match);
    }
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
      matches.push({
        range: createRangeFromMatch(node, match),
        node,
        index: match.index,
      });
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
  let bestMatch: { range: Range; similarity: number; matched: string } | null =
    null;

  for (const node of walkTextNodes(root)) {
    const nodeText = node.textContent ?? "";

    for (let i = 0; i <= nodeText.length - text.length; i++) {
      const candidate = nodeText.substring(i, i + text.length);
      const similarity = jaroWinklerSimilarity(text, candidate);

      if (
        !bestMatch ||
        similarity > bestMatch.similarity
      ) {
        bestMatch = {
          range: createRangeFromMatch(node, { 0: candidate, index: i }),
          similarity,
          matched: candidate,
        };
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
  for (const node of walkTextNodes(messageEl)) {
    const nodeText = node.textContent ?? "";
    const match = nodeText.match(regex);
    if (match) {
      return createRangeFromMatch(node, match);
    }
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

const CONFIDENCE_HIGH = 0.85;
const CONFIDENCE_LOW = 0.65;

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
      if (similarity > 0.7) {
        return { found: true, confidence: Math.min(1.0, similarity + containerBoost), stage: "D", range: posRange };
      }
    }
  }

  // STEP E: Fingerprint Pack Fallback
  if (anchor.fingerprint) {
    const fpRange = findByFingerprint(anchor.fingerprint, root);
    if (fpRange) {
      const similarity = normalizedSimilarity(fpRange.toString(), anchor.text);
      if (similarity > 0.5) {
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
    }, HIGHLIGHT_DURATION_MS);
  } catch (err) {
    console.error("ZP: highlightAndScroll error", err);
  }
}

// ── Message listener ──

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
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
      const retry = highlightSnippet(anchor);
      if (retry.found) {
        highlightAndScroll(retry);
        sendResolution(retry, anchor, bookmarkId);
        finish(true);
      }
    }, MUTATION_DEBOUNCE_MS);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  const timeoutHandle = setTimeout(() => finish(false), HIGHLIGHT_RETRY_TIMEOUT_MS);
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
    if (newValue && newValue.url === window.location.href && newValue.anchor) {
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
  if (!pending || pending.url !== window.location.href || !pending.anchor) return;
  if (pending.timestamp && Date.now() - pending.timestamp > MAX_REQUEST_AGE_MS) {
    chrome.storage.local.remove("ZP_HIGHLIGHT_REQUEST");
    return;
  }
  processHighlightRequest(pending.anchor, pending.bookmarkId);
});

