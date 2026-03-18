/// <reference types="chrome" />
import { addPageBookmark, addSelectionBookmark, recordAnchorResolution, getState, getDuplicateFolderName } from "./core/storage/local";
import { isYouTubeWatchUrl, normalizeYouTubeCanonicalUrl } from "./core/youtube";
import type { YouTubeCaptureResult } from "./core/youtube";
import type { BookmarkMedia, Bookmark } from "./core/types";
import { getRecentFolderIds, updateRecents, setPendingSave, RECENTS_KEY, computeFolderLabel } from "./core/storage/recents";
import type { PendingSave } from "./core/storage/recents";
import { getPrefs } from "./core/storage/prefs";
import { SUMMARY_ALARM_NAME, buildSummaryAlarmConfig, runScheduledSummary } from "./core/summaries";

const MSG = {
  CAPTURE_ANCHOR:        "ZP_CAPTURE_ANCHOR",
  CAPTURE_YT_MOMENT:     "ZP_CAPTURE_YT_MOMENT",
  SHOW_SAVE_CONFIRM:     "ZP_SHOW_SAVE_CONFIRM",
  GET_SELECTION_PAYLOAD: "ZP_GET_SELECTION_PAYLOAD",
  ANCHOR_RESOLVED:       "ZP_ANCHOR_RESOLVED",
  FOLDERS_CHANGED:       "ZP_FOLDERS_CHANGED",
  REMINDERS_CHANGED:     "ZP_REMINDERS_CHANGED",
  SUMMARY_PREFS_CHANGED: "ZP_SUMMARY_PREFS_CHANGED",
} as const;

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
  message: Record<string, unknown>
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

  try {
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
  } catch (err) {
    console.error("[ZeroPin] rebuildContextMenus failed:", err);
    // Fallback: minimal static menu so the extension remains usable
    chrome.contextMenus.create({
      id: "zp_save_root",
      title: "Save to ZeroPin",
      contexts: ["page", "selection"],
    });
  }
}

// ── Reminder helpers ──────────────────────────────────────────────────────────

function isDue(b: Bookmark): boolean {
  if (!b.reminderAt) return false;
  if (b.reminderAt > Date.now()) return false;
  if (b.reminderSnoozedUntil && b.reminderSnoozedUntil > Date.now()) return false;
  return true;
}

async function updateReminderBadge(): Promise<void> {
  const state = await getState().catch(() => null);
  if (!state) return;
  const count = Object.values(state.bookmarks).filter(isDue).length;
  const text = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text });
  if (count > 0) chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
}

async function scheduleOrRefreshDailyAlarm(): Promise<void> {
  const prefs = await getPrefs();
  if (!prefs.reminderNotificationEnabled) {
    chrome.alarms.clear("zp_daily_check");
    return;
  }
  // Fire at next occurrence of reminderNotificationHour:00 local time
  const nowDate = new Date();
  const next = new Date();
  next.setHours(prefs.reminderNotificationHour, 0, 0, 0);
  if (next <= nowDate) next.setDate(next.getDate() + 1);
  chrome.alarms.create("zp_daily_check", {
    when: next.getTime(),
    periodInMinutes: 1440,
  });
}

async function scheduleOrRefreshSummaryAlarm(): Promise<void> {
  const prefs = await getPrefs();
  const cfg = buildSummaryAlarmConfig(prefs);
  if (!cfg) {
    chrome.alarms.clear(SUMMARY_ALARM_NAME);
    return;
  }
  chrome.alarms.create(SUMMARY_ALARM_NAME, cfg);
}

// ── Alarm listener ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "zp_daily_check") {
    await updateReminderBadge();
    const prefs = await getPrefs();
    if (!prefs.reminderNotificationEnabled) return;
    const state = await getState().catch(() => null);
    if (!state) return;
    const count = Object.values(state.bookmarks).filter(isDue).length;
    if (count === 0) return;
    chrome.notifications.create("zp_reminders", {
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "ZeroPin",
      message: `${count} reminder${count === 1 ? "" : "s"} waiting for you.`,
    });
    return;
  }

  if (alarm.name === SUMMARY_ALARM_NAME) {
    const run = await runScheduledSummary().catch(() => null);
    if (!run) return;
    if (run.status !== "completed") return;
    chrome.notifications.create(`zp_summary_${run.id}`, {
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "ZeroPin Summary Ready",
      message: `${run.usedSnippetCount} bookmarks summarized across ${run.folderCount} folders.`,
    });
  }
});

chrome.notifications.onClicked.addListener((id) => {
  if (id === "zp_reminders") {
    chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
    chrome.notifications.clear(id);
    return;
  }
  if (id.startsWith("zp_summary_")) {
    const summaryId = id.slice("zp_summary_".length);
    chrome.tabs.create({ url: chrome.runtime.getURL(`library.html?summary=${encodeURIComponent(summaryId)}`) });
    chrome.notifications.clear(id);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  void rebuildContextMenus();
  void scheduleOrRefreshDailyAlarm();
  void scheduleOrRefreshSummaryAlarm();
  void updateReminderBadge();

  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("walkthrough.html?autoSummarySetup=1") });
  }
});

chrome.runtime.onStartup.addListener(() => {
  void rebuildContextMenus();
  void scheduleOrRefreshDailyAlarm();
  void scheduleOrRefreshSummaryAlarm();
  void updateReminderBadge();
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
        const r = await sendMessage<{ anchor?: any }>(tab.id, { type: MSG.CAPTURE_ANCHOR });
        anchor = r?.anchor;
      }
      let ytResult: any;
      if (tab?.id != null && isYouTubeWatchUrl(url)) {
        ytResult = await sendMessage(tab.id, { type: MSG.CAPTURE_YT_MOMENT });
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
        const r = await sendMessage<{ anchor?: any }>(tab.id, { type: MSG.CAPTURE_ANCHOR });
        anchor = r?.anchor;
      } catch { /* fallback */ }
    }
    const dupFolderName = await getDuplicateFolderName(url, folderId);
    await addSelectionBookmark({ url, title, selectedText: selectionText, anchor, folderId });
    await finishSave(tab?.id, folderId, "Saved snippet", dupFolderName);
  } else {
    await savePagePossiblyWithYouTube(tab?.id, url, title, folderId);
    // finishSave toast is sent inside savePagePossiblyWithYouTube when folderId is set
  }

  await updateRecents(folderId);
  void rebuildContextMenus();
}

async function finishSave(tabId: number | undefined, folderId: string, defaultMessage: string | null, dupFolderName?: string | null): Promise<void> {
  if (tabId == null) return;
  const state = await getState();
  const folderName = state.folders[folderId]?.name ?? "folder";
  const base = defaultMessage ?? `Saved to ${folderName}`;
  const message = dupFolderName ? `Already pinned in "${dupFolderName}" — ${base}` : base;
  void sendMessage(tabId, { type: MSG.SHOW_SAVE_CONFIRM, message });
}

// ── YouTube-aware page save ───────────────────────────────────────────────────

async function savePagePossiblyWithYouTube(
  tabId: number | undefined,
  url: string,
  title: string,
  folderId?: string,
): Promise<void> {
  // Resolve the effective target folder (mirrors addPageBookmark fallback logic)
  const stateForDup = await getState();
  const effectiveFolderId = (folderId && stateForDup.folders[folderId]) ? folderId : stateForDup.rootFolderId;
  const dupFolderName = await getDuplicateFolderName(url, effectiveFolderId);

  function withDup(msg: string): string {
    return dupFolderName ? `Already pinned in "${dupFolderName}" — ${msg}` : msg;
  }

  if (!isYouTubeWatchUrl(url)) {
    await addPageBookmark(url, title, undefined, folderId);
    if (tabId != null && folderId) {
      const folderName = stateForDup.folders[folderId]?.name ?? "folder";
      void sendMessage(tabId, { type: MSG.SHOW_SAVE_CONFIRM, message: withDup(`Saved to ${folderName}`) });
    } else if (tabId != null) {
      void sendMessage(tabId, { type: MSG.SHOW_SAVE_CONFIRM, message: withDup("Saved page") });
    }
    return;
  }

  const canonicalUrl = normalizeYouTubeCanonicalUrl(url) ?? url;
  let saveUrl = canonicalUrl;
  let media: BookmarkMedia | undefined;
  let toastMessage = folderId ? undefined : withDup("Saved page");

  if (tabId != null) {
    const result = await sendMessage<YouTubeCaptureResult>(tabId, { type: MSG.CAPTURE_YT_MOMENT });

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
      toastMessage = withDup(`Saved YouTube moment at ${result.timestampLabel}`);
    } else if (result?.kind === "fallback") {
      saveUrl = result.canonicalUrl;
    }

    if (toastMessage === undefined) {
      // folderId set, non-YouTube path
      const folderName = stateForDup.folders[folderId!]?.name ?? "folder";
      toastMessage = withDup(`Saved to ${folderName}`);
    }

    void sendMessage(tabId, { type: MSG.SHOW_SAVE_CONFIRM, message: toastMessage });
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
        { type: MSG.GET_SELECTION_PAYLOAD }
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
  if (request.type === MSG.ANCHOR_RESOLVED) {
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

  if (request.type === MSG.FOLDERS_CHANGED) {
    void rebuildContextMenus();
    sendResponse({ ok: true });
    return false;
  }

  if (request.type === MSG.REMINDERS_CHANGED) {
    void updateReminderBadge();
    sendResponse({ ok: true });
    return false;
  }

  if (request.type === MSG.SUMMARY_PREFS_CHANGED) {
    void scheduleOrRefreshSummaryAlarm();
    sendResponse({ ok: true });
    return false;
  }
});
