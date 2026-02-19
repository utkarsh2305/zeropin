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
  walkTextNodesShadow,
  escapeRegex,
  levenshteinDistance,
  jaroWinklerSimilarity,
  normalizedSimilarity,
  createRangeFromMatch,
  rangeFromOffsets,
  getPrefix,
  getSuffix,
  prefixMatches,
  suffixMatches,
  computeTextOffsets,
  buildCssPath,
  computeOffsetsInContainer,
} from "./anchor";

// ── normalizeText ──

describe("normalizeText", () => {
  it("collapses multiple spaces", () => {
    expect(normalizeText("hello   world")).toBe("hello world");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("lowercases", () => {
    expect(normalizeText("Hello World")).toBe("hello world");
  });

  it("handles tabs and newlines", () => {
    expect(normalizeText("hello\n\tworld")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(normalizeText("")).toBe("");
  });

  it("handles all whitespace", () => {
    expect(normalizeText("   \n\t  ")).toBe("");
  });
});

// ── escapeRegex ──

describe("escapeRegex", () => {
  it("escapes special characters", () => {
    expect(escapeRegex("a.b*c?d")).toBe("a\\.b\\*c\\?d");
  });

  it("escapes brackets and parens", () => {
    expect(escapeRegex("[foo](bar)")).toBe("\\[foo\\]\\(bar\\)");
  });
});

// ── Similarity functions ──

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("abc", "abc")).toBe(0);
  });

  it("returns correct distance for single edit", () => {
    expect(levenshteinDistance("abc", "abd")).toBe(1);
  });

  it("returns length for completely different", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });

  it("handles empty strings", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });
});

describe("jaroWinklerSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(jaroWinklerSimilarity("hello", "hello")).toBe(1);
  });

  it("returns 0 for completely different", () => {
    expect(jaroWinklerSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns high similarity for near-matches", () => {
    const sim = jaroWinklerSimilarity("hello world", "hello worlD");
    expect(sim).toBeGreaterThan(0.9);
  });

  it("handles empty strings", () => {
    expect(jaroWinklerSimilarity("", "")).toBe(1);
    expect(jaroWinklerSimilarity("a", "")).toBe(0);
  });
});

describe("normalizedSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(normalizedSimilarity("abc", "abc")).toBe(1);
  });

  it("returns 0 for empty vs non-empty", () => {
    expect(normalizedSimilarity("", "abc")).toBe(0);
  });

  it("returns high value for similar strings", () => {
    expect(normalizedSimilarity("hello world", "hello worlx")).toBeGreaterThan(0.8);
  });
});

// ── DOM-based tests ──

describe("walkTextNodes", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("yields all text nodes in order", () => {
    document.body.innerHTML = "<p>Hello</p><p>World</p>";
    const texts = [...walkTextNodes(document.body)].map((n) => n.textContent);
    expect(texts).toEqual(["Hello", "World"]);
  });

  it("handles nested elements", () => {
    document.body.innerHTML = "<div>A<span>B<em>C</em></span>D</div>";
    const texts = [...walkTextNodes(document.body)].map((n) => n.textContent);
    expect(texts).toEqual(["A", "B", "C", "D"]);
  });

  it("returns empty for empty body", () => {
    document.body.innerHTML = "";
    const texts = [...walkTextNodes(document.body)];
    expect(texts).toHaveLength(0);
  });
});

describe("buildNormalizedDocText + docTextToRange", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("builds normalized text from multiple nodes", () => {
    document.body.innerHTML = "<p>Hello  World</p><p>Foo Bar</p>";
    const map = buildNormalizedDocText(document.body);
    expect(map.normalized).toContain("hello world");
    expect(map.normalized).toContain("foo bar");
    expect(map.segments.length).toBeGreaterThan(0);
  });

  it("docTextToRange returns a valid range", () => {
    document.body.innerHTML = "<p>Hello World</p>";
    const map = buildNormalizedDocText(document.body);
    const idx = map.normalized.indexOf("hello world");
    expect(idx).toBeGreaterThanOrEqual(0);

    const range = docTextToRange(map, idx, idx + "hello world".length);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("Hello World");
  });

  it("docTextToRange works across multiple nodes", () => {
    document.body.innerHTML = "<span>Hello </span><span>World</span>";
    const map = buildNormalizedDocText(document.body);
    // Normalized: "hello world"
    const idx = map.normalized.indexOf("hello ");
    const range = docTextToRange(map, idx, idx + "hello world".length);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("Hello World");
  });

  it("returns null for out-of-range offsets", () => {
    document.body.innerHTML = "<p>Short</p>";
    const map = buildNormalizedDocText(document.body);
    const range = docTextToRange(map, 1000, 2000);
    expect(range).toBeNull();
  });
});

describe("createRangeFromMatch", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("creates a range from a regex match", () => {
    document.body.innerHTML = "<p>Hello World</p>";
    const textNode = document.body.querySelector("p")!.firstChild as Text;
    const match = textNode.textContent!.match(/World/)!;
    const range = createRangeFromMatch(textNode, match);
    expect(range.toString()).toBe("World");
  });
});

describe("rangeFromOffsets", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("creates range from character offsets", () => {
    document.body.innerHTML = "<p>Hello World</p>";
    const range = rangeFromOffsets(document.body, 6, 11);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("World");
  });

  it("works across multiple text nodes", () => {
    document.body.innerHTML = "<span>Hello </span><span>World</span>";
    const range = rangeFromOffsets(document.body, 0, 11);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("Hello World");
  });

  it("returns null for out-of-range offsets", () => {
    document.body.innerHTML = "<p>Short</p>";
    const range = rangeFromOffsets(document.body, 100, 200);
    expect(range).toBeNull();
  });
});

describe("computeTextOffsets", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("computes correct offsets for a simple range", () => {
    document.body.innerHTML = "<p>Hello World</p>";
    const textNode = document.body.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);

    const offsets = computeTextOffsets(range);
    expect(offsets.startOffset).toBe(6);
    expect(offsets.endOffset).toBe(11);
  });
});

describe("getPrefix / getSuffix", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("getPrefix returns text before range", () => {
    document.body.innerHTML = "<p>Hello World Foo</p>";
    const textNode = document.body.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);

    const prefix = getPrefix(range, 10);
    expect(prefix).toBe("Hello ");
  });

  it("getSuffix returns text after range", () => {
    document.body.innerHTML = "<p>Hello World Foo</p>";
    const textNode = document.body.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);

    const suffix = getSuffix(range, 10);
    expect(suffix).toBe(" Foo");
  });
});

describe("prefixMatches / suffixMatches", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("prefixMatches returns true for matching prefix", () => {
    document.body.innerHTML = "<p>Hello World Foo</p>";
    const textNode = document.body.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);

    expect(prefixMatches(range, "Hello ")).toBe(true);
  });

  it("prefixMatches returns false for non-matching prefix", () => {
    document.body.innerHTML = "<p>Hello World Foo</p>";
    const textNode = document.body.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);

    expect(prefixMatches(range, "Goodbye ")).toBe(false);
  });

  it("suffixMatches returns true for matching suffix", () => {
    document.body.innerHTML = "<p>Hello World Foo</p>";
    const textNode = document.body.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);

    expect(suffixMatches(range, " Foo")).toBe(true);
  });
});

// ── buildCssPath ──

describe("buildCssPath", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("builds path with id shortcut", () => {
    document.body.innerHTML = '<div id="main"><p>Hello</p></div>';
    const p = document.body.querySelector("p")!;
    const path = buildCssPath(p);
    expect(path).toContain("#main");
    expect(document.querySelector(path)).toBe(p);
  });

  it("builds path with data-testid", () => {
    document.body.innerHTML = '<div data-testid="chat-msg"><span>Hi</span></div>';
    const span = document.body.querySelector("span")!;
    const path = buildCssPath(span);
    expect(path).toContain("data-testid");
    expect(document.querySelector(path)).toBe(span);
  });

  it("falls back to tagName:nth-child for ambiguous elements", () => {
    document.body.innerHTML = "<div><p>First</p><p>Second</p></div>";
    const secondP = document.body.querySelectorAll("p")[1];
    const path = buildCssPath(secondP);
    expect(path).toContain("nth-child");
    expect(document.querySelector(path)).toBe(secondP);
  });
});

// ── walkTextNodesShadow ──

describe("walkTextNodesShadow", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("yields text nodes from regular DOM", () => {
    document.body.innerHTML = "<p>Hello</p><p>World</p>";
    const texts = [...walkTextNodesShadow(document.body)].map((n) => n.textContent);
    expect(texts).toEqual(["Hello", "World"]);
  });

  it("yields text nodes from shadow roots", () => {
    document.body.innerHTML = "<div id='host'></div><p>Outside</p>";
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<span>Shadow Text</span>";

    const texts = [...walkTextNodesShadow(document.body)].map((n) => n.textContent);
    expect(texts).toContain("Shadow Text");
    expect(texts).toContain("Outside");
  });
});

// ── computeOffsetsInContainer ──

describe("computeOffsetsInContainer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("computes offsets relative to container", () => {
    document.body.innerHTML = "<div><p>Prefix </p><p>Target Text</p></div>";
    const container = document.body.querySelector("div")!;
    const targetNode = document.body.querySelectorAll("p")[1].firstChild as Text;
    const range = document.createRange();
    range.setStart(targetNode, 0);
    range.setEnd(targetNode, 11);

    const offsets = computeOffsetsInContainer(range, container);
    expect(offsets.start).toBe(7); // "Prefix " = 7 chars
    expect(offsets.end).toBe(18);  // 7 + 11
  });

  it("returns zero-based offsets for first text in container", () => {
    document.body.innerHTML = "<article><p>Hello World</p></article>";
    const container = document.body.querySelector("article")!;
    const textNode = document.body.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    const offsets = computeOffsetsInContainer(range, container);
    expect(offsets.start).toBe(0);
    expect(offsets.end).toBe(5);
  });
});
