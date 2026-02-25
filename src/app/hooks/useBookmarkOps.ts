import { useState, useRef, useCallback, useEffect } from "react";
import {
  deleteBookmark,
  renameBookmark,
  moveBookmark,
  reorderBookmarks,
  moveFolderToParent,
  setBookmarkNotes,
  bulkSetBookmarkReminder,
  recordBookmarkOpen,
  addPageBookmark,
  addSelectionBookmark,
  setBookmarkTags,
  setBookmarkReminder,
  snoozeBookmarkReminder,
  dismissBookmarkReminder,
  updateDeadLinkResults,
  exportState,
  importState,
} from "../../core/storage/local";
import { setPendingSave, updateRecents } from "../../core/storage/recents";
import type { PendingSave } from "../../core/storage/recents";
import {
  parseBrowserHtml,
  detectBrowserSource,
  buildImportPreview,
  commitBrowserImport,
  BOOKMARK_CAP,
} from "../../core/storage/importBrowser";
import type { BrowserImportPreview } from "../../core/storage/importBrowser";
import type { LibraryState, Bookmark } from "../../core/types";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { reorder } from "@atlaskit/pragmatic-drag-and-drop/reorder";
import type { ConfirmDialogState } from "./useFolderOps";

// ── Drag data helper ──────────────────────────────────────────────────────────

type DragItemData = Record<string | symbol, unknown> & {
  type: "bookmark" | "folder";
  bookmarkId?: string;
  folderId?: string;
};

// ── Hook deps + return types ──────────────────────────────────────────────────

export interface BookmarkOpsDeps {
  state: LibraryState;
  refreshState: () => Promise<void>;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  pendingSave: PendingSave | null;
  setPendingSaveState: (s: PendingSave | null) => void;
  pickerTagIds: string[];
  setConfirmDialog: (d: ConfirmDialogState | null) => void;
}

export interface BookmarkOpsResult {
  expandedNotes: Record<string, { open: boolean; draft: string }>;
  setExpandedNotes: React.Dispatch<React.SetStateAction<Record<string, { open: boolean; draft: string }>>>;
  bulkMode: boolean;
  setBulkMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  browserImportPreview: BrowserImportPreview | null;
  setBrowserImportPreview: React.Dispatch<React.SetStateAction<BrowserImportPreview | null>>;
  includeDups: boolean;
  setIncludeDups: React.Dispatch<React.SetStateAction<boolean>>;
  deadLinkChecking: boolean;
  deadLinkProgress: number;
  deadLinkTotal: number;
  showDeadLinkModal: boolean;
  setShowDeadLinkModal: React.Dispatch<React.SetStateAction<boolean>>;
  deadLinkModalResult: { dead: number; total: number } | null;
  handleDeleteBookmark: (id: string) => void;
  handleCheckDeadLinks: () => Promise<void>;
  handlePickerSave: (folderId: string) => Promise<void>;
  handleRenameBookmark: (id: string, name: string) => Promise<void>;
  handleSetBookmarkTags: (bookmarkId: string, tagIds: string[]) => Promise<void>;
  handleDismissReminder: (bookmarkId: string) => Promise<void>;
  handleSnoozeReminder: (bookmarkId: string, days: number) => Promise<void>;
  handleBulkSetReminder: (days: number) => Promise<void>;
  handleSaveReminderDirect: (bookmarkId: string, reminderAt: number | null) => Promise<void>;
  handleSetBookmarkNotes: (id: string, notes: string) => Promise<void>;
  handleOpenBookmark: (b: Bookmark) => void;
  handleBrowserFileSelected: (file: File) => Promise<void>;
  handleBrowserImportConfirm: () => Promise<void>;
  handleExport: () => Promise<void>;
  handleImport: (file: File) => Promise<void>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBookmarkOps(deps: BookmarkOpsDeps): BookmarkOpsResult {
  const {
    state,
    refreshState,
    showToast,
    pendingSave,
    setPendingSaveState,
    pickerTagIds,
    setConfirmDialog,
  } = deps;

  const [expandedNotes, setExpandedNotes] = useState<Record<string, { open: boolean; draft: string }>>({});
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [browserImportPreview, setBrowserImportPreview] = useState<BrowserImportPreview | null>(null);
  const [includeDups, setIncludeDups] = useState(false);
  const [deadLinkChecking, setDeadLinkChecking] = useState(false);
  const [deadLinkProgress, setDeadLinkProgress] = useState(0);
  const [deadLinkTotal, setDeadLinkTotal] = useState(0);
  const [showDeadLinkModal, setShowDeadLinkModal] = useState(false);
  const [deadLinkModalResult, setDeadLinkModalResult] = useState<{ dead: number; total: number } | null>(null);

  // Stale-closure guard for DnD callback
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── DnD ───────────────────────────────────────────────────────────────────

  const handleDrop = useCallback(async ({
    source,
    location,
  }: {
    source: { data: Record<string | symbol, unknown> };
    location: { current: { dropTargets: { data: Record<string | symbol, unknown> }[] } };
  }) => {
    const target = location.current.dropTargets[0];
    if (!target) return;

    const sourceData = source.data as DragItemData;
    const targetData = target.data as DragItemData;
    const currentState = stateRef.current;
    if (!currentState) return;

    if (sourceData.type === "bookmark" && targetData.type === "folder") {
      if (sourceData.folderId !== targetData.folderId && sourceData.bookmarkId) {
        try {
          await moveBookmark(sourceData.bookmarkId, targetData.folderId!);
          await refreshState();
          showToast("Moved to " + (currentState.folders[targetData.folderId!]?.name ?? "folder"));
        } catch (err) {
          console.error("Failed to move bookmark", err);
        }
      }
      return;
    }

    if (
      sourceData.type === "bookmark" &&
      targetData.type === "bookmark" &&
      sourceData.bookmarkId !== targetData.bookmarkId
    ) {
      const edge = extractClosestEdge(target.data);
      const folderBookmarks = Object.values(currentState.bookmarks)
        .filter((b) => b.folderId === sourceData.folderId)
        .sort((a, b) => Number(b.sortKey) - Number(a.sortKey));
      const startIndex = folderBookmarks.findIndex((b) => b.id === sourceData.bookmarkId);
      let finishIndex = folderBookmarks.findIndex((b) => b.id === targetData.bookmarkId);
      if (startIndex !== -1 && finishIndex !== -1) {
        if (edge === "bottom" && startIndex < finishIndex) {
          // Already correct
        } else if (edge === "top" && startIndex > finishIndex) {
          // Already correct
        } else if (edge === "bottom") {
          finishIndex = finishIndex + 1;
        } else if (edge === "top") {
          finishIndex = finishIndex - 1;
        }
        finishIndex = Math.max(0, Math.min(finishIndex, folderBookmarks.length - 1));
        const reordered = reorder({ list: folderBookmarks, startIndex, finishIndex });
        try {
          await reorderBookmarks(reordered.map((b) => b.id));
          await refreshState();
        } catch (err) {
          console.error("Failed to reorder", err);
        }
      }
      return;
    }

    if (
      sourceData.type === "folder" &&
      targetData.type === "folder" &&
      sourceData.folderId !== targetData.folderId
    ) {
      try {
        await moveFolderToParent(sourceData.folderId!, targetData.folderId!);
        await refreshState();
        showToast("Folder moved");
      } catch (err) {
        console.error("Failed to move folder", err);
        showToast("Cannot move folder there", "error");
      }
    }
  }, [showToast, refreshState]);

  useEffect(() => {
    return monitorForElements({ onDrop: handleDrop });
  }, [handleDrop]);

  // ── Bookmark CRUD ─────────────────────────────────────────────────────────

  const handleDeleteBookmark = (id: string) => {
    setConfirmDialog({
      title: "Delete bookmark?",
      description: "This cannot be undone.",
      onConfirm: async () => {
        await deleteBookmark(id);
        chrome.runtime.sendMessage({ type: "ZP_REMINDERS_CHANGED" });
        await refreshState();
        showToast("Bookmark deleted");
      },
    });
  };

  const handlePickerSave = async (folderId: string) => {
    if (!pendingSave) return;
    try {
      const tags = pickerTagIds.length > 0 ? pickerTagIds : undefined;
      if (pendingSave.selectionText) {
        await addSelectionBookmark({
          url: pendingSave.url,
          title: pendingSave.title,
          selectedText: pendingSave.selectionText,
          anchor: pendingSave.anchor,
          folderId,
          tags,
        });
      } else if (pendingSave.ytResult?.kind === "youtube") {
        const media = {
          kind: "youtube" as const,
          videoId: pendingSave.ytResult.videoId,
          timestampSec: pendingSave.ytResult.timestampSec,
          timestampLabel: pendingSave.ytResult.timestampLabel,
          canonicalUrl: pendingSave.ytResult.canonicalUrl,
          openUrl: pendingSave.ytResult.openUrl,
          captureMethod: pendingSave.ytResult.captureMethod,
        };
        await addPageBookmark(pendingSave.ytResult.openUrl, pendingSave.title, media, folderId, tags);
      } else {
        await addPageBookmark(pendingSave.url, pendingSave.title, undefined, folderId, tags);
      }

      await updateRecents(folderId);
      await setPendingSave(null);
      setPendingSaveState(null);
      await refreshState();

      chrome.runtime.sendMessage({ type: "ZP_FOLDERS_CHANGED" }).catch(() => {});

      const folderName = state.folders[folderId]?.name ?? "folder";
      showToast(`Saved to ${folderName}`);

      setTimeout(() => window.close(), 1200);
    } catch (err) {
      console.error("ZP: picker save failed", err);
      showToast("Save failed", "error");
    }
  };

  const handleRenameBookmark = async (id: string, name: string) => {
    try {
      await renameBookmark(id, name);
      await refreshState();
      showToast("Bookmark renamed");
    } catch (err) {
      console.error("Failed to rename bookmark", err);
      showToast("Failed to rename bookmark", "error");
    }
  };

  const handleSetBookmarkTags = async (bookmarkId: string, tagIds: string[]) => {
    try {
      await setBookmarkTags(bookmarkId, tagIds);
      await refreshState();
    } catch (err) {
      console.error("Failed to update tags", err);
      showToast("Failed to update tags", "error");
    }
  };

  // ── Reminders ─────────────────────────────────────────────────────────────

  const handleDismissReminder = async (bookmarkId: string) => {
    try {
      await dismissBookmarkReminder(bookmarkId);
      chrome.runtime.sendMessage({ type: "ZP_REMINDERS_CHANGED" }).catch(() => {});
      await refreshState();
    } catch (err) {
      console.error("Failed to dismiss reminder", err);
    }
  };

  const handleSnoozeReminder = async (bookmarkId: string, days: number) => {
    try {
      const untilMs = Date.now() + days * 24 * 60 * 60 * 1000;
      await snoozeBookmarkReminder(bookmarkId, untilMs);
      chrome.runtime.sendMessage({ type: "ZP_REMINDERS_CHANGED" }).catch(() => {});
      await refreshState();
    } catch (err) {
      console.error("Failed to snooze reminder", err);
    }
  };

  const handleBulkSetReminder = async (days: number) => {
    try {
      const untilMs = Date.now() + days * 24 * 60 * 60 * 1000;
      await bulkSetBookmarkReminder([...selectedIds], untilMs);
      chrome.runtime.sendMessage({ type: "ZP_REMINDERS_CHANGED" }).catch(() => {});
      setSelectedIds(new Set());
      setBulkMode(false);
      await refreshState();
    } catch (err) {
      console.error("Failed to set bulk reminder", err);
    }
  };

  const handleSaveReminderDirect = async (bookmarkId: string, reminderAt: number | null) => {
    try {
      await setBookmarkReminder(bookmarkId, reminderAt);
      chrome.runtime.sendMessage({ type: "ZP_REMINDERS_CHANGED" }).catch(() => {});
      await refreshState();
    } catch (err) {
      console.error("Failed to save reminder", err);
    }
  };

  // ── Notes ─────────────────────────────────────────────────────────────────

  const handleSetBookmarkNotes = async (id: string, notes: string) => {
    try {
      await setBookmarkNotes(id, notes);
      await refreshState();
      setExpandedNotes((prev) => ({ ...prev, [id]: { open: false, draft: "" } }));
      showToast("Notes saved");
    } catch (err) {
      console.error("Failed to save notes", err);
      showToast("Failed to save notes", "error");
    }
  };

  // ── Open ──────────────────────────────────────────────────────────────────

  const handleOpenBookmark = (b: Bookmark) => {
    recordBookmarkOpen(b.id);
    if (b.type === "SNIPPET" && b.snippet) {
      chrome.storage.local.set(
        {
          ZP_HIGHLIGHT_REQUEST: {
            url: b.url,
            anchor: b.snippet,
            bookmarkId: b.id,
            // eslint-disable-next-line react-hooks/purity
            timestamp: Date.now(),
          },
        },
        () => {
          const err = chrome.runtime.lastError;
          if (err) { console.warn(`ZP: Failed to write highlight request: ${err.message}`); return; }
          chrome.tabs.create({ url: b.url });
        },
      );
    } else {
      window.open(b.url, "_blank");
    }
  };

  // ── Dead links ────────────────────────────────────────────────────────────

  const handleCheckDeadLinks = async () => {
    if (deadLinkChecking) return;
    const bookmarkList = Object.values(state.bookmarks);
    if (bookmarkList.length === 0) return;
    setDeadLinkChecking(true);
    setDeadLinkProgress(0);
    setDeadLinkTotal(bookmarkList.length);
    showToast("Checking your links in the background — keep using ZeroPin as normal. We'll let you know when it's done.", "info");
    const BATCH = 10;
    const deadIds: string[] = [];
    for (let i = 0; i < bookmarkList.length; i += BATCH) {
      const batch = bookmarkList.slice(i, i + BATCH);
      await Promise.all(batch.map(async (b) => {
        try {
          const res = await fetch(b.url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
          if (res.status === 404 || res.status === 410) deadIds.push(b.id);
        } catch { /* timeout / CORS / network error = treat as working */ }
      }));
      setDeadLinkProgress(Math.min(i + BATCH, bookmarkList.length));
      if (i + BATCH < bookmarkList.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await updateDeadLinkResults(bookmarkList.map((b) => ({ id: b.id, isDeadLink: deadIds.includes(b.id) })));
    setDeadLinkChecking(false);
    setDeadLinkModalResult({ dead: deadIds.length, total: bookmarkList.length });
    setShowDeadLinkModal(true);
    await refreshState();
  };

  // ── Import / Export ───────────────────────────────────────────────────────

  const handleBrowserFileSelected = async (file: File) => {
    try {
      const html = await file.text();
      const source = detectBrowserSource(html);
      const parsed = parseBrowserHtml(html);
      if (parsed.bookmarks.length === 0) {
        showToast("No bookmarks found in this file", "error");
        return;
      }
      const preview = await buildImportPreview(parsed, source);
      setIncludeDups(false);
      setBrowserImportPreview(preview);
    } catch (err) {
      console.error("Failed to parse browser bookmarks", err);
      showToast("Failed to read file", "error");
    }
  };

  const handleBrowserImportConfirm = async () => {
    if (!browserImportPreview) return;
    const available = BOOKMARK_CAP - browserImportPreview.currentBookmarkCount;
    const willImport = Math.min(
      (includeDups ? browserImportPreview.newCount + browserImportPreview.dupCount : browserImportPreview.newCount),
      Math.max(0, available),
    );
    if (willImport === 0) {
      setBrowserImportPreview(null);
      return;
    }
    try {
      const { imported, dupSkipped, capSkipped } = await commitBrowserImport(
        browserImportPreview._folders,
        browserImportPreview._bookmarks,
        browserImportPreview.source,
        includeDups,
      );
      setBrowserImportPreview(null);
      await refreshState();
      const parts: string[] = [`Imported ${imported} bookmark${imported !== 1 ? "s" : ""}`];
      if (dupSkipped > 0) parts.push(`${dupSkipped} duplicate${dupSkipped !== 1 ? "s" : ""} skipped`);
      if (capSkipped > 0) parts.push(`${capSkipped} skipped (cap reached)`);
      showToast(parts.join(" · "));
    } catch (err) {
      console.error("Failed to import browser bookmarks", err);
      showToast("Import failed", "error");
    }
  };

  const handleExport = async () => {
    try {
      const data = await exportState();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zeropin-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Library exported");
    } catch (err) {
      console.error("Failed to export", err);
      showToast("Failed to export", "error");
    }
  };

  const handleImport = async (file: File) => {
    const isHtml = file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".htm");
    if (isHtml) {
      await handleBrowserFileSelected(file);
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importState(data);
      await refreshState();
      showToast("Library imported!");
    } catch (err) {
      console.error("Failed to import", err);
      showToast("Failed to import", "error");
    }
  };

  return {
    expandedNotes,
    setExpandedNotes,
    bulkMode,
    setBulkMode,
    selectedIds,
    setSelectedIds,
    browserImportPreview,
    setBrowserImportPreview,
    includeDups,
    setIncludeDups,
    deadLinkChecking,
    deadLinkProgress,
    deadLinkTotal,
    showDeadLinkModal,
    setShowDeadLinkModal,
    deadLinkModalResult,
    handleDeleteBookmark,
    handleCheckDeadLinks,
    handlePickerSave,
    handleRenameBookmark,
    handleSetBookmarkTags,
    handleDismissReminder,
    handleSnoozeReminder,
    handleBulkSetReminder,
    handleSaveReminderDirect,
    handleSetBookmarkNotes,
    handleOpenBookmark,
    handleBrowserFileSelected,
    handleBrowserImportConfirm,
    handleExport,
    handleImport,
  };
}
