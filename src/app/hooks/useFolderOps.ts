import { useState } from "react";
import {
  createFolder,
  renameFolder,
  deleteFolderCascade,
  setFolderColor,
  setFolderIcon,
  setLastUsedFolder,
} from "../../core/storage/local";
import type { LibraryState, Folder, Bookmark } from "../../core/types";
import type { PendingSave } from "../../core/storage/recents";
import type { DashboardFilter } from "./useFilterPipeline";

// ── Shared dialog types (exported so Library.tsx can reuse) ───────────────────

export type ConfirmDialogState = {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
};

// ── Private helper ────────────────────────────────────────────────────────────

function countFolderContents(
  folders: Record<string, Folder>,
  bookmarks: Record<string, Bookmark>,
  folderId: string,
): { bookmarkCount: number; childFolderCount: number } {
  const descendants = new Set<string>();
  const collect = (id: string) => {
    for (const f of Object.values(folders)) {
      if (f.parentId === id) {
        descendants.add(f.id);
        collect(f.id);
      }
    }
  };
  collect(folderId);
  const bookmarkCount = Object.values(bookmarks).filter(
    (b) => b.folderId === folderId || descendants.has(b.folderId),
  ).length;
  return { bookmarkCount, childFolderCount: descendants.size };
}

// ── Module-level utility ──────────────────────────────────────────────────────

export function notifyFoldersChanged(): void {
  chrome.runtime.sendMessage({ type: "ZP_FOLDERS_CHANGED" }).catch(() => {});
}

// ── Hook deps + return types ──────────────────────────────────────────────────

export interface FolderOpsDeps {
  state: LibraryState;
  refreshState: () => Promise<void>;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  activeFolderId: string | null;
  setActiveFolderId: React.Dispatch<React.SetStateAction<string | null>>;
  currentFolderId: string;
  isPickerMode: boolean;
  pendingSave: PendingSave | null;
  onPickerSave: (folderId: string) => Promise<void>;
  setConfirmDialog: (d: ConfirmDialogState | null) => void;
  setDashboardFilter: (f: DashboardFilter | null) => void;
}

export interface FolderOpsResult {
  isFolderModalOpen: boolean;
  setFolderModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  folderNameDraft: string;
  setFolderNameDraft: React.Dispatch<React.SetStateAction<string>>;
  handleCreateFolder: () => void;
  handleCreateFolderSubmit: () => Promise<void>;
  handleSelectFolder: (id: string) => Promise<void>;
  handleRenameFolder: (id: string, name: string) => Promise<void>;
  handleDeleteFolder: (id: string) => void;
  handleSetFolderColor: (id: string, color: string | undefined) => Promise<void>;
  handleSetFolderIcon: (id: string, icon: string | undefined) => Promise<void>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFolderOps(deps: FolderOpsDeps): FolderOpsResult {
  const {
    state,
    refreshState,
    showToast,
    setActiveFolderId,
    currentFolderId,
    isPickerMode,
    pendingSave,
    onPickerSave,
    setConfirmDialog,
    setDashboardFilter,
  } = deps;

  const [isFolderModalOpen, setFolderModalOpen] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState("");

  const handleCreateFolder = () => {
    setFolderNameDraft("");
    setFolderModalOpen(true);
  };

  const handleCreateFolderSubmit = async () => {
    const name = folderNameDraft.trim();
    if (!name) return;
    try {
      await createFolder({ parentId: currentFolderId, name });
      await refreshState();
      setFolderModalOpen(false);
      setFolderNameDraft("");
      showToast(`Folder "${name}" created`);
      notifyFoldersChanged();
    } catch (err) {
      console.error("Failed to create folder", err);
      showToast("Failed to create folder", "error");
    }
  };

  const handleSelectFolder = async (id: string) => {
    setActiveFolderId(id);
    setDashboardFilter(null);
    if (isPickerMode && pendingSave) {
      await onPickerSave(id);
    } else {
      try {
        await setLastUsedFolder(id);
      } catch { /* no-op */ }
    }
  };

  const handleRenameFolder = async (id: string, name: string) => {
    try {
      await renameFolder(id, name);
      await refreshState();
      showToast("Folder renamed");
      notifyFoldersChanged();
    } catch (err) {
      console.error("Failed to rename folder", err);
      showToast("Failed to rename folder", "error");
    }
  };

  const handleDeleteFolder = (id: string) => {
    const folder = state.folders[id];
    if (!folder) return;
    const { bookmarkCount, childFolderCount } = countFolderContents(
      state.folders,
      state.bookmarks,
      id,
    );
    const isEmpty = bookmarkCount === 0 && childFolderCount === 0;
    const description = isEmpty
      ? "This action cannot be undone."
      : `This folder contains ${bookmarkCount} bookmark(s) and ${childFolderCount} subfolder(s). All will be permanently deleted.`;
    setConfirmDialog({
      title: `Delete "${folder.name}"?`,
      description,
      onConfirm: async () => {
        await deleteFolderCascade(id);
        if (currentFolderId === id) setActiveFolderId(state.rootFolderId);
        await refreshState();
        showToast("Folder deleted");
        notifyFoldersChanged();
      },
    });
  };

  const handleSetFolderColor = async (
    id: string,
    color: string | undefined,
  ) => {
    try {
      await setFolderColor(id, color);
      await refreshState();
      notifyFoldersChanged();
    } catch (err) {
      console.error("Failed to set folder color", err);
    }
  };

  const handleSetFolderIcon = async (
    id: string,
    icon: string | undefined,
  ) => {
    try {
      await setFolderIcon(id, icon);
      await refreshState();
    } catch (err) {
      console.error("Failed to set folder icon", err);
    }
  };

  return {
    isFolderModalOpen,
    setFolderModalOpen,
    folderNameDraft,
    setFolderNameDraft,
    handleCreateFolder,
    handleCreateFolderSubmit,
    handleSelectFolder,
    handleRenameFolder,
    handleDeleteFolder,
    handleSetFolderColor,
    handleSetFolderIcon,
  };
}
