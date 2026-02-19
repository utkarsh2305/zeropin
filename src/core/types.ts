export const SCHEMA_VERSION = 4 as const;

export type FolderId = string;
export type BookmarkId = string;

export type BookmarkType = "PAGE" | "SNIPPET";

export interface Folder {
  id: FolderId;
  parentId: FolderId | null;
  name: string;
  sortKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface Bookmark {
  id: BookmarkId;
  folderId: FolderId;
  type: BookmarkType;
  name: string;
  url: string;
  domain: string;
  sortKey: string;
  createdAt: number;
  updatedAt: number;
  notes?: string;
  snippetHash?: string;
  openCount?: number;
  lastOpenedAt?: number;
  lastResolvedConfidence?: number;

  // SNIPPET-only (optional fields)
  snippet?: {
    text: string;
    contextBefore?: string;
    contextAfter?: string;
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
}

export interface LibraryState {
  schemaVersion: number;
  rootFolderId: FolderId;
  inboxFolderId: FolderId;
  folders: Record<FolderId, Folder>;
  bookmarks: Record<BookmarkId, Bookmark>;
  lastUsedFolderId?: FolderId;
}
