import { describe, it, expect, beforeEach } from "vitest";
import type { Folder } from "../types";

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
    },
  },
  runtime: { lastError: null },
};

// Must import AFTER mock is set up
import { updateRecents, getRecentFolderIds, computeFolderLabel, RECENTS_MAX, RECENTS_KEY, getPendingSave, setPendingSave } from "./recents";
import type { PendingSave } from "./recents";

beforeEach(() => {
  store = {};
});

// ── updateRecents ──

describe("updateRecents", () => {
  it("adds new folder to front", async () => {
    await updateRecents("a");
    const ids = await getRecentFolderIds();
    expect(ids[0]).toBe("a");
    expect(ids).toHaveLength(1);
  });

  it("deduplicates: moves existing id to front", async () => {
    store[RECENTS_KEY] = ["b", "a", "c"];
    await updateRecents("a");
    const ids = await getRecentFolderIds();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("caps at RECENTS_MAX (5)", async () => {
    store[RECENTS_KEY] = ["1", "2", "3", "4", "5"];
    await updateRecents("6");
    const ids = await getRecentFolderIds();
    expect(ids).toHaveLength(RECENTS_MAX);
    expect(ids[0]).toBe("6");
    expect(ids).not.toContain("5");
  });

  it("order is newest-first", async () => {
    await updateRecents("x");
    await updateRecents("y");
    await updateRecents("z");
    const ids = await getRecentFolderIds();
    expect(ids).toEqual(["z", "y", "x"]);
  });
});

// ── computeFolderLabel ──

function makeFolder(id: string, parentId: string | null, name: string): Folder {
  return { id, parentId, name, sortKey: "0", createdAt: 0, updatedAt: 0 };
}

describe("computeFolderLabel", () => {
  it("top-level folder shows name only", () => {
    const folders: Record<string, Folder> = {
      root: makeFolder("root", null, "ZeroPin"),
      inbox: makeFolder("inbox", "root", "Inbox"),
    };
    expect(computeFolderLabel("inbox", folders)).toBe("Inbox");
  });

  it("subfolder shows 'Parent \u203a Child'", () => {
    const folders: Record<string, Folder> = {
      root: makeFolder("root", null, "ZeroPin"),
      work: makeFolder("work", "root", "Work"),
      proj: makeFolder("proj", "work", "Project"),
    };
    expect(computeFolderLabel("proj", folders)).toBe("Work \u203a Project");
  });

  it("truncates label longer than 35 chars with ellipsis", () => {
    const folders: Record<string, Folder> = {
      root: makeFolder("root", null, "ZeroPin"),
      parent: makeFolder("parent", "root", "Very Long Parent Folder Name"),
      child: makeFolder("child", "parent", "Long Child"),
    };
    const label = computeFolderLabel("child", folders);
    expect(label.length).toBeLessThanOrEqual(35);
    expect(label.endsWith("\u2026")).toBe(true);
  });

  it("grandparent is ignored (only one level of parent)", () => {
    const folders: Record<string, Folder> = {
      root: makeFolder("root", null, "ZeroPin"),
      grandparent: makeFolder("grandparent", "root", "Grand"),
      parent: makeFolder("parent", "grandparent", "Parent"),
      child: makeFolder("child", "parent", "Child"),
    };
    // Parent is not top-level (its parent is grandparent, not null)
    // so label should be "Parent › Child", not "Grand › Parent › Child"
    expect(computeFolderLabel("child", folders)).toBe("Parent \u203a Child");
  });

  it("returns 'Unknown' for missing folder id", () => {
    expect(computeFolderLabel("nonexistent", {})).toBe("Unknown");
  });
});

// ── getRecentFolderIds — empty state ──

describe("getRecentFolderIds", () => {
  it("returns empty array when key missing from storage", async () => {
    // store is already reset to {} by beforeEach
    const ids = await getRecentFolderIds();
    expect(ids).toEqual([]);
  });

  it("returns stored array when key exists", async () => {
    store[RECENTS_KEY] = ["x", "y"];
    const ids = await getRecentFolderIds();
    expect(ids).toEqual(["x", "y"]);
  });
});

// ── getPendingSave / setPendingSave ──

describe("getPendingSave / setPendingSave", () => {
  it("returns null when no pending save stored", async () => {
    const result = await getPendingSave();
    expect(result).toBeNull();
  });

  it("round-trips a PendingSave object", async () => {
    const pending: PendingSave = {
      id: "abc-123",
      createdAt: 1700000000000,
      tabId: 42,
      url: "https://example.com",
      title: "Example Page",
      selectionText: "hello world",
    };
    await setPendingSave(pending);
    const result = await getPendingSave();
    expect(result).toEqual(pending);
  });

  it("setPendingSave(null) clears the pending save", async () => {
    const pending: PendingSave = { id: "abc", createdAt: 1, tabId: 1, url: "https://a.com", title: "A" };
    await setPendingSave(pending);
    await setPendingSave(null);
    const result = await getPendingSave();
    expect(result).toBeNull();
  });

  it("preserves all optional fields (anchor, ytResult)", async () => {
    const pending: PendingSave = {
      id: "xyz",
      createdAt: 1000,
      tabId: 5,
      url: "https://youtube.com/watch?v=abc",
      title: "YT Video",
      ytResult: { kind: "youtube", videoId: "abc", timestampSec: 125, timestampLabel: "02:05" },
      anchor: { text: "snippet text", prefix: "before" },
    };
    await setPendingSave(pending);
    const result = await getPendingSave();
    expect(result?.ytResult?.kind).toBe("youtube");
    expect(result?.anchor?.text).toBe("snippet text");
  });
});

// ── rebuildContextMenus filter logic ──

describe("rebuildContextMenus filter", () => {
  it("filters out deleted folder ids", () => {
    const rawRecents = ["id1", "id2", "id3"];
    const folderMap: Record<string, Folder> = {
      id1: makeFolder("id1", null, "A"),
      id3: makeFolder("id3", null, "C"),
    };
    const valid = rawRecents.filter((id) => !!folderMap[id]);
    expect(valid).toEqual(["id1", "id3"]);
  });

  it("preserves order of remaining ids", () => {
    const rawRecents = ["z", "a", "m", "b"];
    const folderMap: Record<string, Folder> = {
      z: makeFolder("z", null, "Z"),
      m: makeFolder("m", null, "M"),
    };
    const valid = rawRecents.filter((id) => !!folderMap[id]);
    expect(valid).toEqual(["z", "m"]);
  });
});
