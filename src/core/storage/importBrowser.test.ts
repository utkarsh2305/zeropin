import { describe, it, expect, beforeEach } from "vitest";

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
  detectBrowserSource,
  browserSourceLabel,
  parseBrowserHtml,
  buildImportPreview,
  commitBrowserImport,
  BOOKMARK_CAP,
} from "./importBrowser";
import type { BrowserSource } from "./importBrowser";
import { SCHEMA_VERSION } from "../types";

// ── Helpers ──

function makeLibraryState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    rootFolderId: "root",
    folders: {
      root: { id: "root", parentId: null, name: "ZeroPin", sortKey: "m", createdAt: 1000, updatedAt: 1000 },
    },
    bookmarks: {},
  };
}

function setStoreState(state: any) {
  store = { zp_state: state };
}

// Netscape bookmark format (used by Chrome, Firefox, Safari export)
function makeNetscapeHtml(bookmarks: Array<{ title: string; href: string; addDate?: number }>, folderName?: string): string {
  const bkList = bookmarks.map(({ title, href, addDate }) =>
    `<DT><A HREF="${href}"${addDate ? ` ADD_DATE="${addDate}"` : ""}>${title}</A>`
  ).join("\n");

  if (folderName) {
    return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
<DT><H3>Bookmarks Bar</H3>
<DL><p>
<DT><H3>${folderName}</H3>
<DL><p>
${bkList}
</DL><p>
</DL><p>
</DL>`;
  }

  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${bkList}
</DL>`;
}

beforeEach(() => {
  store = {};
  setStoreState(makeLibraryState());
});

// ── detectBrowserSource ──

describe("detectBrowserSource", () => {
  it("detects Chrome from NETSCAPE-Bookmark string", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL></DL>`;
    expect(detectBrowserSource(html)).toBe("chrome");
  });

  it("detects Firefox from 'mozilla firefox' in header", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->
<!-- Mozilla Firefox -->
<DL></DL>`;
    expect(detectBrowserSource(html)).toBe("firefox");
  });

  it("detects Edge from 'microsoft edge' in header", () => {
    const html = `<!-- Exported from Microsoft Edge -->
<!DOCTYPE NETSCAPE-Bookmark-file-1><DL></DL>`;
    expect(detectBrowserSource(html)).toBe("edge");
  });

  it("returns 'unknown' for unrecognised format", () => {
    expect(detectBrowserSource("<html><body>hello</body></html>")).toBe("unknown");
  });

  it("detects Safari from 'Apple' + 'Safari' in header", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- Exported by Apple Safari -->
<DL></DL>`;
    expect(detectBrowserSource(html)).toBe("safari");
  });
});

// ── browserSourceLabel ──

describe("browserSourceLabel", () => {
  it.each([
    ["chrome", "Chrome"],
    ["firefox", "Firefox"],
    ["safari", "Safari"],
    ["edge", "Edge"],
    ["unknown", "Browser"],
  ] as Array<[BrowserSource, string]>)("maps '%s' to '%s'", (source, label) => {
    expect(browserSourceLabel(source)).toBe(label);
  });
});

// ── parseBrowserHtml ──

describe("parseBrowserHtml", () => {
  it("parses a simple bookmark list", () => {
    const html = makeNetscapeHtml([
      { title: "GitHub", href: "https://github.com" },
      { title: "Google", href: "https://google.com" },
    ]);
    const { bookmarks, folders } = parseBrowserHtml(html);
    expect(bookmarks).toHaveLength(2);
    expect(bookmarks.some((b) => b.url === "https://github.com")).toBe(true);
    expect(bookmarks.some((b) => b.url === "https://google.com")).toBe(true);
    expect(folders).toHaveLength(0);
  });

  it("skips non-http/https bookmarks", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><A HREF="javascript:void(0)">JS Link</A>
<DT><A HREF="ftp://files.example.com">FTP</A>
<DT><A HREF="https://valid.com">Valid</A>
</DL>`;
    const { bookmarks } = parseBrowserHtml(html);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].url).toBe("https://valid.com");
  });

  it("extracts ADD_DATE as addDate (multiplied by 1000)", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><A HREF="https://example.com" ADD_DATE="1700000000">Example</A>
</DL>`;
    const { bookmarks } = parseBrowserHtml(html);
    expect(bookmarks[0].addDate).toBe(1700000000 * 1000);
  });

  it("falls back to href when title is empty", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><A HREF="https://example.com"></A>
</DL>`;
    const { bookmarks } = parseBrowserHtml(html);
    expect(bookmarks[0].name).toBe("https://example.com");
  });

  it("trims whitespace from bookmark titles", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><A HREF="https://example.com">  Padded Title  </A>
</DL>`;
    const { bookmarks } = parseBrowserHtml(html);
    expect(bookmarks[0].name).toBe("Padded Title");
  });

  it("parses nested folders and creates folder hierarchy", () => {
    const html = makeNetscapeHtml([
      { title: "Site", href: "https://site.example.com" },
    ], "Work Stuff");
    const { bookmarks, folders } = parseBrowserHtml(html);
    expect(folders.length).toBeGreaterThan(0);
    // "Work Stuff" folder should exist
    const workFolder = folders.find((f) => f.name === "Work Stuff");
    expect(workFolder).toBeDefined();
    // The bookmark should be in the "Work Stuff" folder
    const bk = bookmarks.find((b) => b.url === "https://site.example.com");
    expect(bk?.folderTempId).toBe(workFolder?.tempId);
  });

  it("handles empty HTML gracefully", () => {
    const { bookmarks, folders } = parseBrowserHtml("");
    expect(bookmarks).toHaveLength(0);
    expect(folders).toHaveLength(0);
  });

  it("handles malformed HTML without throwing", () => {
    expect(() => parseBrowserHtml("<this is not valid>")).not.toThrow();
  });

  it("ignores H3 folder nodes themselves as bookmarks", () => {
    const html = makeNetscapeHtml([{ title: "Real Link", href: "https://example.com" }], "My Folder");
    const { bookmarks } = parseBrowserHtml(html);
    // No bookmark should have a folder name as its name
    expect(bookmarks.every((b) => b.name !== "My Folder")).toBe(true);
  });

  it("assigns null folderTempId for top-level bookmarks", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><A HREF="https://toplevel.com">Top Level</A>
</DL>`;
    const { bookmarks } = parseBrowserHtml(html);
    expect(bookmarks[0].folderTempId).toBeNull();
  });
});

// ── buildImportPreview ──

describe("buildImportPreview", () => {
  it("returns correct newCount and dupCount", async () => {
    // Add one existing bookmark to storage
    const state = makeLibraryState();
    (state.bookmarks as any)["existing-1"] = {
      id: "existing-1", folderId: "root", type: "PAGE", name: "GitHub",
      url: "https://github.com", domain: "github.com",
      sortKey: "1", createdAt: 1, updatedAt: 1,
    };
    setStoreState(state);

    const parsed = {
      folders: [],
      bookmarks: [
        { folderTempId: null, name: "GitHub", url: "https://github.com" }, // dup
        { folderTempId: null, name: "Google", url: "https://google.com" }, // new
      ],
    };
    const preview = await buildImportPreview(parsed, "chrome");
    expect(preview.newCount).toBe(1);
    expect(preview.dupCount).toBe(1);
    expect(preview.parsedBookmarkCount).toBe(2);
    expect(preview.source).toBe("chrome");
  });

  it("is case-insensitive when checking for duplicates", async () => {
    const state = makeLibraryState();
    (state.bookmarks as any)["existing-1"] = {
      id: "existing-1", folderId: "root", type: "PAGE", name: "Ex",
      url: "https://EXAMPLE.COM", domain: "example.com",
      sortKey: "1", createdAt: 1, updatedAt: 1,
    };
    setStoreState(state);

    const parsed = {
      folders: [],
      bookmarks: [{ folderTempId: null, name: "Ex", url: "https://example.com" }],
    };
    const preview = await buildImportPreview(parsed, "chrome");
    expect(preview.dupCount).toBe(1);
    expect(preview.newCount).toBe(0);
  });
});

// ── commitBrowserImport ──

describe("commitBrowserImport", () => {
  it("imports bookmarks and creates container folder", async () => {
    const parsed = parseBrowserHtml(makeNetscapeHtml([
      { title: "Site A", href: "https://sitea.example.com" },
      { title: "Site B", href: "https://siteb.example.com" },
    ]));

    const result = await commitBrowserImport(parsed.folders, parsed.bookmarks, "chrome", false);
    expect(result.imported).toBe(2);
    expect(result.dupSkipped).toBe(0);
    expect(result.capSkipped).toBe(0);

    // Check state has the container folder
    const { getState } = await import("./local");
    const state = await getState();
    const importedFolders = Object.values(state.folders).filter((f) =>
      f.name.includes("Chrome Import")
    );
    expect(importedFolders).toHaveLength(1);
    expect(Object.keys(state.bookmarks)).toHaveLength(2);
  });

  it("skips duplicates when includeDups=false", async () => {
    // Pre-populate with one existing bookmark
    const state = makeLibraryState();
    (state.bookmarks as any)["dup-1"] = {
      id: "dup-1", folderId: "root", type: "PAGE", name: "Site A",
      url: "https://sitea.example.com", domain: "sitea.example.com",
      sortKey: "1", createdAt: 1, updatedAt: 1,
    };
    setStoreState(state);

    const parsed = parseBrowserHtml(makeNetscapeHtml([
      { title: "Site A", href: "https://sitea.example.com" }, // dup
      { title: "Site B", href: "https://siteb.example.com" }, // new
    ]));

    const result = await commitBrowserImport(parsed.folders, parsed.bookmarks, "chrome", false);
    expect(result.imported).toBe(1);
    expect(result.dupSkipped).toBe(1);
  });

  it("imports duplicates when includeDups=true", async () => {
    const state = makeLibraryState();
    (state.bookmarks as any)["dup-1"] = {
      id: "dup-1", folderId: "root", type: "PAGE", name: "Site A",
      url: "https://sitea.example.com", domain: "sitea.example.com",
      sortKey: "1", createdAt: 1, updatedAt: 1,
    };
    setStoreState(state);

    const parsed = parseBrowserHtml(makeNetscapeHtml([
      { title: "Site A", href: "https://sitea.example.com" },
    ]));

    const result = await commitBrowserImport(parsed.folders, parsed.bookmarks, "chrome", true);
    expect(result.imported).toBe(1);
    expect(result.dupSkipped).toBe(0);
  });

  it("respects BOOKMARK_CAP — skips bookmarks beyond the cap", async () => {
    // Fill storage to BOOKMARK_CAP - 1
    const state = makeLibraryState();
    const existingCount = BOOKMARK_CAP - 1;
    for (let i = 0; i < existingCount; i++) {
      (state.bookmarks as any)[`bk-${i}`] = {
        id: `bk-${i}`, folderId: "root", type: "PAGE", name: `BK ${i}`,
        url: `https://existing-${i}.example.com`, domain: "example.com",
        sortKey: String(i), createdAt: i, updatedAt: i,
      };
    }
    setStoreState(state);

    const parsed = parseBrowserHtml(makeNetscapeHtml([
      { title: "First", href: "https://first.example.com" },    // fits (cap-1 existing + 1 = cap)
      { title: "Second", href: "https://second.example.com" },  // exceeds cap
    ]));

    const result = await commitBrowserImport(parsed.folders, parsed.bookmarks, "chrome", false);
    expect(result.imported).toBe(1);
    expect(result.capSkipped).toBe(1);
  });

  it("creates correct source label in container folder name", async () => {
    const parsed = parseBrowserHtml(makeNetscapeHtml([{ title: "FF", href: "https://firefox.com" }]));
    await commitBrowserImport(parsed.folders, parsed.bookmarks, "firefox", false);

    const { getState } = await import("./local");
    const state = await getState();
    const containerFolder = Object.values(state.folders).find((f) => f.name.includes("Firefox Import"));
    expect(containerFolder).toBeDefined();
  });

  it("assigns imported bookmarks to subfolders when folders present", async () => {
    const html = makeNetscapeHtml([{ title: "Work Site", href: "https://work.example.com" }], "Work");
    const parsed = parseBrowserHtml(html);
    await commitBrowserImport(parsed.folders, parsed.bookmarks, "chrome", false);

    const { getState } = await import("./local");
    const state = await getState();
    const workFolder = Object.values(state.folders).find((f) => f.name === "Work");
    expect(workFolder).toBeDefined();
    const bkms = Object.values(state.bookmarks).filter((b) => b.url === "https://work.example.com");
    expect(bkms[0].folderId).toBe(workFolder!.id);
  });
});
