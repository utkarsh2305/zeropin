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

export type DashboardFilter = "unread" | "deadlinks" | "emptyfolders" | "favorites" | "notes";

export interface FilterInputs {
  searchQuery: string;
  sourceFilter: "all" | "web" | "ai_answer" | "ai_prompt";
  dateFrom: string;
  dateTo: string;
  activeTagFilters: string[];
  dashboardFilter: DashboardFilter | null;
}

export interface FilterPipelineResult {
  allBookmarks: Bookmark[];
  dueBookmarks: Bookmark[];
  filtered: Bookmark[];
  unreadBookmarks: Bookmark[];
  deadLinkBookmarks: Bookmark[];
  favoriteBookmarks: Bookmark[];
  notesBookmarks: Bookmark[];
  emptyFolderList: Folder[];
  emptyFolderIds: Set<string>;
  sortedTagDefs: TagDef[];
  rootFolderCount: number;
  isSearching: boolean;
  /** Tag IDs that appear on ≥1 bookmark in the current tag-filtered set. */
  availableTagIds: Set<string>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFilterPipeline(
  state: LibraryState,
  prefs: Prefs,
  inputs: FilterInputs,
): FilterPipelineResult {
  const { searchQuery, sourceFilter, dateFrom, dateTo, activeTagFilters, dashboardFilter } = inputs;

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

  const favoriteBookmarks = useMemo(
    () => allBookmarks.filter((b) => !!b.isFavorite),
    [allBookmarks],
  );

  const notesBookmarks = useMemo(
    () => allBookmarks.filter((b) => !!b.notes?.trim()),
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

  // Intersection: bookmark must have ALL active tag filters
  const tagFiltered = useMemo(
    () =>
      activeTagFilters.length > 0
        ? dateFiltered.filter((b) =>
            activeTagFilters.every((t) => (b.tags ?? []).includes(t)),
          )
        : dateFiltered,
    [dateFiltered, activeTagFilters],
  );

  const isSearching = searchQuery.trim().length > 0;

  const searchFiltered = useMemo(() => {
    if (!isSearching) return tagFiltered;
    const q = searchQuery.trim();
    // #tag syntax: match bookmarks whose tags include any tag whose name contains the query
    if (q.startsWith("#")) {
      const tagName = q.slice(1).toLowerCase();
      if (!tagName) return tagFiltered;
      const matchingIds = Object.values(state.tagDefs ?? {})
        .filter((t) => t.name.toLowerCase().includes(tagName))
        .map((t) => t.id);
      if (matchingIds.length === 0) return [];
      return tagFiltered.filter((b) => (b.tags ?? []).some((tid) => matchingIds.includes(tid)));
    }
    const lower = q.toLowerCase();
    return tagFiltered.filter(
      (b) =>
        b.name.toLowerCase().includes(lower) ||
        b.url.toLowerCase().includes(lower) ||
        b.domain.toLowerCase().includes(lower) ||
        (b.snippet?.text ?? "").toLowerCase().includes(lower) ||
        (b.notes ?? "").toLowerCase().includes(lower),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFiltered, searchQuery, isSearching, state.tagDefs]);

  const dashboardBase =
    dashboardFilter === "unread"
      ? unreadBookmarks
      : dashboardFilter === "deadlinks"
        ? deadLinkBookmarks
        : dashboardFilter === "favorites"
          ? favoriteBookmarks
          : dashboardFilter === "notes"
            ? notesBookmarks
            : null;

  const filtered = useMemo(() => {
    if (dashboardBase === null) return searchFiltered;
    // Dashboard base is also intersected with any active tag filters
    const tagIntersected =
      activeTagFilters.length > 0
        ? dashboardBase.filter((b) =>
            activeTagFilters.every((t) => (b.tags ?? []).includes(t)),
          )
        : dashboardBase;
    if (!isSearching) return tagIntersected;
    const q = searchQuery.toLowerCase();
    return tagIntersected.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.domain.toLowerCase().includes(q) ||
        (b.snippet?.text ?? "").toLowerCase().includes(q) ||
        (b.notes ?? "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardBase, searchFiltered, activeTagFilters, isSearching, searchQuery]);

  // Tags that appear on ≥1 bookmark in the final visible set — drives sidebar narrowing.
  // Derived from `filtered` so search, dashboard, and tag filters all contribute.
  const availableTagIds = useMemo(
    () => new Set(filtered.flatMap((b) => b.tags ?? [])),
    [filtered],
  );

  return {
    allBookmarks,
    dueBookmarks,
    filtered,
    unreadBookmarks,
    deadLinkBookmarks,
    favoriteBookmarks,
    notesBookmarks,
    emptyFolderList,
    emptyFolderIds,
    sortedTagDefs,
    rootFolderCount,
    isSearching,
    availableTagIds,
  };
}
