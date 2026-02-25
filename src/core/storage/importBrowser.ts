import { getState, setState } from "./local";

export type BrowserSource = "chrome" | "firefox" | "safari" | "edge" | "unknown";

export interface ParsedFolder {
  tempId: string;
  parentTempId: string | null;
  name: string;
  addDate?: number;
}

export interface ParsedBookmark {
  folderTempId: string | null;
  name: string;
  url: string;
  addDate?: number;
}

export interface BrowserImportPreview {
  source: BrowserSource;
  parsedFolderCount: number;
  parsedBookmarkCount: number;
  newCount: number;
  dupCount: number;
  currentBookmarkCount: number;
  _folders: ParsedFolder[];
  _bookmarks: ParsedBookmark[];
}

export const BOOKMARK_CAP = 3000;

export function detectBrowserSource(html: string): BrowserSource {
  const head = html.slice(0, 3000);
  if (/mozilla firefox/i.test(head) || /open it in firefox/i.test(head)) return "firefox";
  if (/microsoft edge/i.test(head)) return "edge";
  if (/apple/i.test(head) && /safari/i.test(head)) return "safari";
  if (/netscape-bookmark/i.test(head)) return "chrome";
  return "unknown";
}

export function browserSourceLabel(source: BrowserSource): string {
  switch (source) {
    case "chrome": return "Chrome";
    case "firefox": return "Firefox";
    case "safari": return "Safari";
    case "edge": return "Edge";
    default: return "Browser";
  }
}

let _counter = 0;
function nextTempId(): string {
  return `_t${++_counter}`;
}

function walkDl(
  dl: Element,
  parentTempId: string | null,
  folders: ParsedFolder[],
  bookmarks: ParsedBookmark[],
): void {
  const children = Array.from(dl.children);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.tagName !== "DT") continue;

    const h3 = child.querySelector("h3");
    const a = child.querySelector("a");

    if (h3) {
      const tid = nextTempId();
      const addAttr = h3.getAttribute("add_date");
      folders.push({
        tempId: tid,
        parentTempId,
        name: h3.textContent?.trim() || "Untitled Folder",
        addDate: addAttr ? parseInt(addAttr) * 1000 : undefined,
      });
      // Chrome's DOMParser nests <DL> inside <DT>; check there first
      const nestedDlInDt = child.querySelector("dl");
      if (nestedDlInDt) {
        walkDl(nestedDlInDt, tid, folders, bookmarks);
      } else {
        // Fallback: sibling <DL> after the <DT>
        let j = i + 1;
        while (j < children.length && children[j].tagName !== "DL" && children[j].tagName !== "DT") j++;
        if (j < children.length && children[j].tagName === "DL") {
          walkDl(children[j] as Element, tid, folders, bookmarks);
          i = j;
        }
      }
    } else if (a) {
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("http://") && !href.startsWith("https://")) continue;
      const addAttr = a.getAttribute("add_date");
      bookmarks.push({
        folderTempId: parentTempId,
        name: a.textContent?.trim() || href,
        url: href,
        addDate: addAttr ? parseInt(addAttr) * 1000 : undefined,
      });
    }
  }
}

export function parseBrowserHtml(html: string): { folders: ParsedFolder[]; bookmarks: ParsedBookmark[] } {
  try {
    // Strip <script> blocks before parsing so Chrome does not attempt to load
    // external scripts and log CSP violations in the extension error panel.
    const sanitized = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, "text/html");
    const folders: ParsedFolder[] = [];
    const bookmarks: ParsedBookmark[] = [];
    const rootDl = doc.querySelector("dl");
    if (rootDl) walkDl(rootDl, null, folders, bookmarks);
    return { folders, bookmarks };
  } catch {
    return { folders: [], bookmarks: [] };
  }
}

export async function buildImportPreview(
  parsed: { folders: ParsedFolder[]; bookmarks: ParsedBookmark[] },
  source: BrowserSource,
): Promise<BrowserImportPreview> {
  const state = await getState();
  const existingUrls = new Set(Object.values(state.bookmarks).map((b) => b.url.toLowerCase()));
  const currentBookmarkCount = Object.keys(state.bookmarks).length;

  let newCount = 0;
  let dupCount = 0;
  for (const pb of parsed.bookmarks) {
    if (existingUrls.has(pb.url.toLowerCase())) {
      dupCount++;
    } else {
      newCount++;
    }
  }

  return {
    source,
    parsedFolderCount: parsed.folders.length,
    parsedBookmarkCount: parsed.bookmarks.length,
    newCount,
    dupCount,
    currentBookmarkCount,
    _folders: parsed.folders,
    _bookmarks: parsed.bookmarks,
  };
}

export async function commitBrowserImport(
  folders: ParsedFolder[],
  bookmarks: ParsedBookmark[],
  source: BrowserSource,
  includeDups: boolean,
): Promise<{ imported: number; dupSkipped: number; capSkipped: number }> {
  const state = await getState();
  const currentCount = Object.keys(state.bookmarks).length;
  const existingUrls = new Set(Object.values(state.bookmarks).map((b) => b.url.toLowerCase()));

  const ts = Date.now();
  const label = browserSourceLabel(source);
  const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Create container folder under root
  const containerId = crypto.randomUUID();
  state.folders[containerId] = {
    id: containerId,
    parentId: state.rootFolderId,
    name: `${label} Import — ${dateStr}`,
    sortKey: String(ts + 1),
    createdAt: ts,
    updatedAt: ts,
  };

  // Create subfolders; map tempId → real folderId
  const folderMap = new Map<string, string>();
  for (const pf of folders) {
    const parentId = pf.parentTempId ? (folderMap.get(pf.parentTempId) ?? containerId) : containerId;
    const fid = crypto.randomUUID();
    state.folders[fid] = {
      id: fid,
      parentId,
      name: pf.name,
      sortKey: String(pf.addDate ?? ts),
      createdAt: pf.addDate ?? ts,
      updatedAt: pf.addDate ?? ts,
    };
    folderMap.set(pf.tempId, fid);
  }

  let imported = 0;
  let dupSkipped = 0;
  let capSkipped = 0;
  const remaining = BOOKMARK_CAP - currentCount;

  for (const pb of bookmarks) {
    const isDup = existingUrls.has(pb.url.toLowerCase());
    if (isDup && !includeDups) {
      dupSkipped++;
      continue;
    }
    if (imported >= remaining) {
      capSkipped++;
      continue;
    }

    const folderId = pb.folderTempId ? (folderMap.get(pb.folderTempId) ?? containerId) : containerId;
    const id = crypto.randomUUID();
    const domain = (() => { try { return new URL(pb.url).hostname; } catch { return ""; } })();
    const bts = pb.addDate ?? ts;

    state.bookmarks[id] = {
      id,
      folderId,
      type: "PAGE",
      name: pb.name,
      url: pb.url,
      domain,
      sortKey: String(bts),
      createdAt: bts,
      updatedAt: bts,
    };
    existingUrls.add(pb.url.toLowerCase());
    imported++;
  }

  await setState(state);
  return { imported, dupSkipped, capSkipped };
}
