import { describe, it, expect, beforeEach } from "vitest";
import type { LibraryState } from "../types";
import { SCHEMA_VERSION } from "../types";
import type { Bookmark } from "../types";

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
  deleteBookmark,
  moveBookmark,
  renameBookmark,
  setBookmarkNotes,
  deleteFolderCascade,
  deleteFolderIfEmpty,
  renameFolder,
  setFolderColor,
  setLastUsedFolder,
  createFolder,
  recordBookmarkOpen,
  moveBookmarkWithinFolder,
  moveFolderToParent,
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

// ── addPageBookmark with explicit folderId ──

describe("addPageBookmark with explicit folderId", () => {
  beforeEach(() => {
    const state = makeState();
    state.folders["work"] = { id: "work", parentId: "root", name: "Work", sortKey: "b", createdAt: 1000, updatedAt: 1000 };
    setStoreState(state);
  });

  it("saves to explicit folderId when provided", async () => {
    await addPageBookmark("https://work.example.com", "Work Site", undefined, "work");
    const state = await getState();
    const bm = Object.values(state.bookmarks)[0];
    expect(bm.folderId).toBe("work");
    expect(bm.url).toBe("https://work.example.com");
  });

  it("falls back to inboxFolderId when folderId omitted", async () => {
    await addPageBookmark("https://example.com", "Example");
    const state = await getState();
    const bm = Object.values(state.bookmarks)[0];
    expect(bm.folderId).toBe("inbox");
  });

  it("deduplicates by URL within same explicit folder", async () => {
    await addPageBookmark("https://example.com", "First", undefined, "work");
    await addPageBookmark("https://example.com", "Second", undefined, "work");
    const state = await getState();
    expect(Object.keys(state.bookmarks)).toHaveLength(1);
  });

  it("does NOT deduplicate same URL across different folders", async () => {
    await addPageBookmark("https://example.com", "Inbox copy");
    await addPageBookmark("https://example.com", "Work copy", undefined, "work");
    const state = await getState();
    expect(Object.keys(state.bookmarks)).toHaveLength(2);
  });
});

// ── addSelectionBookmark with explicit folderId ──

describe("addSelectionBookmark with explicit folderId", () => {
  beforeEach(() => {
    const state = makeState();
    state.folders["work"] = { id: "work", parentId: "root", name: "Work", sortKey: "b", createdAt: 1000, updatedAt: 1000 };
    setStoreState(state);
  });

  it("saves to explicit folderId", async () => {
    await addSelectionBookmark({ url: "https://example.com", title: "Ex", selectedText: "hello", folderId: "work" });
    const state = await getState();
    const bm = Object.values(state.bookmarks)[0];
    expect(bm.folderId).toBe("work");
    expect(bm.type).toBe("SNIPPET");
  });

  it("uses anchor.text over selectedText when anchor provided", async () => {
    const anchor = { text: "anchor text", prefix: "before ", suffix: " after" };
    await addSelectionBookmark({ url: "https://example.com", title: "Ex", selectedText: "raw", anchor });
    const state = await getState();
    const bm = Object.values(state.bookmarks)[0];
    expect(bm.snippet?.text).toBe("anchor text");
  });

  it("falls back to selectedText when anchor.text is empty", async () => {
    const anchor = { text: "" };
    await addSelectionBookmark({ url: "https://example.com", title: "Ex", selectedText: "raw selected", anchor });
    const state = await getState();
    const bm = Object.values(state.bookmarks)[0];
    expect(bm.snippet?.text).toBe("raw selected");
  });
});

// ── deleteBookmark ──

describe("deleteBookmark", () => {
  beforeEach(() => {
    const state = makeState();
    state.bookmarks = {
      bk1: { id: "bk1", folderId: "inbox", type: "PAGE", name: "B1", url: "https://a.com", domain: "a.com", sortKey: "1", createdAt: 1, updatedAt: 1 },
    };
    setStoreState(state);
  });

  it("removes the bookmark from state", async () => {
    await deleteBookmark("bk1");
    const state = await getState();
    expect(state.bookmarks["bk1"]).toBeUndefined();
    expect(Object.keys(state.bookmarks)).toHaveLength(0);
  });

  it("throws for unknown bookmark id", async () => {
    await expect(deleteBookmark("nonexistent")).rejects.toThrow();
  });
});

// ── moveBookmark ──

describe("moveBookmark", () => {
  beforeEach(() => {
    const state = makeState();
    state.folders["work"] = { id: "work", parentId: "root", name: "Work", sortKey: "b", createdAt: 1000, updatedAt: 1000 };
    state.bookmarks = {
      bk1: { id: "bk1", folderId: "inbox", type: "PAGE", name: "B1", url: "https://a.com", domain: "a.com", sortKey: "1", createdAt: 1, updatedAt: 1 },
    };
    setStoreState(state);
  });

  it("updates bookmark.folderId", async () => {
    await moveBookmark("bk1", "work");
    const state = await getState();
    expect(state.bookmarks["bk1"].folderId).toBe("work");
  });

  it("throws for unknown bookmark", async () => {
    await expect(moveBookmark("nonexistent", "work")).rejects.toThrow();
  });

  it("throws for unknown target folder", async () => {
    await expect(moveBookmark("bk1", "nonexistent")).rejects.toThrow();
  });
});

// ── renameBookmark ──

describe("renameBookmark", () => {
  beforeEach(() => {
    const state = makeState();
    state.bookmarks = {
      bk1: { id: "bk1", folderId: "inbox", type: "PAGE", name: "Old Name", url: "https://a.com", domain: "a.com", sortKey: "1", createdAt: 1, updatedAt: 1 },
    };
    setStoreState(state);
  });

  it("renames the bookmark", async () => {
    await renameBookmark("bk1", "New Name");
    const state = await getState();
    expect(state.bookmarks["bk1"].name).toBe("New Name");
  });

  it("updates updatedAt timestamp", async () => {
    const before = Date.now();
    await renameBookmark("bk1", "New");
    const state = await getState();
    expect(state.bookmarks["bk1"].updatedAt).toBeGreaterThanOrEqual(before);
  });
});

// ── setBookmarkNotes ──

describe("setBookmarkNotes", () => {
  beforeEach(() => {
    const state = makeState();
    state.bookmarks = {
      bk1: { id: "bk1", folderId: "inbox", type: "PAGE", name: "B1", url: "https://a.com", domain: "a.com", sortKey: "1", createdAt: 1, updatedAt: 1 },
    };
    setStoreState(state);
  });

  it("sets notes on a bookmark", async () => {
    await setBookmarkNotes("bk1", "My notes");
    const state = await getState();
    expect(state.bookmarks["bk1"].notes).toBe("My notes");
  });

  it("clears notes when set to empty string", async () => {
    await setBookmarkNotes("bk1", "Some notes");
    await setBookmarkNotes("bk1", "");
    const state = await getState();
    expect(state.bookmarks["bk1"].notes).toBe("");
  });
});

// ── renameFolder ──

describe("renameFolder", () => {
  beforeEach(() => setStoreState(makeState()));

  it("renames the folder", async () => {
    await renameFolder("inbox", "My Inbox");
    const state = await getState();
    expect(state.folders["inbox"].name).toBe("My Inbox");
  });

  it("throws for unknown folder id", async () => {
    await expect(renameFolder("nonexistent", "Name")).rejects.toThrow();
  });
});

// ── setFolderColor ──

describe("setFolderColor", () => {
  beforeEach(() => setStoreState(makeState()));

  it("sets folder color", async () => {
    await setFolderColor("inbox", "#ff0000");
    const state = await getState();
    expect(state.folders["inbox"].color).toBe("#ff0000");
  });

  it("clears folder color when set to undefined", async () => {
    await setFolderColor("inbox", "#ff0000");
    await setFolderColor("inbox", undefined);
    const state = await getState();
    expect(state.folders["inbox"].color).toBeUndefined();
  });
});

// ── setLastUsedFolder ──

describe("setLastUsedFolder", () => {
  beforeEach(() => setStoreState(makeState()));

  it("persists lastUsedFolderId", async () => {
    await setLastUsedFolder("inbox");
    const state = await getState();
    expect(state.lastUsedFolderId).toBe("inbox");
  });

  it("throws for unknown folder id", async () => {
    await expect(setLastUsedFolder("nonexistent")).rejects.toThrow();
  });
});

// ── deleteFolderIfEmpty ──

describe("deleteFolderIfEmpty", () => {
  beforeEach(() => {
    const state = makeState();
    state.folders["empty"] = { id: "empty", parentId: "root", name: "Empty", sortKey: "c", createdAt: 1, updatedAt: 1 };
    state.folders["withChild"] = { id: "withChild", parentId: "root", name: "WithChild", sortKey: "d", createdAt: 1, updatedAt: 1 };
    state.folders["child"] = { id: "child", parentId: "withChild", name: "Child", sortKey: "e", createdAt: 1, updatedAt: 1 };
    state.bookmarks = {
      bk1: { id: "bk1", folderId: "inbox", type: "PAGE", name: "B1", url: "https://a.com", domain: "a.com", sortKey: "1", createdAt: 1, updatedAt: 1 },
    };
    setStoreState(state);
  });

  it("deletes an empty folder", async () => {
    await deleteFolderIfEmpty("empty");
    const state = await getState();
    expect(state.folders["empty"]).toBeUndefined();
  });

  it("throws when folder has child folders", async () => {
    await expect(deleteFolderIfEmpty("withChild")).rejects.toThrow(/child/i);
  });

  it("throws when folder has bookmarks", async () => {
    await expect(deleteFolderIfEmpty("inbox")).rejects.toThrow(/bookmark/i);
  });

  it("throws for unknown folder id", async () => {
    await expect(deleteFolderIfEmpty("nonexistent")).rejects.toThrow();
  });
});

// ── deleteFolderCascade ──

describe("deleteFolderCascade", () => {
  beforeEach(() => {
    const state = makeState();
    state.folders["parent"] = { id: "parent", parentId: "root", name: "Parent", sortKey: "p", createdAt: 1, updatedAt: 1 };
    state.folders["child1"] = { id: "child1", parentId: "parent", name: "Child1", sortKey: "c", createdAt: 1, updatedAt: 1 };
    state.bookmarks = {
      bkInbox: { id: "bkInbox", folderId: "inbox", type: "PAGE", name: "Inbox BM", url: "https://a.com", domain: "a.com", sortKey: "1", createdAt: 1, updatedAt: 1 },
      bkParent: { id: "bkParent", folderId: "parent", type: "PAGE", name: "Parent BM", url: "https://b.com", domain: "b.com", sortKey: "2", createdAt: 2, updatedAt: 2 },
      bkChild: { id: "bkChild", folderId: "child1", type: "PAGE", name: "Child BM", url: "https://c.com", domain: "c.com", sortKey: "3", createdAt: 3, updatedAt: 3 },
    };
    setStoreState(state);
  });

  it("deletes folder and all descendant folders", async () => {
    await deleteFolderCascade("parent");
    const state = await getState();
    expect(state.folders["parent"]).toBeUndefined();
    expect(state.folders["child1"]).toBeUndefined();
  });

  it("deletes all bookmarks in deleted subtree", async () => {
    await deleteFolderCascade("parent");
    const state = await getState();
    expect(state.bookmarks["bkParent"]).toBeUndefined();
    expect(state.bookmarks["bkChild"]).toBeUndefined();
  });

  it("preserves bookmarks in other folders", async () => {
    await deleteFolderCascade("parent");
    const state = await getState();
    expect(state.bookmarks["bkInbox"]).toBeDefined();
  });

  it("throws for root folder", async () => {
    await expect(deleteFolderCascade("root")).rejects.toThrow(/root/i);
  });

  it("throws for inbox folder", async () => {
    await expect(deleteFolderCascade("inbox")).rejects.toThrow(/inbox/i);
  });

  it("resets lastUsedFolderId when deleted folder was lastUsed", async () => {
    const state0 = await getState();
    state0.lastUsedFolderId = "parent";
    setStoreState(state0);

    await deleteFolderCascade("parent");
    const state = await getState();
    expect(state.lastUsedFolderId).toBe(state.inboxFolderId);
  });
});

// ── createFolder ──

describe("createFolder", () => {
  beforeEach(() => setStoreState(makeState()));

  it("creates a folder under given parent", async () => {
    const id = await createFolder({ parentId: "root", name: "Shopping" });
    const state = await getState();
    expect(state.folders[id]).toBeDefined();
    expect(state.folders[id].name).toBe("Shopping");
    expect(state.folders[id].parentId).toBe("root");
  });

  it("created folder has color when provided", async () => {
    const id = await createFolder({ parentId: "root", name: "Red", color: "#ff0000" });
    const state = await getState();
    expect(state.folders[id].color).toBe("#ff0000");
  });

  it("returns unique id per call", async () => {
    const id1 = await createFolder({ parentId: "root", name: "A" });
    const id2 = await createFolder({ parentId: "root", name: "B" });
    expect(id1).not.toBe(id2);
  });
});

// ── recordBookmarkOpen ──

describe("recordBookmarkOpen", () => {
  beforeEach(() => {
    const state = makeState();
    state.bookmarks = {
      bk1: { id: "bk1", folderId: "inbox", type: "PAGE", name: "B1", url: "https://a.com", domain: "a.com", sortKey: "1", createdAt: 1, updatedAt: 1 },
    };
    setStoreState(state);
  });

  it("increments openCount", async () => {
    await recordBookmarkOpen("bk1");
    await recordBookmarkOpen("bk1");
    const state = await getState();
    expect(state.bookmarks["bk1"].openCount).toBe(2);
  });

  it("sets lastOpenedAt timestamp", async () => {
    const before = Date.now();
    await recordBookmarkOpen("bk1");
    const state = await getState();
    expect(state.bookmarks["bk1"].lastOpenedAt).toBeGreaterThanOrEqual(before);
  });

  it("is a no-op for unknown id", async () => {
    await expect(recordBookmarkOpen("nonexistent")).resolves.toBeUndefined();
  });
});

// ── moveBookmarkWithinFolder ──

describe("moveBookmarkWithinFolder", () => {
  beforeEach(() => {
    const state = makeState();
    state.bookmarks = {
      bk1: { id: "bk1", folderId: "inbox", type: "PAGE", name: "First", url: "https://a.com", domain: "a.com", sortKey: "3000", createdAt: 1, updatedAt: 1 },
      bk2: { id: "bk2", folderId: "inbox", type: "PAGE", name: "Second", url: "https://b.com", domain: "b.com", sortKey: "2000", createdAt: 2, updatedAt: 2 },
      bk3: { id: "bk3", folderId: "inbox", type: "PAGE", name: "Third", url: "https://c.com", domain: "c.com", sortKey: "1000", createdAt: 3, updatedAt: 3 },
    };
    setStoreState(state);
  });

  it("swaps sortKeys when moving UP", async () => {
    const s0 = await getState();
    const sk1before = s0.bookmarks["bk1"].sortKey;
    const sk2before = s0.bookmarks["bk2"].sortKey;
    await moveBookmarkWithinFolder("bk2", "UP");
    const s = await getState();
    // bk2 moved up means its sortKey and bk1's sortKey are swapped
    expect(s.bookmarks["bk2"].sortKey).toBe(sk1before);
    expect(s.bookmarks["bk1"].sortKey).toBe(sk2before);
  });

  it("is no-op when moving UP from first position", async () => {
    const s0 = await getState();
    const sk1before = s0.bookmarks["bk1"].sortKey;
    await moveBookmarkWithinFolder("bk1", "UP");
    const s = await getState();
    expect(s.bookmarks["bk1"].sortKey).toBe(sk1before);
  });

  it("is no-op for unknown id", async () => {
    await expect(moveBookmarkWithinFolder("nonexistent", "UP")).resolves.toBeUndefined();
  });
});

// ── moveFolderToParent ──

describe("moveFolderToParent", () => {
  beforeEach(() => {
    const state = makeState();
    state.folders["folderA"] = { id: "folderA", parentId: "root", name: "A", sortKey: "a", createdAt: 1, updatedAt: 1 };
    state.folders["folderB"] = { id: "folderB", parentId: "root", name: "B", sortKey: "b", createdAt: 1, updatedAt: 1 };
    state.folders["childA"] = { id: "childA", parentId: "folderA", name: "childA", sortKey: "ca", createdAt: 1, updatedAt: 1 };
    setStoreState(state);
  });

  it("moves folder to new parent", async () => {
    await moveFolderToParent("folderA", "folderB");
    const state = await getState();
    expect(state.folders["folderA"].parentId).toBe("folderB");
  });

  it("prevents moving a folder into its own descendant", async () => {
    await expect(moveFolderToParent("folderA", "childA")).rejects.toThrow(/descendant/i);
  });

  it("prevents moving root folder", async () => {
    await expect(moveFolderToParent("root", "inbox")).rejects.toThrow(/root/i);
  });

  it("is a no-op when moving to same folder", async () => {
    await moveFolderToParent("folderA", "folderA");
    const state = await getState();
    expect(state.folders["folderA"].parentId).toBe("root");
  });
});
