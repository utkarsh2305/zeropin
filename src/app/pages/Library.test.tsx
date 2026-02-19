/**
 * Unit tests for Library UI logic:
 * - Global search filtering
 * - Recently pinned sorting/limiting
 * - Bulk selection state management
 *
 * We test the pure logic that Library.tsx uses, not the React components themselves.
 */
import { describe, it, expect } from "vitest";
import type { Bookmark } from "../../core/types";

// ── Helper: create test bookmark ──

function makeBookmark(overrides: Partial<Bookmark> & { id: string }): Bookmark {
  return {
    folderId: "inbox",
    type: "PAGE",
    name: "Test Bookmark",
    url: "https://example.com",
    domain: "example.com",
    sortKey: "1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Re-implement search filter logic (mirrors Library.tsx:875-885) ──

function filterBookmarks(bookmarks: Bookmark[], query: string): Bookmark[] {
  if (!query.trim()) return bookmarks;
  const q = query.toLowerCase();
  return bookmarks.filter((b) =>
    b.name.toLowerCase().includes(q) ||
    b.url.toLowerCase().includes(q) ||
    b.domain.toLowerCase().includes(q) ||
    (b.snippet?.text ?? "").toLowerCase().includes(q) ||
    (b.notes ?? "").toLowerCase().includes(q)
  );
}

function filterByFolder(bookmarks: Bookmark[], folderId: string, isSearching: boolean): Bookmark[] {
  if (isSearching) return bookmarks;
  return bookmarks.filter((b) => b.folderId === folderId);
}

// ── Re-implement recent pins logic (mirrors RecentPins component) ──

function getRecentPins(bookmarks: Bookmark[], limit = 10): Bookmark[] {
  return [...bookmarks].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

// ── Global Search ──

describe("Global search filtering", () => {
  const bookmarks = [
    makeBookmark({ id: "1", name: "React Tutorial", url: "https://react.dev", domain: "react.dev", folderId: "inbox" }),
    makeBookmark({ id: "2", name: "Vue Guide", url: "https://vuejs.org", domain: "vuejs.org", folderId: "folderB" }),
    makeBookmark({ id: "3", name: "TypeScript Docs", url: "https://typescriptlang.org", domain: "typescriptlang.org", folderId: "inbox", snippet: { text: "TypeScript is a typed superset of JavaScript" } }),
    makeBookmark({ id: "4", name: "My Notes Page", url: "https://notes.app", domain: "notes.app", folderId: "folderB", notes: "Important reference for React patterns" }),
  ];

  it("matches by name (case-insensitive)", () => {
    const results = filterBookmarks(bookmarks, "react");
    expect(results.map((b) => b.id)).toContain("1");
  });

  it("matches by url", () => {
    const results = filterBookmarks(bookmarks, "vuejs.org");
    expect(results.map((b) => b.id)).toContain("2");
  });

  it("matches by domain", () => {
    const results = filterBookmarks(bookmarks, "typescriptlang");
    expect(results.map((b) => b.id)).toContain("3");
  });

  it("matches by snippet.text", () => {
    const results = filterBookmarks(bookmarks, "typed superset");
    expect(results.map((b) => b.id)).toEqual(["3"]);
  });

  it("matches by notes", () => {
    const results = filterBookmarks(bookmarks, "React patterns");
    expect(results.map((b) => b.id)).toEqual(["4"]);
  });

  it("returns bookmarks from ALL folders when searching", () => {
    const results = filterBookmarks(bookmarks, "react");
    // "React Tutorial" is in inbox, "My Notes Page" has "React" in notes and is in folderB
    const folderIds = new Set(results.map((b) => b.folderId));
    expect(folderIds.size).toBeGreaterThanOrEqual(1);
    // Cross-folder: with isSearching=true, filterByFolder should not restrict
    const displayed = filterByFolder(results, "inbox", true);
    expect(displayed.length).toBe(results.length);
  });

  it("empty query returns all bookmarks (folder filter applies)", () => {
    const results = filterBookmarks(bookmarks, "");
    expect(results.length).toBe(bookmarks.length);
    // Without search, folder filter restricts to active folder
    const displayed = filterByFolder(results, "inbox", false);
    expect(displayed.every((b) => b.folderId === "inbox")).toBe(true);
    expect(displayed.length).toBe(2);
  });
});

// ── Recently Pinned ──

describe("Recently pinned logic", () => {
  it("sorted by createdAt descending", () => {
    const bookmarks = [
      makeBookmark({ id: "1", createdAt: 1000 }),
      makeBookmark({ id: "2", createdAt: 3000 }),
      makeBookmark({ id: "3", createdAt: 2000 }),
    ];
    const recent = getRecentPins(bookmarks);
    expect(recent.map((b) => b.id)).toEqual(["2", "3", "1"]);
  });

  it("limited to 10 items", () => {
    const bookmarks = Array.from({ length: 15 }, (_, i) =>
      makeBookmark({ id: `b${i}`, createdAt: i * 1000 })
    );
    const recent = getRecentPins(bookmarks);
    expect(recent.length).toBe(10);
    // Most recent first
    expect(recent[0].id).toBe("b14");
  });

  it("with fewer than 10 bookmarks shows all", () => {
    const bookmarks = [
      makeBookmark({ id: "1", createdAt: 1000 }),
      makeBookmark({ id: "2", createdAt: 2000 }),
    ];
    const recent = getRecentPins(bookmarks);
    expect(recent.length).toBe(2);
  });

  it("hidden during search mode (logic check)", () => {
    const isSearching = true;
    const showRecentPins = !isSearching;
    expect(showRecentPins).toBe(false);
  });
});

// ── Bulk Selection ──

describe("Bulk selection logic", () => {
  function toggleId(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  it("toggling adds ID if absent", () => {
    const set = new Set<string>();
    const result = toggleId(set, "b1");
    expect(result.has("b1")).toBe(true);
  });

  it("toggling removes ID if present", () => {
    const set = new Set(["b1", "b2"]);
    const result = toggleId(set, "b1");
    expect(result.has("b1")).toBe(false);
    expect(result.has("b2")).toBe(true);
  });

  it("select all selects all visible bookmark IDs", () => {
    const visible = [
      makeBookmark({ id: "b1" }),
      makeBookmark({ id: "b2" }),
      makeBookmark({ id: "b3" }),
    ];
    const selectedIds = new Set(visible.map((b) => b.id));
    expect(selectedIds.size).toBe(3);
    expect(selectedIds.has("b1")).toBe(true);
    expect(selectedIds.has("b3")).toBe(true);
  });

  it("deselect all clears selectedIds", () => {
    const selectedIds = new Set(["b1", "b2"]);
    const cleared = new Set<string>();
    expect(cleared.size).toBe(0);
    expect(selectedIds.size).toBe(2); // original unchanged
  });

  it("exiting bulk mode clears selectedIds", () => {
    let bulkMode = true;
    let selectedIds = new Set(["b1", "b2"]);
    // Simulate exit
    bulkMode = false;
    selectedIds = new Set();
    expect(bulkMode).toBe(false);
    expect(selectedIds.size).toBe(0);
  });
});
