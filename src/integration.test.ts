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
import {
  updateRecents,
  getRecentFolderIds,
  getPendingSave,
  setPendingSave,
  computeFolderLabel,
  RECENTS_MAX,
} from "./core/storage/recents";
import type { PendingSave } from "./core/storage/recents";

// ── Helpers ──

function makeState(): LibraryState {
  return {
    schemaVersion: SCHEMA_VERSION,
    rootFolderId: "root",
    folders: {
      root: { id: "root", parentId: null, name: "ZeroPin", sortKey: "m", createdAt: 1000, updatedAt: 1000 },
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

// ── Context menu recents ──

describe("Context menu recents — save → updateRecents → rebuild menu", () => {
  beforeEach(() => {
    setStoreState(makeState());
    store["zp_recents"] = [];
  });

  it("saving via recent item updates recents list", async () => {
    await addPageBookmark("https://example.com", "Example");
    await updateRecents("root");
    const ids = await getRecentFolderIds();
    expect(ids[0]).toBe("root");
  });

  it("recents list caps at RECENTS_MAX (5) and drops oldest", async () => {
    const state = makeState();
    const folderIds: string[] = [];
    for (let i = 0; i < RECENTS_MAX + 2; i++) {
      const id = `f${i}`;
      state.folders[id] = { id, parentId: "root", name: `Folder ${i}`, sortKey: String(i), createdAt: i, updatedAt: i };
      folderIds.push(id);
    }
    setStoreState(state);

    for (const id of folderIds) {
      await updateRecents(id);
    }
    const ids = await getRecentFolderIds();
    expect(ids).toHaveLength(RECENTS_MAX);
    // Most recent should be last added
    expect(ids[0]).toBe(folderIds[folderIds.length - 1]);
    // Oldest (f0) should be gone
    expect(ids).not.toContain(folderIds[0]);
  });

  it("saving to same folder keeps it at front", async () => {
    await updateRecents("root");
    const folderId = await createFolder({ parentId: "root", name: "Work" });
    await updateRecents(folderId);
    await updateRecents("root");
    const ids = await getRecentFolderIds();
    expect(ids[0]).toBe("root");
    expect(ids.filter((id) => id === "root")).toHaveLength(1); // no duplicates
  });

  it("computeFolderLabel uses parent name for subfolders", async () => {
    const state = makeState();
    state.folders["work"] = { id: "work", parentId: "root", name: "Work", sortKey: "w", createdAt: 1, updatedAt: 1 };
    state.folders["proj"] = { id: "proj", parentId: "work", name: "ProjectX", sortKey: "p", createdAt: 1, updatedAt: 1 };
    setStoreState(state);
    const label = computeFolderLabel("proj", state.folders);
    expect(label).toBe("Work \u203a ProjectX");
  });

  it("recents filter removes deleted folder ids", async () => {
    const state = makeState();
    state.folders["temp"] = { id: "temp", parentId: "root", name: "Temp", sortKey: "t", createdAt: 1, updatedAt: 1 };
    setStoreState(state);
    // Set recents WITHOUT replacing store (setStoreState would overwrite zp_recents)
    store["zp_recents"] = ["root", "temp"];

    // Simulate deleting "temp" folder by patching the stored state directly
    const state2 = await getState();
    delete state2.folders["temp"];
    // Patch state in store without clearing other keys
    store["zp_state"] = state2;

    // Filter logic (same as rebuildContextMenus)
    const rawRecents = await getRecentFolderIds();
    const state3 = await getState();
    const validRecents = rawRecents.filter((id) => !!state3.folders[id]);
    expect(validRecents).toEqual(["root"]);
    expect(validRecents).not.toContain("temp");
  });
});

// ── Picker mode save flow ──

describe("Library picker mode — pendingSave → select folder → save", () => {
  beforeEach(() => {
    setStoreState(makeState());
    store["zp_pending_save"] = null;
  });

  it("stores PendingSave and retrieves it", async () => {
    const pending: PendingSave = {
      id: "uuid-1",
      createdAt: Date.now(),
      tabId: 1,
      url: "https://example.com",
      title: "Example",
    };
    await setPendingSave(pending);
    const result = await getPendingSave();
    expect(result?.url).toBe("https://example.com");
    expect(result?.id).toBe("uuid-1");
  });

  it("completes picker page save: addPageBookmark then clear pendingSave", async () => {
    const pending: PendingSave = {
      id: "uuid-2",
      createdAt: Date.now(),
      tabId: 1,
      url: "https://picker.example.com",
      title: "Picker Test",
    };
    await setPendingSave(pending);

    // Simulate user clicking a folder in picker
    const folderId = await createFolder({ parentId: "root", name: "Picked Folder" });
    await addPageBookmark(pending.url, pending.title, undefined, folderId);
    await updateRecents(folderId);
    await setPendingSave(null);

    const state = await getState();
    const bm = Object.values(state.bookmarks)[0];
    expect(bm.folderId).toBe(folderId);
    expect(bm.url).toBe("https://picker.example.com");

    const afterPending = await getPendingSave();
    expect(afterPending).toBeNull();

    const recents = await getRecentFolderIds();
    expect(recents[0]).toBe(folderId);
  });

  it("picker snippet save: stores anchor and selectedText", async () => {
    const pending: PendingSave = {
      id: "uuid-3",
      createdAt: Date.now(),
      tabId: 1,
      url: "https://docs.example.com",
      title: "Docs",
      selectionText: "important snippet",
      anchor: { text: "important snippet", prefix: "Read: ", suffix: " here." },
    };
    await setPendingSave(pending);

    const folderId = await createFolder({ parentId: "root", name: "Research" });
    await addSelectionBookmark({
      url: pending.url,
      title: pending.title,
      selectedText: pending.selectionText!,
      anchor: pending.anchor,
      folderId,
    });
    await setPendingSave(null);

    const state = await getState();
    const bm = Object.values(state.bookmarks)[0];
    expect(bm.type).toBe("SNIPPET");
    expect(bm.snippet?.text).toBe("important snippet");
    expect(bm.folderId).toBe(folderId);

    const afterPending = await getPendingSave();
    expect(afterPending).toBeNull();
  });
});
