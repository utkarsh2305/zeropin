/// <reference types="chrome" />
import { addPageBookmark, addSelectionBookmark, recordAnchorResolution, getState } from "./core/storage/local";
import { isYouTubeWatchUrl, normalizeYouTubeCanonicalUrl } from "./core/youtube";
import type { YouTubeCaptureResult } from "./core/youtube";
import type { BookmarkMedia } from "./core/types";
import { getRecentFolderIds, updateRecents, setPendingSave, RECENTS_KEY, computeFolderLabel } from "./core/storage/recents";
import type { PendingSave } from "./core/storage/recents";

function tabsGet(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (t) => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve(t);
    });
  });
}

function sendMessage<T>(
  tabId: number,
  message: any
): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn("ZP sendMessage error:", err.message);
        resolve(undefined);
      } else {
        resolve(response);
      }
    });
  });
}

// ── Context menu rebuild ──────────────────────────────────────────────────────

async function rebuildContextMenus(): Promise<void> {
  await new Promise<void>((r) => chrome.contextMenus.removeAll(r));

  chrome.contextMenus.create({
    id: "zp_save_root",
    title: "Save to ZeroPin",
    contexts: ["page", "selection"],
  });

  const [rawRecents, state] = await Promise.all([getRecentFolderIds(), getState()]);

  // Filter out deleted folders and persist cleaned list
  const validRecents = rawRecents.filter((id) => !!state.folders[id]);
  if (validRecents.length !== rawRecents.length) {
    await chrome.storage.local.set({ [RECENTS_KEY]: validRecents });
  }

  for (const folderId of validRecents) {
    chrome.contextMenus.create({
      id: `zp_save_recent_${folderId}`,
      parentId: "zp_save_root",
      title: computeFolderLabel(folderId, state.folders),
      contexts: ["page", "selection"],
    });
  }

  chrome.contextMenus.create({
    id: "zp_save_more",
    parentId: "zp_save_root",
    title: "More\u2026",
    contexts: ["page", "selection"],
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void rebuildContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  void rebuildContextMenus();
});

// ── Click handler ─────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleClick(info, tab);
});

async function handleClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  const id = String(info.menuItemId);
  if (id === "zp_save_root") return; // click on parent — ignore

  try {
    let url = tab?.url ?? info.pageUrl ?? "";

    if (!url && tab?.id != null) {
      const fullTab = await tabsGet(tab.id);
      url = fullTab.url ?? "";
    }

    if (!url) {
      console.warn("ZP: no url available");
      return;
    }

    const title = tab?.title ?? url;

    if (id === "zp_save_more") {
      let anchor: any;
      if (info.selectionText && tab?.id != null) {
        const r = await sendMessage<{ anchor?: any }>(tab.id, { type: "ZP_CAPTURE_ANCHOR" });
        anchor = r?.anchor;
      }
      let ytResult: any;
      if (tab?.id != null && isYouTubeWatchUrl(url)) {
        ytResult = await sendMessage(tab.id, { type: "ZP_CAPTURE_YT_MOMENT" });
      }
      const pending: PendingSave = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        tabId: tab?.id ?? 0,
        url,
        title,
        selectionText: info.selectionText?.trim(),
        anchor,
        ytResult,
      };
      await setPendingSave(pending);
      chrome.tabs.create({ url: chrome.runtime.getURL("library.html?mode=picker") });
      return;
    }

    if (id.startsWith("zp_save_recent_")) {
      const folderId = id.slice("zp_save_recent_".length);
      await saveWithFolder(info, tab, url, title, folderId);
      return;
    }
  } catch (err) {
    console.error("ZP: handleClick failed", err);
  }
}

// ── saveWithFolder ────────────────────────────────────────────────────────────

async function saveWithFolder(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  url: string,
  title: string,
  folderId: string,
): Promise<void> {
  const selectionText = info.selectionText?.trim() ?? "";

  if (selectionText) {
    let anchor: any;
    if (tab?.id != null) {
      try {
        const r = await sendMessage<{ anchor?: any }>(tab.id, { type: "ZP_CAPTURE_ANCHOR" });
        anchor = r?.anchor;
      } catch { /* fallback */ }
    }
    await addSelectionBookmark({ url, title, selectedText: selectionText, anchor, folderId });
    await finishSave(tab?.id, folderId, "Saved snippet");
  } else {
    await savePagePossiblyWithYouTube(tab?.id, url, title, folderId);
    // finishSave toast is sent inside savePagePossiblyWithYouTube when folderId is set
  }

  await updateRecents(folderId);
  void rebuildContextMenus();
}

async function finishSave(tabId: number | undefined, folderId: string, defaultMessage: string | null): Promise<void> {
  if (tabId == null) return;
  const state = await getState();
  const folderName = state.folders[folderId]?.name ?? "folder";
  const message = defaultMessage ?? `Saved to ${folderName}`;
  void sendMessage(tabId, { type: "ZP_SHOW_SAVE_CONFIRM", message });
}

// ── YouTube-aware page save ───────────────────────────────────────────────────

async function savePagePossiblyWithYouTube(
  tabId: number | undefined,
  url: string,
  title: string,
  folderId?: string,
): Promise<void> {
  if (!isYouTubeWatchUrl(url)) {
    await addPageBookmark(url, title, undefined, folderId);
    if (tabId != null && folderId) {
      const state = await getState();
      const folderName = state.folders[folderId]?.name ?? "folder";
      void sendMessage(tabId, { type: "ZP_SHOW_SAVE_CONFIRM", message: `Saved to ${folderName}` });
    } else if (tabId != null) {
      void sendMessage(tabId, { type: "ZP_SHOW_SAVE_CONFIRM", message: "Saved page" });
    }
    return;
  }

  const canonicalUrl = normalizeYouTubeCanonicalUrl(url) ?? url;
  let saveUrl = canonicalUrl;
  let media: BookmarkMedia | undefined;
  let toastMessage = folderId ? undefined : "Saved page"; // will be set below

  if (tabId != null) {
    const result = await sendMessage<YouTubeCaptureResult>(tabId, { type: "ZP_CAPTURE_YT_MOMENT" });

    if (result?.kind === "youtube") {
      media = {
        kind: "youtube",
        videoId: result.videoId,
        timestampSec: result.timestampSec,
        timestampLabel: result.timestampLabel,
        canonicalUrl: result.canonicalUrl,
        openUrl: result.openUrl,
        captureMethod: result.captureMethod,
      };
      saveUrl = result.openUrl;
      toastMessage = `Saved YouTube moment at ${result.timestampLabel}`;
    } else if (result?.kind === "fallback") {
      saveUrl = result.canonicalUrl;
    }

    if (toastMessage === undefined) {
      // folderId set, non-YouTube path
      const state = await getState();
      const folderName = state.folders[folderId!]?.name ?? "folder";
      toastMessage = `Saved to ${folderName}`;
    }

    void sendMessage(tabId, { type: "ZP_SHOW_SAVE_CONFIRM", message: toastMessage });
  }

  await addPageBookmark(saveUrl, title, media, folderId);
}

// ── Keyboard shortcut "Pin It" ────────────────────────────────────────────────

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "pin-it") return;
  void handlePinIt(tab);
});

async function handlePinIt(tab?: chrome.tabs.Tab) {
  try {
    let url = tab?.url ?? "";
    if (!url && tab?.id != null) {
      const fullTab = await tabsGet(tab.id);
      url = fullTab.url ?? "";
    }
    if (!url) {
      console.warn("ZP: no url available");
      return;
    }

    const title = tab?.title ?? url;

    // Ask content script if there's a selection
    let payload: { hasSelection?: boolean; selectedText?: string; anchor?: any } | undefined;
    if (tab?.id != null) {
      payload = await sendMessage<{ hasSelection?: boolean; selectedText?: string; anchor?: any }>(
        tab.id,
        { type: "ZP_GET_SELECTION_PAYLOAD" }
      );
    }

    if (payload?.hasSelection && payload.selectedText) {
      await addSelectionBookmark({
        url,
        title,
        selectedText: payload.selectedText,
        anchor: payload.anchor ?? undefined,
      });
    } else {
      await savePagePossiblyWithYouTube(tab?.id, url, title);
    }

    // Badge flash
    if (tab?.id != null) {
      chrome.action.setBadgeText({ text: "OK", tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: "#4CAF50", tabId: tab.id });
      setTimeout(() => {
        chrome.action.setBadgeText({ text: "", tabId: tab!.id });
      }, 1500);
    }
  } catch (err) {
    console.error("ZP: pin-it failed", err);
  }
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "ZP_ANCHOR_RESOLVED") {
    const { bookmarkId, confidence, repair } = request;
    if (bookmarkId && confidence != null) {
      recordAnchorResolution(bookmarkId, confidence, repair)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((err: unknown) => {
          console.error("ZP: Anchor resolution recording failed", err);
          sendResponse({ success: false, reason: String(err) });
        });
      return true; // keep channel open for async response
    }
    sendResponse({ success: false, reason: "Missing bookmarkId or confidence" });
  }

  if (request.type === "ZP_FOLDERS_CHANGED") {
    void rebuildContextMenus();
    sendResponse({ ok: true });
    return false;
  }
});
