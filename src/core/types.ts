export const SCHEMA_VERSION = 10 as const;

/** Optional media metadata attached to a bookmark. Currently only "youtube". */
export interface BookmarkMedia {
  kind: "youtube";
  videoId: string;
  /** Playback position in whole seconds; undefined when no timestamp was captured. */
  timestampSec?: number;
  /** Human-readable label e.g. "08:36"; set whenever timestampSec is set. */
  timestampLabel?: string;
  /** Canonical watch URL: https://www.youtube.com/watch?v=ID (no timestamp). */
  canonicalUrl: string;
  /** URL to open: canonicalUrl + &t=SECs if timestampSec set, else canonicalUrl. */
  openUrl: string;
  captureMethod: "video.currentTime" | "urlParam" | "fallback";
}

export type FolderId = string;
export type BookmarkId = string;
export type TagId = string;

export interface TagDef {
  id: TagId;
  name: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export type BookmarkType = "PAGE" | "SNIPPET";

export interface Folder {
  id: FolderId;
  parentId: FolderId | null;
  name: string;
  sortKey: string;
  createdAt: number;
  updatedAt: number;
  color?: string;
  /** Emoji character used as the folder icon, e.g. "✈️". Absent = default folder icon. */
  icon?: string;
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
  tags?: TagId[];
  notes?: string;
  snippetHash?: string;
  openCount?: number;
  lastOpenedAt?: number;
  lastResolvedConfidence?: number;
  /** Unix ms timestamp when this reminder should surface. Absent = no reminder set. */
  reminderAt?: number;
  /** Unix ms timestamp until which this reminder is snoozed. Absent or past = not snoozed. */
  reminderSnoozedUntil?: number;
  /** True if the URL returned 404/410 on the last dead-link check. Absent = not checked or working. */
  isDeadLink?: boolean;
  /** True if the user has marked this bookmark as a favourite. Absent = not a favourite. */
  isFavorite?: boolean;
  /** Unix ms timestamp of the last dead-link check run. */
  deadLinkCheckedAt?: number;

  /** YouTube (or future) media metadata. Present only for YouTube moment pins. */
  media?: BookmarkMedia;

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
      githubLineNumber?: number;
      isCodeViewer?: boolean;
    };
    repairedAt?: number;
  };
}

export interface LibraryState {
  schemaVersion: number;
  rootFolderId: FolderId;
  /** @deprecated Removed in schema v6. Kept optional so migration can read the old value. */
  inboxFolderId?: FolderId;
  folders: Record<FolderId, Folder>;
  bookmarks: Record<BookmarkId, Bookmark>;
  tagDefs?: Record<TagId, TagDef>;
  lastUsedFolderId?: FolderId;
}
