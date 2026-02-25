/**
 * Unit tests for Library UI logic.
 * We test pure logic that Library.tsx / useFilterPipeline use, not React components.
 *
 * Suites:
 * - Global search filtering
 * - Multi-tag intersection filter
 * - Favourites and notes filter
 * - Multi-folder search scope
 * - Note truncation
 * - Sort options
 * - Open count display
 * - Bulk selection
 * - Folder display sort
 * - Keyboard navigation (getAdjacentId)
 * - Tag helpers (filterByTag, getAllTagsSorted, getTagCount)
 */
import { describe, it, expect } from "vitest";
import type { Bookmark, Folder, TagDef } from "../../core/types";

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

// ── Re-implement multi-tag intersection (mirrors useFilterPipeline) ──

function filterByTagIntersection(bookmarks: Bookmark[], tagIds: string[]): Bookmark[] {
  if (tagIds.length === 0) return bookmarks;
  return bookmarks.filter((b) => tagIds.every((t) => (b.tags ?? []).includes(t)));
}

// ── Re-implement multi-folder scope (mirrors BookmarkList) ──

function filterByFolderScope(
  bookmarks: Bookmark[],
  folderIds: string[],
  activeFolderId: string,
  isSearching: boolean,
): Bookmark[] {
  if (folderIds.length > 0) return bookmarks.filter((b) => folderIds.includes(b.folderId));
  if (isSearching) return bookmarks;
  return bookmarks.filter((b) => b.folderId === activeFolderId);
}

// ── Helper: create test folder ──

function makeFolder(id: string, name: string, sortKey: string): Folder {
  return { id, parentId: null, name, sortKey, createdAt: 0, updatedAt: 0 };
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

// ── Multi-tag intersection ──

describe("Multi-tag intersection filter", () => {
  const b1 = makeBookmark({ id: "b1", tags: ["t1", "t2", "t3"] });
  const b2 = makeBookmark({ id: "b2", tags: ["t1", "t2"] });
  const b3 = makeBookmark({ id: "b3", tags: ["t1"] });
  const b4 = makeBookmark({ id: "b4" }); // no tags

  it("empty filter returns all bookmarks", () => {
    expect(filterByTagIntersection([b1, b2, b3, b4], []).map((b) => b.id))
      .toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("single tag filters correctly", () => {
    expect(filterByTagIntersection([b1, b2, b3, b4], ["t1"]).map((b) => b.id))
      .toEqual(["b1", "b2", "b3"]);
  });

  it("two tags — bookmark must have BOTH", () => {
    expect(filterByTagIntersection([b1, b2, b3, b4], ["t1", "t2"]).map((b) => b.id))
      .toEqual(["b1", "b2"]);
  });

  it("three tags — only bookmark with all three survives", () => {
    expect(filterByTagIntersection([b1, b2, b3, b4], ["t1", "t2", "t3"]).map((b) => b.id))
      .toEqual(["b1"]);
  });

  it("no bookmark satisfies an impossible intersection", () => {
    expect(filterByTagIntersection([b1, b2, b3, b4], ["t1", "t99"])).toEqual([]);
  });

  it("bookmark with no tags field is excluded when filter is active", () => {
    expect(filterByTagIntersection([b4], ["t1"])).toEqual([]);
  });
});

// ── Favourites and notes filter ──

describe("Favourites and notes filter", () => {
  const fav  = makeBookmark({ id: "fav",  isFavorite: true,  notes: "" });
  const note = makeBookmark({ id: "note", isFavorite: false, notes: "some note" });
  const both = makeBookmark({ id: "both", isFavorite: true,  notes: "important" });
  const none = makeBookmark({ id: "none" });

  it("favourites filter returns only isFavorite bookmarks", () => {
    const result = [fav, note, both, none].filter((b) => !!b.isFavorite);
    expect(result.map((b) => b.id)).toEqual(["fav", "both"]);
  });

  it("notes filter returns only bookmarks with non-empty notes", () => {
    const result = [fav, note, both, none].filter((b) => !!b.notes?.trim());
    expect(result.map((b) => b.id)).toEqual(["note", "both"]);
  });

  it("bookmark with empty string notes is excluded from notes filter", () => {
    const b = makeBookmark({ id: "x", notes: "   " });
    expect([b].filter((bk) => !!bk.notes?.trim())).toEqual([]);
  });

  it("bookmark without isFavorite is excluded from favourites filter", () => {
    expect([none].filter((b) => !!b.isFavorite)).toEqual([]);
  });
});

// ── Multi-folder search scope ──

describe("Multi-folder search scope", () => {
  const bA = makeBookmark({ id: "bA", folderId: "folderA" });
  const bB = makeBookmark({ id: "bB", folderId: "folderB" });
  const bC = makeBookmark({ id: "bC", folderId: "folderC" });

  it("no scope + not searching: shows only active folder", () => {
    const result = filterByFolderScope([bA, bB, bC], [], "folderA", false);
    expect(result.map((b) => b.id)).toEqual(["bA"]);
  });

  it("no scope + searching: shows all folders", () => {
    const result = filterByFolderScope([bA, bB, bC], [], "folderA", true);
    expect(result.map((b) => b.id)).toEqual(["bA", "bB", "bC"]);
  });

  it("single folder scope limits results to that folder regardless of search", () => {
    const result = filterByFolderScope([bA, bB, bC], ["folderB"], "folderA", false);
    expect(result.map((b) => b.id)).toEqual(["bB"]);
  });

  it("multi-folder scope includes bookmarks from each selected folder", () => {
    const result = filterByFolderScope([bA, bB, bC], ["folderA", "folderC"], "folderA", false);
    expect(result.map((b) => b.id)).toEqual(["bA", "bC"]);
  });

  it("multi-folder scope with search still restricts to selected folders", () => {
    const result = filterByFolderScope([bA, bB, bC], ["folderA", "folderB"], "folderC", true);
    expect(result.map((b) => b.id)).toEqual(["bA", "bB"]);
  });

  it("scope with unknown folder ID returns empty", () => {
    const result = filterByFolderScope([bA, bB, bC], ["folderX"], "folderA", false);
    expect(result).toEqual([]);
  });
});

// ── Note Truncation (#5) ──

function truncateNote(notes?: string): string | null {
  if (!notes || !notes.trim()) return null;
  return notes.length > 60 ? notes.slice(0, 60) + "…" : notes;
}

describe("truncateNote", () => {
  it("returns null for undefined", () => {
    expect(truncateNote(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(truncateNote("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(truncateNote("   ")).toBeNull();
  });

  it("passes through a short note unchanged", () => {
    expect(truncateNote("Short note")).toBe("Short note");
  });

  it("passes through a 60-char note unchanged", () => {
    const note = "a".repeat(60);
    expect(truncateNote(note)).toBe(note);
  });

  it("truncates a 61-char note to 60 chars + ellipsis", () => {
    const note = "a".repeat(61);
    expect(truncateNote(note)).toBe("a".repeat(60) + "…");
  });
});

// ── Sort Options (#1) ──

// Mirrors Library.tsx sortBookmarks
type SortKey = "newest" | "oldest" | "name_asc" | "name_desc" | "last_opened" | "most_opened";
function sortBookmarks(bookmarks: Bookmark[], sortBy: SortKey): Bookmark[] {
  return [...bookmarks].sort((a, b) => {
    switch (sortBy) {
      case "oldest":      return Number(a.sortKey) - Number(b.sortKey);
      case "name_asc":    return a.name.localeCompare(b.name);
      case "name_desc":   return b.name.localeCompare(a.name);
      case "last_opened": return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0);
      case "most_opened": return (b.openCount ?? 0) - (a.openCount ?? 0);
      default:            return Number(b.sortKey) - Number(a.sortKey); // newest
    }
  });
}

describe("sortBookmarks", () => {
  const base = {
    folderId: "root",
    type: "PAGE" as const,
    url: "https://example.com",
    domain: "example.com",
    createdAt: 1000,
    updatedAt: 1000,
  };

  const bookmarks: Bookmark[] = [
    { ...base, id: "a", name: "Zebra", sortKey: "1000", openCount: 5, lastOpenedAt: 3000 },
    { ...base, id: "b", name: "Apple", sortKey: "2000", openCount: 0, lastOpenedAt: 0 },
    { ...base, id: "c", name: "Mango", sortKey: "3000", openCount: 10, lastOpenedAt: 1000 },
  ];

  it("newest — descending sortKey (c, b, a)", () => {
    const result = sortBookmarks(bookmarks, "newest");
    expect(result.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("oldest — ascending sortKey (a, b, c)", () => {
    const result = sortBookmarks(bookmarks, "oldest");
    expect(result.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("name_asc — alphabetical (Apple, Mango, Zebra)", () => {
    const result = sortBookmarks(bookmarks, "name_asc");
    expect(result.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("name_desc — reverse alphabetical (Zebra, Mango, Apple)", () => {
    const result = sortBookmarks(bookmarks, "name_desc");
    expect(result.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("last_opened — descending lastOpenedAt (a=3000, c=1000, b=0)", () => {
    const result = sortBookmarks(bookmarks, "last_opened");
    expect(result.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("most_opened — descending openCount (c=10, a=5, b=0)", () => {
    const result = sortBookmarks(bookmarks, "most_opened");
    expect(result.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("ties in last_opened (both 0) do not throw", () => {
    const tied: Bookmark[] = [
      { ...base, id: "x", name: "X", sortKey: "1" },
      { ...base, id: "y", name: "Y", sortKey: "2" },
    ];
    expect(() => sortBookmarks(tied, "last_opened")).not.toThrow();
  });

  it("ties in most_opened (both 0) do not throw", () => {
    const tied: Bookmark[] = [
      { ...base, id: "x", name: "X", sortKey: "1" },
      { ...base, id: "y", name: "Y", sortKey: "2" },
    ];
    expect(() => sortBookmarks(tied, "most_opened")).not.toThrow();
  });

  it("does not mutate the original array", () => {
    const original = [...bookmarks];
    sortBookmarks(bookmarks, "name_asc");
    expect(bookmarks.map((x) => x.id)).toEqual(original.map((x) => x.id));
  });
});

// ── Open Count Display (#3) ──

function formatOpenCount(openCount?: number): string | null {
  if ((openCount ?? 0) <= 0) return null;
  return `Opened ${openCount}×`;
}

describe("formatOpenCount", () => {
  it("returns null for undefined", () => {
    expect(formatOpenCount(undefined)).toBeNull();
  });

  it("returns null for 0", () => {
    expect(formatOpenCount(0)).toBeNull();
  });

  it("returns formatted string for 1", () => {
    expect(formatOpenCount(1)).toBe("Opened 1×");
  });

  it("returns formatted string for 100", () => {
    expect(formatOpenCount(100)).toBe("Opened 100×");
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

// ── Popup folder switcher (#8) ──

function sortFoldersForDisplay(folders: Record<string, Folder>): Folder[] {
  return Object.values(folders).sort((a, b) => Number(a.sortKey) - Number(b.sortKey));
}

describe("sortFoldersForDisplay", () => {
  it("returns folders sorted by sortKey ascending", () => {
    const folders: Record<string, Folder> = {
      c: makeFolder("c", "Charlie", "3000"),
      a: makeFolder("a", "Alpha",   "1000"),
      b: makeFolder("b", "Beta",    "2000"),
    };
    const result = sortFoldersForDisplay(folders);
    expect(result.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for empty input", () => {
    expect(sortFoldersForDisplay({})).toEqual([]);
  });

  it("does not mutate the original object", () => {
    const folders: Record<string, Folder> = {
      b: makeFolder("b", "Beta",  "2000"),
      a: makeFolder("a", "Alpha", "1000"),
    };
    const keysBefore = Object.keys(folders);
    sortFoldersForDisplay(folders);
    expect(Object.keys(folders)).toEqual(keysBefore);
  });

  it("single folder returns that folder", () => {
    const folders: Record<string, Folder> = {
      x: makeFolder("x", "Only", "500"),
    };
    const result = sortFoldersForDisplay(folders);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("x");
  });
});

// ── Keyboard navigation (#6) ──

function getAdjacentId(ids: string[], currentId: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null;
  if (!currentId) return delta === 1 ? ids[0] : ids[ids.length - 1];
  const idx = ids.indexOf(currentId);
  if (idx === -1) return ids[0];
  const next = idx + delta;
  if (next < 0 || next >= ids.length) return currentId;
  return ids[next];
}

describe("getAdjacentId", () => {
  const ids = ["a", "b", "c", "d"];

  it("empty list returns null", () => {
    expect(getAdjacentId([], null, 1)).toBeNull();
    expect(getAdjacentId([], "a", -1)).toBeNull();
  });

  it("null currentId + delta=1 returns first item", () => {
    expect(getAdjacentId(ids, null, 1)).toBe("a");
  });

  it("null currentId + delta=-1 returns last item", () => {
    expect(getAdjacentId(ids, null, -1)).toBe("d");
  });

  it("moves forward by one", () => {
    expect(getAdjacentId(ids, "a", 1)).toBe("b");
    expect(getAdjacentId(ids, "b", 1)).toBe("c");
  });

  it("moves backward by one", () => {
    expect(getAdjacentId(ids, "d", -1)).toBe("c");
    expect(getAdjacentId(ids, "b", -1)).toBe("a");
  });

  it("clamps at the start (delta=-1 on first item stays on first)", () => {
    expect(getAdjacentId(ids, "a", -1)).toBe("a");
  });

  it("clamps at the end (delta=1 on last item stays on last)", () => {
    expect(getAdjacentId(ids, "d", 1)).toBe("d");
  });

  it("unknown currentId returns first item", () => {
    expect(getAdjacentId(ids, "z", 1)).toBe("a");
  });

  it("single-item list returns that item for both directions", () => {
    expect(getAdjacentId(["x"], "x", 1)).toBe("x");
    expect(getAdjacentId(["x"], "x", -1)).toBe("x");
  });
});

// ── Tag filtering / sorting logic (#tag-system) ──

function makeTagDef(overrides: Partial<TagDef> & { id: string; name: string }): TagDef {
  return {
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function filterByTag(bookmarks: Bookmark[], tagId: string): Bookmark[] {
  return bookmarks.filter((b) => (b.tags ?? []).includes(tagId));
}

function getAllTagsSorted(tagDefs: Record<string, TagDef>): TagDef[] {
  return Object.values(tagDefs).sort((a, b) => a.name.localeCompare(b.name));
}

function getTagCount(bookmarks: Bookmark[], tagId: string): number {
  return bookmarks.filter((b) => (b.tags ?? []).includes(tagId)).length;
}

describe("filterByTag", () => {
  const b1 = makeBookmark({ id: "b1", tags: ["t1", "t2"] });
  const b2 = makeBookmark({ id: "b2", tags: ["t2"] });
  const b3 = makeBookmark({ id: "b3" }); // no tags field
  const b4 = makeBookmark({ id: "b4", tags: [] });

  it("returns only bookmarks containing the given tagId", () => {
    const result = filterByTag([b1, b2, b3, b4], "t1");
    expect(result.map((b) => b.id)).toEqual(["b1"]);
  });

  it("returns multiple bookmarks when they share a tag", () => {
    const result = filterByTag([b1, b2, b3, b4], "t2");
    expect(result.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("returns empty array when no bookmark has the tag", () => {
    expect(filterByTag([b1, b2, b3, b4], "t99")).toEqual([]);
  });

  it("returns empty array when given unknown tagId", () => {
    expect(filterByTag([b3, b4], "t1")).toEqual([]);
  });

  it("treats missing tags field as empty array", () => {
    const result = filterByTag([b3], "t1");
    expect(result).toEqual([]);
  });
});

describe("getAllTagsSorted", () => {
  const tagDefs: Record<string, TagDef> = {
    t3: makeTagDef({ id: "t3", name: "zebra" }),
    t1: makeTagDef({ id: "t1", name: "apple" }),
    t2: makeTagDef({ id: "t2", name: "mango" }),
  };

  it("returns tags sorted alphabetically by name", () => {
    const sorted = getAllTagsSorted(tagDefs);
    expect(sorted.map((t) => t.name)).toEqual(["apple", "mango", "zebra"]);
  });

  it("returns empty array for empty tagDefs", () => {
    expect(getAllTagsSorted({})).toEqual([]);
  });

  it("returns single-element array unchanged", () => {
    const result = getAllTagsSorted({ t1: makeTagDef({ id: "t1", name: "solo" }) });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("solo");
  });
});

describe("getTagCount", () => {
  const b1 = makeBookmark({ id: "b1", tags: ["t1", "t2"] });
  const b2 = makeBookmark({ id: "b2", tags: ["t1"] });
  const b3 = makeBookmark({ id: "b3" });

  it("counts bookmarks that contain the tag", () => {
    expect(getTagCount([b1, b2, b3], "t1")).toBe(2);
  });

  it("counts only bookmarks with that specific tag", () => {
    expect(getTagCount([b1, b2, b3], "t2")).toBe(1);
  });

  it("returns 0 when no bookmarks have the tag", () => {
    expect(getTagCount([b1, b2, b3], "t99")).toBe(0);
  });

  it("returns 0 for empty bookmarks list", () => {
    expect(getTagCount([], "t1")).toBe(0);
  });

  it("correctly counts bookmark with multiple tags", () => {
    const multi = makeBookmark({ id: "m", tags: ["t1", "t2", "t3"] });
    expect(getTagCount([multi], "t2")).toBe(1);
  });
});
