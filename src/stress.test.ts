/**
 * Stress / performance tests for ZeroPin.
 * These tests validate that core operations remain fast at scale.
 * All timing assertions use generous budgets suitable for CI (slower machines).
 */
import { describe, it, expect, beforeEach } from "vitest";
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

import { getState, addPageBookmark, bulkDeleteBookmarks, deleteFolderCascade, createFolder } from "./core/storage/local";
import { updateRecents, getRecentFolderIds, computeFolderLabel, RECENTS_MAX } from "./core/storage/recents";
import { parseBrowserHtml, BOOKMARK_CAP } from "./core/storage/importBrowser";
import { computeSnippetHash } from "./core/storage/local";
import { jaroWinklerSimilarity, normalizeText } from "./core/anchor";

function makeBaseState(bookmarkCount: number) {
  const bookmarks: Record<string, any> = {};
  for (let i = 0; i < bookmarkCount; i++) {
    bookmarks[`bk-${i}`] = {
      id: `bk-${i}`,
      folderId: "root",
      type: "PAGE",
      name: `Bookmark ${i} — a title that is somewhat descriptive`,
      url: `https://example-${i}.com/page/article`,
      domain: `example-${i}.com`,
      sortKey: String(i),
      createdAt: i,
      updatedAt: i,
      snippetHash: computeSnippetHash(`https://example-${i}.com/page/article`),
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    rootFolderId: "root",
    folders: {
      root: { id: "root", parentId: null, name: "ZeroPin", sortKey: "m", createdAt: 0, updatedAt: 0 },
    },
    bookmarks,
  };
}

function setStoreState(state: any) {
  store = { zp_state: state };
}

/** Simple in-memory search replicating the Library.tsx search filter */
function searchBookmarks(bookmarks: any[], query: string): any[] {
  if (!query.trim()) return bookmarks;
  const q = query.toLowerCase();
  return bookmarks.filter((b: any) =>
    b.name.toLowerCase().includes(q) ||
    b.url.toLowerCase().includes(q) ||
    b.domain.toLowerCase().includes(q)
  );
}

beforeEach(() => {
  store = {};
});

// ── Storage: large state ──

describe("Storage — large state performance", () => {
  it("getState with 1000 bookmarks completes < 200ms", async () => {
    setStoreState(makeBaseState(1000));
    const start = performance.now();
    await getState();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it("addPageBookmark with 500 existing bookmarks completes < 300ms", async () => {
    setStoreState(makeBaseState(500));
    const start = performance.now();
    await addPageBookmark("https://brand-new-url-that-does-not-exist.com", "New Page");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(300);
    const state = await getState();
    expect(Object.keys(state.bookmarks)).toHaveLength(501);
  });

  it("addPageBookmark dedup check over 500 bookmarks < 300ms", async () => {
    setStoreState(makeBaseState(500));
    const start = performance.now();
    // Try to add a URL that already exists (triggers dedup path)
    await addPageBookmark("https://example-0.com/page/article", "Dup Title");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(300);
    // Count should remain 500 (dedup)
    const state = await getState();
    expect(Object.keys(state.bookmarks)).toHaveLength(500);
  });

  it("bulkDeleteBookmarks of 100 items from 500-bookmark state < 300ms", async () => {
    setStoreState(makeBaseState(500));
    const idsToDelete = Array.from({ length: 100 }, (_, i) => `bk-${i}`);
    const start = performance.now();
    await bulkDeleteBookmarks(idsToDelete);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(300);
    const state = await getState();
    expect(Object.keys(state.bookmarks)).toHaveLength(400);
  });

  it("deleteFolderCascade with 200-bookmark subfolder < 500ms", async () => {
    const state = makeBaseState(0);
    (state.folders as Record<string, any>)["target"] = { id: "target", parentId: "root", name: "Target", sortKey: "t", createdAt: 0, updatedAt: 0 };
    for (let i = 0; i < 200; i++) {
      state.bookmarks[`tbk-${i}`] = {
        id: `tbk-${i}`, folderId: "target", type: "PAGE", name: `T ${i}`,
        url: `https://target-${i}.com`, domain: `target-${i}.com`,
        sortKey: String(i), createdAt: i, updatedAt: i,
      };
    }
    setStoreState(state);

    const start = performance.now();
    await deleteFolderCascade("target");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    const finalState = await getState();
    expect(Object.values(finalState.bookmarks).filter((b: any) => b.folderId === "target")).toHaveLength(0);
  });
});

// ── Search performance ──

describe("Search — performance at scale", () => {
  it("search over 1000 bookmarks with 3-char query < 100ms", () => {
    const state = makeBaseState(1000);
    const bookmarks = Object.values(state.bookmarks);

    const start = performance.now();
    const results = searchBookmarks(bookmarks, "example-5");
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(results.length).toBeGreaterThan(0);
  });

  it("search results are stable (same query → same count)", () => {
    const state = makeBaseState(500);
    const bookmarks = Object.values(state.bookmarks);
    const r1 = searchBookmarks(bookmarks, "example");
    const r2 = searchBookmarks(bookmarks, "example");
    expect(r1.length).toBe(r2.length);
  });

  it("empty query returns all bookmarks", () => {
    const state = makeBaseState(200);
    const bookmarks = Object.values(state.bookmarks);
    const results = searchBookmarks(bookmarks, "");
    expect(results.length).toBe(200);
  });
});

// ── Anchor matching: large text ──

describe("Anchor matching — performance", () => {
  it("normalizeText on 50k-char string completes < 50ms", () => {
    const bigText = "Hello World ".repeat(4200); // ~50k chars
    const start = performance.now();
    const result = normalizeText(bigText);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(result.length).toBeGreaterThan(0);
  });

  it("jaroWinklerSimilarity called 500 times < 200ms", () => {
    const a = "the quick brown fox jumps over";
    const b = "the quick brown fax jumps over";
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      jaroWinklerSimilarity(a, b);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it("computeSnippetHash called 1000 times < 100ms", () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      computeSnippetHash(`https://example-${i}.com/page`, `snippet text ${i}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it("computeSnippetHash is stable (same inputs → same output)", () => {
    const h1 = computeSnippetHash("https://example.com", "hello world");
    const h2 = computeSnippetHash("https://example.com", "hello world");
    expect(h1).toBe(h2);
  });

  it("computeSnippetHash differs for different inputs", () => {
    const h1 = computeSnippetHash("https://example.com", "hello world");
    const h2 = computeSnippetHash("https://example.com", "goodbye world");
    const h3 = computeSnippetHash("https://different.com", "hello world");
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

// ── Recents performance ──

describe("Recents — performance", () => {
  it("computeFolderLabel called 1000 times < 50ms", async () => {
    const folders: Record<string, any> = {};
    // Create 50 folders with parents
    for (let i = 0; i < 50; i++) {
      folders[`p${i}`] = { id: `p${i}`, parentId: "root", name: `Parent ${i}`, sortKey: String(i), createdAt: i, updatedAt: i };
      folders[`c${i}`] = { id: `c${i}`, parentId: `p${i}`, name: `Child ${i}`, sortKey: String(i), createdAt: i, updatedAt: i };
    }
    folders["root"] = { id: "root", parentId: null, name: "ZeroPin", sortKey: "m", createdAt: 0, updatedAt: 0 };

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      computeFolderLabel(`c${i % 50}`, folders);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it("updateRecents 100 times (dedup stress) < 500ms", async () => {
    setStoreState({
      schemaVersion: SCHEMA_VERSION,
      rootFolderId: "root",
      folders: { root: { id: "root", parentId: null, name: "ZP", sortKey: "m", createdAt: 0, updatedAt: 0 } },
      bookmarks: {},
    });
    store["zp_recents"] = [];

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await updateRecents(`folder-${i % 10}`); // 10 unique folders, cycling through them
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);

    const ids = await getRecentFolderIds();
    expect(ids).toHaveLength(RECENTS_MAX);
  });
});

// ── Import parsing performance ──

describe("Import parsing — performance", () => {
  it("parseBrowserHtml on 500-bookmark Netscape HTML < 1000ms", () => {
    const bkLines = Array.from({ length: 500 }, (_, i) =>
      `<DT><A HREF="https://site-${i}.example.com" ADD_DATE="${i}">Site ${i} Title</A>`
    ).join("\n");

    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${bkLines}
</DL>`;

    const start = performance.now();
    const { bookmarks } = parseBrowserHtml(html);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(bookmarks).toHaveLength(500);
  });

  it("BOOKMARK_CAP is defined and positive", () => {
    expect(BOOKMARK_CAP).toBeGreaterThan(0);
    expect(typeof BOOKMARK_CAP).toBe("number");
  });
});

// ── Concurrent storage writes ──

describe("Concurrent operations", () => {
  it("10 sequential addPageBookmark calls result in correct count", async () => {
    setStoreState(makeBaseState(0));
    for (let i = 0; i < 10; i++) {
      await addPageBookmark(`https://unique-${i}.example.com`, `Page ${i}`);
    }
    const state = await getState();
    expect(Object.keys(state.bookmarks)).toHaveLength(10);
  });

  it("createFolder 20 times produces 20 distinct folder ids", async () => {
    setStoreState(makeBaseState(0));
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const id = await createFolder({ parentId: "root", name: `Folder ${i}` });
      ids.add(id);
    }
    expect(ids.size).toBe(20);
  });
});
