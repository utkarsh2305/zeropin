/**
 * Anchor utilities for robust text snippet locating.
 * Inspired by W3C Web Annotation spec.
 */

/**
 * Compute character offsets relative to document.body.textContent
 */
export function computeTextOffsets(range: Range): { startOffset: number; endOffset: number } {
  let currentOffset = 0;
  let startOffset = -1;
  let endOffset = -1;

  for (const node of walkTextNodes(document.body)) {
    const nodeLength = node.textContent?.length ?? 0;

    if (startOffset === -1 && range.intersectsNode(node)) {
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(node);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const start = node === range.startContainer
        ? range.startOffset
        : nodeLength;
      startOffset = currentOffset + start;
    }

    if (endOffset === -1 && range.intersectsNode(node)) {
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(node);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const offset = preCaretRange.toString().length;
      endOffset = currentOffset + offset;
    }

    currentOffset += nodeLength;
  }

  return {
    startOffset: startOffset === -1 ? 0 : startOffset,
    endOffset: endOffset === -1 ? currentOffset : endOffset,
  };
}

/**
 * Extract prefix (up to N characters before range start)
 */
export function getPrefix(range: Range, length: number): string {
  const cloned = range.cloneRange();
  cloned.collapse(true); // collapse to start
  const preRange = document.createRange();
  preRange.selectNodeContents(document.body);
  preRange.setEnd(cloned.startContainer, cloned.startOffset);

  const text = preRange.toString();
  return text.slice(Math.max(0, text.length - length));
}

/**
 * Extract suffix (up to N characters after range end)
 */
export function getSuffix(range: Range, length: number): string {
  const cloned = range.cloneRange();
  cloned.collapse(false); // collapse to end
  const postRange = document.createRange();
  postRange.selectNodeContents(document.body);
  postRange.setStart(cloned.endContainer, cloned.endOffset);

  const text = postRange.toString();
  return text.slice(0, length);
}

/**
 * Iterator over all text nodes in a subtree
 */
export function* walkTextNodes(root: Node): Generator<Text> {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null,
  );

  let node: Node | null = walker.nextNode();
  while (node) {
    yield node as Text;
    node = walker.nextNode();
  }
}

/**
 * Create Range from character offsets relative to document.body.textContent
 */
export function rangeFromOffsets(
  root: Node,
  startOffset: number,
  endOffset: number,
): Range | null {
  let currentOffset = 0;
  let startNode: Text | null = null;
  let startLocalOffset = 0;
  let endNode: Text | null = null;
  let endLocalOffset = 0;

  for (const node of walkTextNodes(root)) {
    const nodeLength = node.textContent?.length ?? 0;

    if (startNode === null && currentOffset + nodeLength > startOffset) {
      startNode = node;
      startLocalOffset = startOffset - currentOffset;
    }

    if (endNode === null && currentOffset + nodeLength >= endOffset) {
      endNode = node;
      endLocalOffset = endOffset - currentOffset;
    }

    currentOffset += nodeLength;
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, Math.min(startLocalOffset, startNode.length));
  range.setEnd(endNode, Math.min(endLocalOffset, endNode.length));
  return range;
}

/**
 * Levenshtein distance for string comparison
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator,
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Jaro-Winkler similarity (0-1 scale, higher = more similar)
 */
export function jaroWinklerSimilarity(a: string, b: string): number {
  if (!a || !b) return a === b ? 1 : 0;

  const maxLen = Math.max(a.length, b.length);
  const matchDistance = Math.floor(maxLen / 2) - 1;

  const aMatches: boolean[] = Array(a.length).fill(false);
  const bMatches: boolean[] = Array(b.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);

    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3;

  if (jaro < 0.7) return jaro;

  let prefix = 0;
  for (let i = 0; i < Math.min(a.length, b.length, 4); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Normalized similarity score (0-1)
 */
export function normalizedSimilarity(a: string, b: string): number {
  if (!a || !b) return a === b ? 1 : 0;
  if (a === b) return 1;

  const maxLen = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Create Range from node and regex match result
 */
export function createRangeFromMatch(
  node: Text,
  match: RegExpMatchArray | { 0: string; index: number },
): Range {
  const range = document.createRange();
  const startOffset = match.index ?? 0;
  const endOffset = startOffset + match[0].length;

  range.setStart(node, Math.min(startOffset, node.length));
  range.setEnd(node, Math.min(endOffset, node.length));

  return range;
}

/**
 * Escape regex special characters
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if prefix matches before range
 */
export function prefixMatches(range: Range, expectedPrefix: string): boolean {
  const actual = getPrefix(range, expectedPrefix.length);
  return actual.endsWith(expectedPrefix);
}

/**
 * Check if suffix matches after range
 */
export function suffixMatches(range: Range, expectedSuffix: string): boolean {
  const actual = getSuffix(range, expectedSuffix.length);
  return actual.startsWith(expectedSuffix);
}

/**
 * Normalize text: collapse whitespace and lowercase
 */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Mapping from normalized document text back to DOM nodes
 */
export interface DocTextSegment {
  node: Text;
  normStart: number;  // start index in normalized string
  rawStart: number;   // start index in raw node text
  length: number;     // length in normalized string
  rawLength: number;  // length in raw node text
}

export interface DocTextMap {
  normalized: string;
  segments: DocTextSegment[];
}

/**
 * Build a single normalized string from all text nodes under root,
 * with a segment map to convert normalized offsets back to DOM ranges.
 */
export function buildNormalizedDocText(root: Node): DocTextMap {
  const segments: DocTextSegment[] = [];
  let normalized = "";

  for (const node of walkTextNodes(root)) {
    const raw = node.textContent ?? "";
    if (!raw) continue;

    const norm = raw.replace(/\s+/g, " ").toLowerCase();
    if (!norm) continue;

    segments.push({
      node,
      normStart: normalized.length,
      rawStart: 0,
      length: norm.length,
      rawLength: raw.length,
    });

    normalized += norm;
  }

  return { normalized, segments };
}

/**
 * Convert normalized-string offsets back into a DOM Range.
 */
export function docTextToRange(map: DocTextMap, normStart: number, normEnd: number): Range | null {
  let startNode: Text | null = null;
  let startLocal = 0;
  let endNode: Text | null = null;
  let endLocal = 0;

  for (const seg of map.segments) {
    const segEnd = seg.normStart + seg.length;

    if (!startNode && normStart < segEnd) {
      startNode = seg.node;
      const normOffset = normStart - seg.normStart;
      // Map normalized offset to raw offset proportionally
      startLocal = Math.round((normOffset / seg.length) * seg.rawLength);
    }

    if (!endNode && normEnd <= segEnd) {
      endNode = seg.node;
      const normOffset = normEnd - seg.normStart;
      endLocal = Math.round((normOffset / seg.length) * seg.rawLength);
    }

    if (startNode && endNode) break;
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, Math.min(startLocal, startNode.length));
  range.setEnd(endNode, Math.min(endLocal, endNode.length));
  return range;
}

/**
 * Build a best-effort CSS selector path from element up to body.
 * Prefers stable attributes (id, data-testid, data-message-id, aria-label).
 */
export function buildCssPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.body && current !== document.documentElement) {
    // Prefer id
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break; // id is unique, no need to go further
    }

    // Prefer stable data attributes
    const testId = current.getAttribute("data-testid");
    if (testId) {
      parts.unshift(`[data-testid="${CSS.escape(testId)}"]`);
      break;
    }

    const messageId = current.getAttribute("data-message-id");
    if (messageId) {
      parts.unshift(`[data-message-id="${CSS.escape(messageId)}"]`);
      break;
    }

    const ariaLabel = current.getAttribute("aria-label");
    if (ariaLabel) {
      parts.unshift(`${current.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`);
      break;
    }

    // Fallback: tagName + nth-child
    const parent: Element | null = current.parentElement;
    if (parent) {
      const tag = current.tagName;
      const siblings = Array.from(parent.children).filter(
        (c: Element) => c.tagName === tag,
      );
      if (siblings.length === 1) {
        parts.unshift(current.tagName.toLowerCase());
      } else {
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
      }
    } else {
      parts.unshift(current.tagName.toLowerCase());
    }

    current = parent;
  }

  return parts.join(" > ");
}

/**
 * Iterator over text nodes, optionally descending into shadow roots.
 */
export function* walkTextNodesShadow(root: Node): Generator<Text> {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ALL,
    null,
  );

  let node: Node | null = walker.currentNode;
  // Process root itself if text
  if (node.nodeType === Node.TEXT_NODE) {
    yield node as Text;
  }

  node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      yield node as Text;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const shadow = (node as Element).shadowRoot;
      if (shadow) {
        yield* walkTextNodesShadow(shadow);
      }
    }
    node = walker.nextNode();
  }
}

/**
 * Compute character offsets of a range relative to a container element.
 */
export function computeOffsetsInContainer(
  range: Range,
  container: Element,
): { start: number; end: number } {
  const preRange = document.createRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.startContainer, range.startOffset);
  const start = preRange.toString().length;

  const preEndRange = document.createRange();
  preEndRange.selectNodeContents(container);
  preEndRange.setEnd(range.endContainer, range.endOffset);
  const end = preEndRange.toString().length;

  return { start, end };
}
