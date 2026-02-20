const RECENTS_KEY = "zp_recents";
const PENDING_KEY = "zp_pending_save";
const RECENTS_MAX = 5;

export interface PendingSave {
  id: string;
  createdAt: number;
  tabId: number;
  url: string;
  title: string;
  selectionText?: string;
  anchor?: any;
  ytResult?: any;
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (items) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve(items[key] as T | undefined);
    });
  });
}

function storageSet(items: Record<string, any>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve();
    });
  });
}

export function getRecentFolderIds(): Promise<string[]> {
  return storageGet<string[]>(RECENTS_KEY).then((v) => v ?? []);
}

export async function updateRecents(folderId: string): Promise<void> {
  const current = await getRecentFolderIds();
  const filtered = current.filter((id) => id !== folderId);
  filtered.unshift(folderId);
  const trimmed = filtered.slice(0, RECENTS_MAX);
  await storageSet({ [RECENTS_KEY]: trimmed });
}

export function getPendingSave(): Promise<PendingSave | null> {
  return storageGet<PendingSave>(PENDING_KEY).then((v) => v ?? null);
}

export function setPendingSave(save: PendingSave | null): Promise<void> {
  return storageSet({ [PENDING_KEY]: save });
}

export { RECENTS_KEY, RECENTS_MAX };

import type { Folder } from "../types";

export function computeFolderLabel(folderId: string, folders: Record<string, Folder>): string {
  const folder = folders[folderId];
  if (!folder) return "Unknown";
  const parent = folder.parentId ? folders[folder.parentId] : null;
  const isTopLevel = !parent || parent.parentId === null;
  let label = isTopLevel ? folder.name : `${parent!.name} \u203a ${folder.name}`;
  if (label.length > 35) label = label.slice(0, 34) + "\u2026";
  return label;
}
