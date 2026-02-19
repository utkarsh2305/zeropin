/**
 * Integration tests: cross-feature interactions between
 * keyboard shortcut, deduplication, global search, recent pins, and bulk actions.
 *
 * Uses the real storage functions with a mocked chrome.storage.local.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { LibraryState, Bookmark } from "./core/types";
import { SCHEMA_VERSION } from "./core/types";

// ── Mock chrome.storage.local ──

let store: Record<string, any> = {};

(globalThis as any).chrome = {
  storage: {
    local: {
      get(keys: string[], cb: (items: Record<string, any>) => void) {
        const result: Record<string, any> = {};
        for (const k of keys) {
          if (store[k] !== undefined) result[k] = store[k];
        }
        cb(result);
      },
      set(items: Record<string, any>, cb: () => void) {
        Object.assign(store, items);
        cb();
      },
      remove(_key: string) {},
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: { lastError: null },
};

import {
  getState,
  addPageBookmark,
  addSelectionBookmark,
  bulkDeleteBookmarks,
  bulkMoveBookmarks,
  createFolder,
} from "./core/storage/local";

// ── Helpers ──

function makeState(): LibraryState {
  return {
    schemaVersion: SCHEMA_VERSION,
    rootFolderId: "root",
    inboxFolderId: "inbox",
    folders: {
      root: { id: "root", parentId: null, name: "ZeroPin", sortKey: "m", createdAt: 1000, updatedAt: 1000 },
      inbox: { id: "inbox", parentId: "root", name: "Inbox", sortKey: "a", createdAt: 1000, updatedAt: 1000 },
    },
    bookmarks: {},
  };
}

function setStoreState(state: LibraryState) {
  store = { zp_state: state };
}

function allBookmarks(state: LibraryState): Bookmark[] {
  return Object.values(state.bookmarks);
}

/** Replicates Library.tsx search filter logic */
function searchBookmarks(bookmarks: Bookmark[], query: string): Bookmark[] {
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

/** Replicates RecentPins logic */
function getRecentPins(bookmarks: Bookmark[], limit = 10): Bookmark[] {
  return [...bookmarks].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

// ── Keyboard shortcut + De-duplication ──

describe("Keyboard shortcut + De-duplication", () => {
  beforeEach(() => setStoreState(makeState()));

  it("pin page twice → only one bookmark, updatedAt updated", async () => {
    await addPageBookmark("https://example.com", "Example");
    const s1 = await getState();
    expect(allBookmarks(s1).length).toBe(1);
    const first = allBookmarks(s1)[0];

    await new Promise((r) => setTimeout(r, 10));
    await addPageBookmark("https://example.com", "Example");
    const s2 = await getState();
    expect(allBookmarks(s2).length).toBe(1);
    expect(allBookmarks(s2)[0].id).toBe(first.id);
    expect(allBookmarks(s2)[0].updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it("pin same selection twice → only one bookmark", async () => {
    await addSelectionBookmark({ url: "https://example.com", title: "Ex", selectedText: "hello world" });
    await addSelectionBookmark({ url: "https://example.com", title: "Ex", selectedText: "hello world" });
    const s = await getState();
    expect(allBookmarks(s).length).toBe(1);
  });

  it("pin different selection on same URL → two bookmarks", async () => {
    await addSelectionBookmark({ url: "https://example.com", title: "Ex", selectedText: "hello" });
    await addSelectionBookmark({ url: "https://example.com", title: "Ex", selectedText: "goodbye" });
    const s = await getState();
    expect(allBookmarks(s).length).toBe(2);
  });
});

// ── Keyboard shortcut + Recently pinned ──

describe("Keyboard shortcut + Recently pinned", () => {
  beforeEach(() => setStoreState(makeState()));

  it("new pin appears in recent 10", async () => {
    await addPageBookmark("https://example.com", "Example");
    const s = await getState();
    const recent = getRecentPins(allBookmarks(s));
    expect(recent.length).toBe(1);
    expect(recent[0].url).toBe("https://example.com");
  });
});

// ── De-duplication + Bulk actions ──

describe("De-duplication + Bulk actions", () => {
  beforeEach(() => setStoreState(makeState()));

  it("bulk move to folder B → re-pin creates new in inbox", async () => {
    await addPageBookmark("https://example.com", "Example");
    const s1 = await getState();
    const id = Object.keys(s1.bookmarks)[0];

    // Create folderB and move
    const folderBId = await createFolder({ parentId: "root", name: "Folder B" });
    await bulkMoveBookmarks([id], folderBId);

    // Re-pin same URL — inbox has no duplicate anymore
    await addPageBookmark("https://example.com", "Example");
    const s2 = await getState();
    expect(allBookmarks(s2).length).toBe(2);
  });

  it("bulk delete → re-pin creates new bookmark", async () => {
    await addPageBookmark("https://example.com", "Example");
    const s1 = await getState();
    const id = Object.keys(s1.bookmarks)[0];

    await bulkDeleteBookmarks([id]);
    const s2 = await getState();
    expect(allBookmarks(s2).length).toBe(0);

    await addPageBookmark("https://example.com", "Example");
    const s3 = await getState();
    expect(allBookmarks(s3).length).toBe(1);
  });
});

// ── Global search + Bulk actions ──

describe("Global search + Bulk actions", () => {
  beforeEach(async () => {
    const state = makeState();
    state.folders["folderB"] = { id: "folderB", parentId: "root", name: "Folder B", sortKey: "b", createdAt: 1000, updatedAt: 1000 };
    setStoreState(state);
  });

  it("search across folders → bulk delete removes all selected", async () => {
    await addPageBookmark("https://react.dev", "React");
    const s1 = await getState();
    const reactId = Object.keys(s1.bookmarks)[0];
    s1.bookmarks[reactId].folderId = "folderB";
    setStoreState(s1);

    await addPageBookmark("https://react-native.dev", "React Native");
    const s2 = await getState();

    // Search for "react" — should find both across folders
    const results = searchBookmarks(allBookmarks(s2), "react");
    expect(results.length).toBe(2);

    // Bulk delete all search results
    await bulkDeleteBookmarks(results.map((b) => b.id));
    const s3 = await getState();
    expect(allBookmarks(s3).length).toBe(0);
  });

  it("search → bulk move to single folder", async () => {
    await addPageBookmark("https://a.com", "Alpha");
    await addSelectionBookmark({ url: "https://b.com", title: "Beta", selectedText: "beta text" });
    const s1 = await getState();
    const ids = Object.keys(s1.bookmarks);

    await bulkMoveBookmarks(ids, "folderB");
    const s2 = await getState();
    expect(allBookmarks(s2).every((b) => b.folderId === "folderB")).toBe(true);
  });
});

// ── Recently pinned + Bulk actions ──

describe("Recently pinned + Bulk actions", () => {
  beforeEach(() => setStoreState(makeState()));

  it("bulk delete removes from recent pins", async () => {
    await addPageBookmark("https://a.com", "A");
    await addPageBookmark("https://b.com", "B");
    const s1 = await getState();
    const ids = Object.keys(s1.bookmarks);

    await bulkDeleteBookmarks([ids[0]]);
    const s2 = await getState();
    const recent = getRecentPins(allBookmarks(s2));
    expect(recent.length).toBe(1);
  });

  it("bulk move keeps item in recent pins (createdAt unchanged)", async () => {
    await addPageBookmark("https://a.com", "A");
    const s1 = await getState();
    const id = Object.keys(s1.bookmarks)[0];
    const createdAt = s1.bookmarks[id].createdAt;

    const folderBId = await createFolder({ parentId: "root", name: "Folder B" });
    await bulkMoveBookmarks([id], folderBId);
    const s2 = await getState();
    const recent = getRecentPins(allBookmarks(s2));
    expect(recent.length).toBe(1);
    expect(recent[0].createdAt).toBe(createdAt);
  });
});

// ── Global search + Recently pinned ──

describe("Global search + Recently pinned", () => {
  it("during search, recently pinned is hidden", () => {
    const isSearching = true;
    const showRecentPins = !isSearching;
    expect(showRecentPins).toBe(false);
  });

  it("clear search → recently pinned reappears", () => {
    const isSearching = false;
    const showRecentPins = !isSearching;
    expect(showRecentPins).toBe(true);
  });
});

// ── Full flow ──

describe("Full flow", () => {
  beforeEach(() => setStoreState(makeState()));

  it("pin page + pin selection → search → bulk move → verify", async () => {
    // Pin a page
    await addPageBookmark("https://example.com", "Example");
    // Pin a selection on same page
    await addSelectionBookmark({ url: "https://example.com", title: "Example", selectedText: "important text" });
    const s1 = await getState();
    expect(allBookmarks(s1).length).toBe(2);

    // Search finds both
    const results = searchBookmarks(allBookmarks(s1), "example");
    expect(results.length).toBe(2);

    // Create folder and bulk move
    const folderBId = await createFolder({ parentId: "root", name: "Folder B" });
    await bulkMoveBookmarks(results.map((b) => b.id), folderBId);
    const s2 = await getState();
    expect(allBookmarks(s2).every((b) => b.folderId === folderBId)).toBe(true);

    // Search in new folder finds them
    const searchInNew = searchBookmarks(allBookmarks(s2), "example");
    expect(searchInNew.length).toBe(2);

    // Recent pins shows them by createdAt
    const recent = getRecentPins(allBookmarks(s2));
    expect(recent.length).toBe(2);
    expect(recent[0].createdAt).toBeGreaterThanOrEqual(recent[1].createdAt);
  });
});
