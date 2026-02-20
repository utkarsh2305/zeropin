/**
 * Factory functions for test state objects.
 * All factories supply sensible defaults; pass overrides to customise.
 */
import type { LibraryState, Bookmark, Folder } from "../core/types";
import { SCHEMA_VERSION } from "../core/types";

let _seq = 0;
function uid(): string {
  return `test-id-${++_seq}`;
}

export function makeFolder(overrides: Partial<Folder> & { id?: string } = {}): Folder {
  const id = overrides.id ?? uid();
  return {
    id,
    parentId: null,
    name: "ZeroPin",
    sortKey: "1000",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

export function makeBookmark(overrides: Partial<Bookmark> & { id?: string } = {}): Bookmark {
  const id = overrides.id ?? uid();
  return {
    id,
    folderId: "root",
    type: "PAGE",
    name: "Example",
    url: "https://example.com",
    domain: "example.com",
    sortKey: "1000",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  } as Bookmark;
}

export function makeState(overrides: Partial<LibraryState> = {}): LibraryState {
  return {
    schemaVersion: SCHEMA_VERSION,
    rootFolderId: "root",
    folders: {
      root: makeFolder({ id: "root", parentId: null, name: "ZeroPin", sortKey: "m" }),
    },
    bookmarks: {},
    ...overrides,
  };
}
