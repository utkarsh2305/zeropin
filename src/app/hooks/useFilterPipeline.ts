import { useMemo } from "react";
import type { LibraryState, Bookmark, Folder, TagDef } from "../../core/types";
import type { Prefs } from "../../core/storage/prefs";
import { AI_CHAT_DOMAINS } from "../../core/constants";

// ── Local helpers ────────────────────────────────────────────────────────────

function isAiDomain(domain: string): boolean {
  return AI_CHAT_DOMAINS.has(domain);
}

function isDue(b: Bookmark): boolean {
  if (!b.reminderAt) return false;
  if (b.reminderAt > Date.now()) return false;
  if (b.reminderSnoozedUntil && b.reminderSnoozedUntil > Date.now()) return false;
  return true;
}

// ── Public types ─────────────────────────────────────────────────────────────

export type DashboardFilter = "unread" | "deadlinks" | "emptyfolders";

export interface FilterInputs {
  searchQuery: string;
  sourceFilter: "all" | "web" | "ai_answer" | "ai_prompt";
  dateFrom: string;
  dateTo: string;
  activeTagFilter: string | null;
  dashboardFilter: DashboardFilter | null;
}

export interface FilterPipelineResult {
  allBookmarks: Bookmark[];
  dueBookmarks: Bookmark[];
  filtered: Bookmark[];
  unreadBookmarks: Bookmark[];
  deadLinkBookmarks: Bookmark[];
  emptyFolderList: Folder[];
  emptyFolderIds: Set<string>;
  sortedTagDefs: TagDef[];
  rootFolderCount: number;
  isSearching: boolean;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFilterPipeline(
  state: LibraryState,
  prefs: Prefs,
  inputs: FilterInputs,
): FilterPipelineResult {
  const { searchQuery, sourceFilter, dateFrom, dateTo, activeTagFilter, dashboardFilter } = inputs;

  const allBookmarks = useMemo(
    () => Object.values(state.bookmarks),
    [state.bookmarks],
  );

  const dueBookmarks = useMemo(
    () => allBookmarks.filter(isDue),
    [allBookmarks],
  );

  const unreadThresholdMs = (prefs.unreadThresholdDays ?? 60) * 86_400_000;
  const unreadBookmarks = useMemo(
    () =>
      (prefs.unreadTrackingEnabled ?? false)
        ? allBookmarks.filter(
            (b) =>
              (b.lastOpenedAt ?? 0) === 0 ||
              Date.now() - (b.lastOpenedAt ?? 0) > unreadThresholdMs,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allBookmarks, prefs.unreadTrackingEnabled, unreadThresholdMs],
  );

  const deadLinkBookmarks = useMemo(
    () => allBookmarks.filter((b) => b.isDeadLink === true),
    [allBookmarks],
  );

  const emptyFolderList = useMemo(
    () =>
      Object.values(state.folders).filter(
        (f) =>
          f.id !== state.rootFolderId &&
          !allBookmarks.some((b) => b.folderId === f.id),
      ),
    [state.folders, state.rootFolderId, allBookmarks],
  );

  const emptyFolderIds = useMemo(
    () =>
      dashboardFilter === "emptyfolders"
        ? new Set(emptyFolderList.map((f) => f.id))
        : new Set<string>(),
    [dashboardFilter, emptyFolderList],
  );

  const rootFolderCount = useMemo(
    () => Object.keys(state.folders).length - 1,
    [state.folders],
  );

  const sortedTagDefs = useMemo(
    () =>
      Object.values(state.tagDefs ?? {}).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [state.tagDefs],
  );

  // ── Filter pipeline ────────────────────────────────────────────────────────

  const sourceFiltered = useMemo(
    () =>
      sourceFilter === "all"
        ? allBookmarks
        : allBookmarks.filter((b) => {
            const cc = b.snippet?.chatContext;
            const hasAiMeta = cc?.platform && cc.platform !== "unknown";
            const domainIsAi = isAiDomain(b.domain);
            if (sourceFilter === "web") return !hasAiMeta && !domainIsAi;
            if (sourceFilter === "ai_answer")
              return (
                cc?.role === "assistant" ||
                (domainIsAi && cc?.role !== "user")
              );
            if (sourceFilter === "ai_prompt") return cc?.role === "user";
            return true;
          }),
    [allBookmarks, sourceFilter],
  );

  const dateFiltered = useMemo(
    () =>
      dateFrom || dateTo
        ? sourceFiltered.filter((b) => {
            if (dateFrom) {
              const fromMs = new Date(dateFrom).setHours(0, 0, 0, 0);
              if (b.createdAt < fromMs) return false;
            }
            if (dateTo) {
              const toMs = new Date(dateTo).setHours(23, 59, 59, 999);
              if (b.createdAt > toMs) return false;
            }
            return true;
          })
        : sourceFiltered,
    [sourceFiltered, dateFrom, dateTo],
  );

  const tagFiltered = useMemo(
    () =>
      activeTagFilter
        ? dateFiltered.filter((b) =>
            (b.tags ?? []).includes(activeTagFilter),
          )
        : dateFiltered,
    [dateFiltered, activeTagFilter],
  );

  const isSearching = searchQuery.trim().length > 0;

  const searchFiltered = useMemo(() => {
    if (!isSearching) return tagFiltered;
    const q = searchQuery.toLowerCase();
    return tagFiltered.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.domain.toLowerCase().includes(q) ||
        (b.snippet?.text ?? "").toLowerCase().includes(q) ||
        (b.notes ?? "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFiltered, searchQuery, isSearching]);

  const dashboardBase =
    dashboardFilter === "unread"
      ? unreadBookmarks
      : dashboardFilter === "deadlinks"
        ? deadLinkBookmarks
        : null;

  const filtered = useMemo(() => {
    if (dashboardBase === null) return searchFiltered;
    if (!isSearching) return dashboardBase;
    const q = searchQuery.toLowerCase();
    return dashboardBase.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.domain.toLowerCase().includes(q) ||
        (b.snippet?.text ?? "").toLowerCase().includes(q) ||
        (b.notes ?? "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardBase, searchFiltered, isSearching, searchQuery]);

  return {
    allBookmarks,
    dueBookmarks,
    filtered,
    unreadBookmarks,
    deadLinkBookmarks,
    emptyFolderList,
    emptyFolderIds,
    sortedTagDefs,
    rootFolderCount,
    isSearching,
  };
}
