import type { LibraryState, BookmarkMedia } from "../types";
import { SCHEMA_VERSION } from "../types";
import { migrateState } from "./migrate";

const KEY = "zp_state";
const OLD_KEY = "zr_library_state";
const now = () => Date.now();

/** Promise wrapper around chrome.storage.local.get */
function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (items) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve(items[key] as T | undefined);
    });
  });
}

/** Promise wrapper around chrome.storage.local.set */
function storageSet<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function getState(): Promise<LibraryState> {
  let state = await storageGet<LibraryState>(KEY);

  // Migration: read from old key if new key is empty
  if (!state) {
    const old = await storageGet<LibraryState>(OLD_KEY);
    if (old) {
      await storageSet(KEY, old);
      chrome.storage.local.remove(OLD_KEY);
      state = old;
    }
  }

  if (state) {
    // Run versioned migrations
    const migrated = migrateState(state);
    if (migrated.schemaVersion !== state.schemaVersion) {
      await storageSet(KEY, migrated);
    }

    return migrated;
  }

  const rootId = crypto.randomUUID();
  const now_ts = now();

  const initial: LibraryState = {
    schemaVersion: SCHEMA_VERSION,
    rootFolderId: rootId,
    folders: {
      [rootId]: {
        id: rootId,
        parentId: null,
        name: "ZeroPin",
        sortKey: "m",
        createdAt: now_ts,
        updatedAt: now_ts,
      },
    },
    bookmarks: {},
    lastUsedFolderId: rootId,
  };

  await storageSet(KEY, initial);

  return initial;
}

export async function setState(next: LibraryState): Promise<void> {
  await storageSet(KEY, next);
}

/** Normalize a URL for dedup: lowercase, strip trailing slash and fragment. */
function normalizeUrlForHash(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    let s = u.href.toLowerCase();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
  }
}

/** djb2 hash → hex string */
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

/** Compute a stable hash for dedup. */
export function computeSnippetHash(url: string, snippetText?: string): string {
  const normUrl = normalizeUrlForHash(url);
  const normText = snippetText ? snippetText.toLowerCase().trim() : "PAGE";
  return djb2(normUrl + "||" + normText);
}

export async function addPageBookmark(url: string, title: string, media?: BookmarkMedia, inputFolderId?: string): Promise<void> {
  const state = await getState();
  // Fall back to root if the requested folder no longer exists
  const folderId = (inputFolderId && state.folders[inputFolderId])
    ? inputFolderId
    : state.rootFolderId;
  const hash = computeSnippetHash(url);

  // Dedup: check for existing bookmark with same hash in same folder
  const existing = Object.values(state.bookmarks).find(
    (b) => b.folderId === folderId && b.snippetHash === hash
  );
  if (existing) {
    existing.updatedAt = now();
    await setState(state);
    return;
  }

  const id = crypto.randomUUID();
  const domain = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  const ts = now();
  state.bookmarks[id] = {
    id,
    folderId,
    type: "PAGE",
    name: title || url,
    url,
    domain,
    sortKey: String(ts),
    createdAt: ts,
    updatedAt: ts,
    snippetHash: hash,
    ...(media !== undefined ? { media } : {}),
  };

  await setState(state);
}

export async function addSelectionBookmark(input: {
  url: string;
  title: string;
  selectedText: string;
  contextBefore?: string;
  contextAfter?: string;
  folderId?: string;
  anchor?: {
    text: string;
    prefix?: string;
    suffix?: string;
    startOffset?: number;
    endOffset?: number;
    capturedAt?: number;
    fingerprint?: {
      head: string;
      mid: string;
      tail: string;
      length: number;
    };
    chatContext?: {
      platform: "chatgpt" | "claude" | "unknown";
      conversationId?: string;
      conversationTitle?: string;
      messageIndex?: number;
      role?: "user" | "assistant";
      messageId?: string;
      turnHash?: string;
      startOffsetInMessage?: number;
      endOffsetInMessage?: number;
    };
    containerHint?: {
      cssPath?: string;
      xpath?: string;
      containerTextSample?: string;
    };
    repairedAt?: number;
  };
}): Promise<void> {
  const state = await getState();
  // Fall back to root if the requested folder no longer exists
  const folderId = (input.folderId && state.folders[input.folderId])
    ? input.folderId
    : state.rootFolderId;
  const hash = computeSnippetHash(input.url, input.selectedText);

  // Dedup: check for existing bookmark with same hash in same folder
  const existing = Object.values(state.bookmarks).find(
    (b) => b.folderId === folderId && b.snippetHash === hash
  );
  if (existing) {
    existing.updatedAt = now();
    await setState(state);
    return;
  }

  const id = crypto.randomUUID();
  const domain = (() => {
    try {
      return new URL(input.url).hostname;
    } catch {
      return "";
    }
  })();

  const ts = now();
  
  // If anchor provided, use it (ensuring text is always populated); otherwise construct from selectedText
  const snippet = input.anchor
    ? { ...input.anchor, text: input.anchor.text || input.selectedText }
    : {
        text: input.selectedText,
        contextBefore: input.contextBefore,
        contextAfter: input.contextAfter,
      };

  state.bookmarks[id] = {
    id,
    folderId,
    type: "SNIPPET",
    name: input.title,
    url: input.url,
    domain,
    sortKey: String(ts),
    createdAt: ts,
    updatedAt: ts,
    snippetHash: hash,
    snippet,
  };

  await setState(state);
}

export async function createFolder(input: { parentId: string; name: string; color?: string }): Promise<string> {
  const state = await getState();
  const id = crypto.randomUUID();
  const ts = now();

  state.folders[id] = {
    id,
    parentId: input.parentId,
    name: input.name,
    sortKey: String(ts),
    createdAt: ts,
    updatedAt: ts,
    color: input.color,
  };

  await setState(state);
  return id;
}

export async function renameFolder(folderId: string, name: string): Promise<void> {
  const state = await getState();
  const folder = state.folders[folderId];
  if (!folder) throw new Error(`Folder ${folderId} not found`);

  folder.name = name;
  folder.updatedAt = now();

  await setState(state);
}

export async function setFolderColor(folderId: string, color: string | undefined): Promise<void> {
  const state = await getState();
  const folder = state.folders[folderId];
  if (!folder) throw new Error(`Folder ${folderId} not found`);

  folder.color = color;
  folder.updatedAt = now();

  await setState(state);
}

export async function deleteFolderIfEmpty(folderId: string): Promise<void> {
  const state = await getState();
  if (!state.folders[folderId]) throw new Error(`Folder ${folderId} not found`);

  // Check if folder has children
  const hasChildren = Object.values(state.folders).some((f) => f.parentId === folderId);
  if (hasChildren) throw new Error(`Folder has child folders`);

  // Check if folder has bookmarks
  const hasBookmarks = Object.values(state.bookmarks).some((b) => b.folderId === folderId);
  if (hasBookmarks) throw new Error(`Folder has bookmarks`);

  delete state.folders[folderId];
  await setState(state);
}

export async function deleteFolderCascade(folderId: string): Promise<void> {
  const state = await getState();
  if (!state.folders[folderId]) throw new Error(`Folder ${folderId} not found`);
  if (folderId === state.rootFolderId) throw new Error("Cannot delete root folder");

  // Collect target + all descendant folder IDs
  const toDelete = new Set<string>();
  const collect = (id: string) => {
    toDelete.add(id);
    for (const f of Object.values(state.folders)) {
      if (f.parentId === id) collect(f.id);
    }
  };
  collect(folderId);

  // Delete bookmarks in those folders
  for (const b of Object.values(state.bookmarks)) {
    if (toDelete.has(b.folderId)) delete state.bookmarks[b.id];
  }
  // Delete folders
  for (const id of toDelete) delete state.folders[id];

  // Reset lastUsedFolderId if it was deleted
  if (state.lastUsedFolderId && toDelete.has(state.lastUsedFolderId)) {
    state.lastUsedFolderId = state.rootFolderId;
  }

  await setState(state);
}

export async function renameBookmark(bookmarkId: string, name: string): Promise<void> {
  const state = await getState();
  const bookmark = state.bookmarks[bookmarkId];
  if (!bookmark) throw new Error(`Bookmark ${bookmarkId} not found`);

  bookmark.name = name;
  bookmark.updatedAt = now();

  await setState(state);
}

export async function setBookmarkNotes(bookmarkId: string, notes: string): Promise<void> {
  const state = await getState();
  const bookmark = state.bookmarks[bookmarkId];
  if (!bookmark) throw new Error(`Bookmark ${bookmarkId} not found`);

  bookmark.notes = notes;
  bookmark.updatedAt = now();

  await setState(state);
}

export async function deleteBookmark(bookmarkId: string): Promise<void> {
  const state = await getState();
  if (!state.bookmarks[bookmarkId]) throw new Error(`Bookmark ${bookmarkId} not found`);

  delete state.bookmarks[bookmarkId];
  await setState(state);
}

export async function moveBookmark(bookmarkId: string, folderId: string): Promise<void> {
  const state = await getState();
  const bookmark = state.bookmarks[bookmarkId];
  if (!bookmark) throw new Error(`Bookmark ${bookmarkId} not found`);
  if (!state.folders[folderId]) throw new Error(`Folder ${folderId} not found`);

  bookmark.folderId = folderId;
  bookmark.updatedAt = now();

  await setState(state);
}

export async function moveBookmarkWithinFolder(
  bookmarkId: string,
  direction: "UP" | "DOWN"
): Promise<void> {
  const state = await getState();
  const bookmark = state.bookmarks[bookmarkId];
  if (!bookmark) return;

  // Get siblings sorted by sortKey descending (newest first)
  const siblings = Object.values(state.bookmarks)
    .filter((b) => b.folderId === bookmark.folderId)
    .sort((a, b) => Number(b.sortKey) - Number(a.sortKey));

  const idx = siblings.findIndex((b) => b.id === bookmarkId);
  const swapIdx = direction === "UP" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;

  // Swap sortKeys to swap positions
  const tmpKey = bookmark.sortKey;
  state.bookmarks[bookmarkId].sortKey = siblings[swapIdx].sortKey;
  state.bookmarks[siblings[swapIdx].id].sortKey = tmpKey;

  await setState(state);
}

export async function reorderBookmarks(orderedIds: string[]): Promise<void> {
  const state = await getState();
  // Assign descending sortKeys so index 0 = highest (newest-first display)
  const base = now();
  for (let i = 0; i < orderedIds.length; i++) {
    const bm = state.bookmarks[orderedIds[i]];
    if (bm) bm.sortKey = String(base - i);
  }
  await setState(state);
}

export async function moveFolderToParent(folderId: string, newParentId: string): Promise<void> {
  const state = await getState();
  const folder = state.folders[folderId];
  if (!folder) throw new Error(`Folder ${folderId} not found`);
  if (!state.folders[newParentId]) throw new Error(`Parent folder ${newParentId} not found`);
  if (folderId === newParentId) return;
  if (folderId === state.rootFolderId) throw new Error("Cannot move root folder");

  // Prevent circular reference: walk up from newParentId ensuring folderId is not an ancestor
  let current: string | null = newParentId;
  while (current) {
    if (current === folderId) throw new Error("Cannot move folder into its own descendant");
    current = state.folders[current]?.parentId ?? null;
  }

  folder.parentId = newParentId;
  folder.updatedAt = now();
  await setState(state);
}

export async function setLastUsedFolder(folderId: string): Promise<void> {
  const state = await getState();
  if (!state.folders[folderId]) throw new Error(`Folder ${folderId} not found`);

  state.lastUsedFolderId = folderId;
  await setState(state);
}

export async function createTag(name: string, color?: string): Promise<string> {
  const state = await getState();
  const id = crypto.randomUUID();
  const ts = now();
  if (!state.tagDefs) state.tagDefs = {};
  state.tagDefs[id] = { id, name, color, createdAt: ts, updatedAt: ts };
  await setState(state);
  return id;
}

export async function renameTag(tagId: string, name: string): Promise<void> {
  const state = await getState();
  const tag = state.tagDefs?.[tagId];
  if (!tag) throw new Error(`Tag ${tagId} not found`);
  tag.name = name;
  tag.updatedAt = now();
  await setState(state);
}

export async function deleteTag(tagId: string): Promise<void> {
  const state = await getState();
  if (!state.tagDefs?.[tagId]) throw new Error(`Tag ${tagId} not found`);
  delete state.tagDefs[tagId];
  for (const b of Object.values(state.bookmarks)) {
    if (Array.isArray(b.tags)) {
      b.tags = b.tags.filter((t) => t !== tagId);
    }
  }
  await setState(state);
}

export async function setTagColor(tagId: string, color: string | undefined): Promise<void> {
  const state = await getState();
  const tag = state.tagDefs?.[tagId];
  if (!tag) throw new Error(`Tag ${tagId} not found`);
  tag.color = color;
  tag.updatedAt = now();
  await setState(state);
}

export async function setBookmarkTags(bookmarkId: string, tagIds: string[]): Promise<void> {
  const state = await getState();
  const bookmark = state.bookmarks[bookmarkId];
  if (!bookmark) throw new Error(`Bookmark ${bookmarkId} not found`);
  bookmark.tags = tagIds;
  bookmark.updatedAt = now();
  await setState(state);
}

export async function recordBookmarkOpen(id: string): Promise<void> {
  const state = await getState();
  const b = state.bookmarks[id];
  if (!b) return;
  b.openCount = (b.openCount ?? 0) + 1;
  b.lastOpenedAt = Date.now();
  await setState(state);
}

export async function recordAnchorResolution(
  id: string,
  confidence: number,
  repair?: { prefix?: string; suffix?: string; startOffset?: number; endOffset?: number },
): Promise<void> {
  const state = await getState();
  const b = state.bookmarks[id];
  if (!b) return;
  b.lastResolvedConfidence = confidence;

  if (repair && b.snippet) {
    if (repair.prefix !== undefined) b.snippet.prefix = repair.prefix;
    if (repair.suffix !== undefined) b.snippet.suffix = repair.suffix;
    if (repair.startOffset !== undefined) b.snippet.startOffset = repair.startOffset;
    if (repair.endOffset !== undefined) b.snippet.endOffset = repair.endOffset;
    b.snippet.repairedAt = Date.now();
    b.updatedAt = Date.now();
  }

  await setState(state);
}

export async function repairBookmarkAnchor(
  bookmarkId: string,
  updates: {
    prefix?: string;
    suffix?: string;
    startOffset?: number;
    endOffset?: number;
    containerTextSample?: string;
    repairedAt: number;
  },
): Promise<void> {
  const state = await getState();
  const bookmark = state.bookmarks[bookmarkId];
  if (!bookmark || !bookmark.snippet) return;

  if (updates.prefix !== undefined) bookmark.snippet.prefix = updates.prefix;
  if (updates.suffix !== undefined) bookmark.snippet.suffix = updates.suffix;
  if (updates.startOffset !== undefined) bookmark.snippet.startOffset = updates.startOffset;
  if (updates.endOffset !== undefined) bookmark.snippet.endOffset = updates.endOffset;
  if (updates.containerTextSample !== undefined && bookmark.snippet.containerHint) {
    bookmark.snippet.containerHint.containerTextSample = updates.containerTextSample;
  }
  bookmark.snippet.repairedAt = updates.repairedAt;
  bookmark.updatedAt = updates.repairedAt;

  await setState(state);
}

/**
 * Returns the name of the folder where `url` is already pinned,
 * provided it's in a DIFFERENT folder than `targetFolderId`.
 * Returns null if not found or if the existing bookmark is already in the target folder
 * (same-folder dedup is handled silently by addPageBookmark / addSelectionBookmark).
 */
export async function getDuplicateFolderName(url: string, targetFolderId: string): Promise<string | null> {
  const state = await getState();
  const hash = computeSnippetHash(url);
  const existing = Object.values(state.bookmarks).find((b) => b.snippetHash === hash);
  if (!existing) return null;
  if (existing.folderId === targetFolderId) return null;
  return state.folders[existing.folderId]?.name ?? null;
}

export async function bulkDeleteBookmarks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const state = await getState();
  for (const id of ids) {
    delete state.bookmarks[id];
  }
  await setState(state);
}

export async function bulkMoveBookmarks(ids: string[], targetFolderId: string): Promise<void> {
  if (ids.length === 0) return;
  const state = await getState();
  if (!state.folders[targetFolderId]) throw new Error(`Folder ${targetFolderId} not found`);
  const ts = now();
  for (const id of ids) {
    const bm = state.bookmarks[id];
    if (bm) {
      bm.folderId = targetFolderId;
      bm.updatedAt = ts;
    }
  }
  await setState(state);
}

export async function exportState(): Promise<LibraryState> {
  return getState();
}

export async function importState(next: any): Promise<void> {
  const migrated = migrateState(next);
  if (!migrated.folders[migrated.rootFolderId]) {
    throw new Error(`Root folder ${migrated.rootFolderId} not found in folders`);
  }
  await setState(migrated);
}
