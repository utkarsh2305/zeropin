import type { LibraryState } from "../types";
import { SCHEMA_VERSION } from "../types";

type Migration = (state: any) => any;

/**
 * Registry of migrations. Each entry migrates from version N to N+1.
 * Migrations must be idempotent, additive, and never delete user data.
 */
const migrations: Record<number, Migration> = {
  // v0 → v1: ensure bookmarks dict exists
  0: (state) => {
    if (!state.bookmarks) state.bookmarks = {};
    state.schemaVersion = 1;
    return state;
  },
  // v1 → v2: add notes field default to each bookmark
  1: (state) => {
    for (const b of Object.values(state.bookmarks) as any[]) {
      if (b.notes === undefined) b.notes = "";
    }
    state.schemaVersion = 2;
    return state;
  },
  // v2 → v3: add snippetHash for bookmarks (computed lazily on next add)
  2: (state) => {
    for (const b of Object.values(state.bookmarks) as any[]) {
      if (b.snippetHash === undefined) {
        b.snippetHash = undefined;
      }
    }
    state.schemaVersion = 3;
    return state;
  },
  // v3 → v4: add analytics fields (openCount, lastOpenedAt, lastResolvedConfidence)
  3: (state) => {
    for (const b of Object.values(state.bookmarks) as any[]) {
      if (b.openCount === undefined) b.openCount = 0;
      if (b.lastOpenedAt === undefined) b.lastOpenedAt = 0;
      if (b.lastResolvedConfidence === undefined) b.lastResolvedConfidence = undefined;
    }
    state.schemaVersion = 4;
    return state;
  },
  // v4 → v5: add color field to folders (undefined = default theme color)
  4: (state) => {
    if (state.folders) {
      for (const f of Object.values(state.folders) as any[]) {
        if (f.color === undefined) f.color = undefined;
      }
    }
    state.schemaVersion = 5;
    return state;
  },
  // v5 → v6: remove Inbox system folder; move its bookmarks directly to root
  5: (state) => {
    const inboxId: string | undefined = state.inboxFolderId;
    if (inboxId && state.folders[inboxId]) {
      // Re-home all inbox bookmarks to root
      for (const b of Object.values(state.bookmarks) as any[]) {
        if (b.folderId === inboxId) b.folderId = state.rootFolderId;
      }
      // Delete the inbox folder
      delete state.folders[inboxId];
      // Reset lastUsedFolderId if it was pointing at inbox
      if (state.lastUsedFolderId === inboxId) {
        state.lastUsedFolderId = state.rootFolderId;
      }
    }
    delete state.inboxFolderId;
    state.schemaVersion = 6;
    return state;
  },
};

/**
 * Migrates a raw storage object to the current schema version.
 * - Missing schemaVersion → treated as v0
 * - Future version > current → accepted as-is (no downgrade)
 * - Applies migrations sequentially up to SCHEMA_VERSION
 */
export function migrateState(raw: any): LibraryState {
  if (raw.schemaVersion == null) raw.schemaVersion = 0;

  // Future version: accept as-is, do not downgrade
  if (raw.schemaVersion > SCHEMA_VERSION) return raw as LibraryState;

  // Apply migrations sequentially
  while (raw.schemaVersion < SCHEMA_VERSION) {
    const fn = migrations[raw.schemaVersion];
    if (!fn) break;
    raw = fn(raw);
  }

  return raw as LibraryState;
}
