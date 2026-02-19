import { describe, it, expect, beforeEach } from "vitest";
import type { LibraryState } from "../types";
import { SCHEMA_VERSION } from "../types";

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

// Must import AFTER mock is set up
import {
  computeSnippetHash,
  getState,
  addPageBookmark,
  addSelectionBookmark,
  bulkDeleteBookmarks,
  bulkMoveBookmarks,
} from "./local";

function makeState(): LibraryState {
  return {
    schemaVersion: SCHEMA_VERSION,
    rootFolderId: "root",
    inboxFolderId: "inbox",
    folders: {
      root: { id: "root", parentId: null, name: "ZeroPin", sortKey: "m", createdAt: 1000, updatedAt: 1000 },
      inbox: { id: "inbox", parentId: "root", name: "Inbox", sortKey: "a", createdAt: 1000, updatedAt: 1000 },
      folderB: { id: "folderB", parentId: "root", name: "Folder B", sortKey: "b", createdAt: 1000, updatedAt: 1000 },
    },
    bookmarks: {},
  };
}

function setStoreState(state: LibraryState) {
  store = { zp_state: state };
}

// ── computeSnippetHash ──

describe("computeSnippetHash", () => {
  it("returns same hash regardless of trailing slash and fragment", () => {
    const h1 = computeSnippetHash("https://example.com/page/");
    const h2 = computeSnippetHash("https://example.com/page#section");
    const h3 = computeSnippetHash("https://example.com/page");
    expect(h1).toBe(h3);
    expect(h2).toBe(h3);
  });

  it("returns different hash for different snippet text on same URL", () => {
    const h1 = computeSnippetHash("https://example.com", "hello world");
    const h2 = computeSnippetHash("https://example.com", "goodbye world");
    expect(h1).not.toBe(h2);
  });

  it("returns different hash for PAGE vs SNIPPET on same URL", () => {
    const hPage = computeSnippetHash("https://example.com");
    const hSnippet = computeSnippetHash("https://example.com", "some text");
    expect(hPage).not.toBe(hSnippet);
  });
});

// ── addPageBookmark dedup ──

describe("addPageBookmark dedup", () => {
  beforeEach(() => {
    setStoreState(makeState());
  });

  it("creates new bookmark when no duplicate exists", async () => {
    await addPageBookmark("https://example.com", "Example");
    const state = await getState();
    const bookmarks = Object.values(state.bookmarks);
    expect(bookmarks.length).toBe(1);
    expect(bookmarks[0].url).toBe("https://example.com");
    expect(bookmarks[0].snippetHash).toBeDefined();
  });

  it("updates updatedAt (not creates new) when duplicate exists in same folder", async () => {
    await addPageBookmark("https://example.com", "Example");
    const state1 = await getState();
    const firstId = Object.keys(state1.bookmarks)[0];
    const firstCreatedAt = state1.bookmarks[firstId].createdAt;

    // Small delay so updatedAt differs
    await new Promise((r) => setTimeout(r, 10));

    await addPageBookmark("https://example.com", "Example Updated Title");
    const state2 = await getState();
    const bookmarks = Object.values(state2.bookmarks);
    expect(bookmarks.length).toBe(1);
    expect(bookmarks[0].id).toBe(firstId);
    expect(bookmarks[0].createdAt).toBe(firstCreatedAt);
    expect(bookmarks[0].updatedAt).toBeGreaterThanOrEqual(firstCreatedAt);
  });

  it("allows same URL in different folders (not considered duplicate)", async () => {
    await addPageBookmark("https://example.com", "Example");
    // Move first bookmark to folderB
    const state1 = await getState();
    const firstId = Object.keys(state1.bookmarks)[0];
    state1.bookmarks[firstId].folderId = "folderB";
    setStoreState(state1);

    await addPageBookmark("https://example.com", "Example");
    const state2 = await getState();
    expect(Object.values(state2.bookmarks).length).toBe(2);
  });
});

// ── addSelectionBookmark dedup ──

describe("addSelectionBookmark dedup", () => {
  beforeEach(() => {
    setStoreState(makeState());
  });

  it("creates new when no duplicate exists", async () => {
    await addSelectionBookmark({ url: "https://example.com", title: "Example", selectedText: "hello world" });
    const state = await getState();
    expect(Object.values(state.bookmarks).length).toBe(1);
    expect(Object.values(state.bookmarks)[0].type).toBe("SNIPPET");
  });

  it("updates updatedAt when same url+snippet in same folder", async () => {
    await addSelectionBookmark({ url: "https://example.com", title: "Example", selectedText: "hello world" });
    const state1 = await getState();
    const firstId = Object.keys(state1.bookmarks)[0];

    await new Promise((r) => setTimeout(r, 10));

    await addSelectionBookmark({ url: "https://example.com", title: "Example", selectedText: "hello world" });
    const state2 = await getState();
    expect(Object.values(state2.bookmarks).length).toBe(1);
    expect(Object.values(state2.bookmarks)[0].id).toBe(firstId);
  });

  it("allows same snippet in different folders", async () => {
    await addSelectionBookmark({ url: "https://example.com", title: "Ex", selectedText: "hello" });
    const state1 = await getState();
    const firstId = Object.keys(state1.bookmarks)[0];
    state1.bookmarks[firstId].folderId = "folderB";
    setStoreState(state1);

    await addSelectionBookmark({ url: "https://example.com", title: "Ex", selectedText: "hello" });
    const state2 = await getState();
    expect(Object.values(state2.bookmarks).length).toBe(2);
  });

  it("old bookmarks without snippetHash are never matched as duplicates", async () => {
    const state = makeState();
    state.bookmarks["old-1"] = {
      id: "old-1",
      folderId: "inbox",
      type: "PAGE",
      name: "Old Bookmark",
      url: "https://example.com",
      domain: "example.com",
      sortKey: "1000",
      createdAt: 1000,
      updatedAt: 1000,
      // no snippetHash
    };
    setStoreState(state);

    await addPageBookmark("https://example.com", "New Bookmark");
    const state2 = await getState();
    expect(Object.values(state2.bookmarks).length).toBe(2);
  });
});

// ── bulkDeleteBookmarks ──

describe("bulkDeleteBookmarks", () => {
  beforeEach(() => {
    const state = makeState();
    state.bookmarks = {
      b1: { id: "b1", folderId: "inbox", type: "PAGE", name: "B1", url: "https://a.com", domain: "a.com", sortKey: "1", createdAt: 1, updatedAt: 1 },
      b2: { id: "b2", folderId: "inbox", type: "PAGE", name: "B2", url: "https://b.com", domain: "b.com", sortKey: "2", createdAt: 2, updatedAt: 2 },
      b3: { id: "b3", folderId: "folderB", type: "PAGE", name: "B3", url: "https://c.com", domain: "c.com", sortKey: "3", createdAt: 3, updatedAt: 3 },
    };
    setStoreState(state);
  });

  it("removes all specified IDs in single operation", async () => {
    await bulkDeleteBookmarks(["b1", "b2"]);
    const state = await getState();
    expect(Object.keys(state.bookmarks)).toEqual(["b3"]);
  });

  it("with empty array is a no-op", async () => {
    await bulkDeleteBookmarks([]);
    const state = await getState();
    expect(Object.keys(state.bookmarks).length).toBe(3);
  });

  it("ignores IDs that don't exist (no error)", async () => {
    await bulkDeleteBookmarks(["nonexistent", "b1"]);
    const state = await getState();
    expect(Object.keys(state.bookmarks).length).toBe(2);
    expect(state.bookmarks["b1"]).toBeUndefined();
  });
});

// ── bulkMoveBookmarks ──

describe("bulkMoveBookmarks", () => {
  beforeEach(() => {
    const state = makeState();
    state.bookmarks = {
      b1: { id: "b1", folderId: "inbox", type: "PAGE", name: "B1", url: "https://a.com", domain: "a.com", sortKey: "1", createdAt: 1, updatedAt: 1 },
      b2: { id: "b2", folderId: "inbox", type: "PAGE", name: "B2", url: "https://b.com", domain: "b.com", sortKey: "2", createdAt: 2, updatedAt: 2 },
      b3: { id: "b3", folderId: "folderB", type: "PAGE", name: "B3", url: "https://c.com", domain: "c.com", sortKey: "3", createdAt: 3, updatedAt: 3 },
    };
    setStoreState(state);
  });

  it("updates folderId for all specified IDs", async () => {
    await bulkMoveBookmarks(["b1", "b2"], "folderB");
    const state = await getState();
    expect(state.bookmarks["b1"].folderId).toBe("folderB");
    expect(state.bookmarks["b2"].folderId).toBe("folderB");
  });

  it("with empty array is a no-op", async () => {
    await bulkMoveBookmarks([], "folderB");
    const state = await getState();
    expect(state.bookmarks["b1"].folderId).toBe("inbox");
  });

  it("only modifies specified bookmarks, leaves others unchanged", async () => {
    await bulkMoveBookmarks(["b1"], "folderB");
    const state = await getState();
    expect(state.bookmarks["b1"].folderId).toBe("folderB");
    expect(state.bookmarks["b2"].folderId).toBe("inbox");
    expect(state.bookmarks["b3"].folderId).toBe("folderB");
  });
});
