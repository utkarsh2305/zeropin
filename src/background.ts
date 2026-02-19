/// <reference types="chrome" />
import { addPageBookmark, addSelectionBookmark, recordAnchorResolution } from "./core/storage/local";

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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-page",
    title: "Save to ZeroPin",
    contexts: ["page"]
  });

  chrome.contextMenus.create({
    id: "save-selection",
    title: "Save selection to ZeroPin",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleClick(info, tab);
});

async function handleClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  const id = String(info.menuItemId);
  console.log("ZP clicked", { raw: info.menuItemId, id, tabUrl: tab?.url, pageUrl: info.pageUrl });

  try {
    let url = tab?.url ?? info.pageUrl ?? "";

    // If tab.url is missing, fetch it explicitly (promisified)
    if (!url && tab?.id != null) {
      const fullTab = await tabsGet(tab.id);
      url = fullTab.url ?? "";
      console.log("ZP fetched tab.url from tabs.get", url);
    }

    if (!url) {
      console.warn("ZP no url available");
      return;
    }

    const title = tab?.title ?? url;

    if (id === "save-page") {
      console.log("ZP calling addPageBookmark", { url, title });
      await addPageBookmark(url, title);
      console.log("ZP addPageBookmark done");
    } else if (id === "save-selection") {
      const selectedText = info.selectionText?.trim() ?? "";
      if (!selectedText) {
        console.warn("ZP no selection text");
        return;
      }

      console.log("ZP calling addSelectionBookmark", { url, title, selectedText });

      // Try to capture full anchor from content script
      let anchor: any = undefined;
      if (tab?.id != null) {
        try {
          const response = await sendMessage<{ anchor?: any; success?: boolean }>(tab.id, { type: "ZP_CAPTURE_ANCHOR" });
          anchor = response?.anchor;
          console.log("ZP captured anchor", { has: Boolean(anchor), fields: anchor ? Object.keys(anchor) : [] });
        } catch (err) {
          console.warn("ZP anchor capture failed, will use fallback", err);
        }
      }

      // Call with anchor if available, otherwise just selectedText
      await addSelectionBookmark({
        url,
        title,
        selectedText,
        anchor: anchor ?? undefined,
      });
      console.log("ZP addSelectionBookmark done");
    }
  } catch (err) {
    console.error("ZP handleClick failed", err);
  }
}

// ── Keyboard shortcut "Pin It" ──

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
      console.warn("ZP pin-it: no url available");
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
      console.log("ZP pin-it: saving selection", { url, title, selectedText: payload.selectedText });
      await addSelectionBookmark({
        url,
        title,
        selectedText: payload.selectedText,
        anchor: payload.anchor ?? undefined,
      });
    } else {
      console.log("ZP pin-it: saving page", { url, title });
      await addPageBookmark(url, title);
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
    console.error("ZP pin-it failed", err);
  }
}

// ── Anchor repair listener ──

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "ZP_ANCHOR_RESOLVED") {
    const { bookmarkId, confidence, repair } = request;
    if (bookmarkId && confidence != null) {
      recordAnchorResolution(bookmarkId, confidence, repair)
        .then(() => {
          console.log("ZP: Anchor resolution recorded for bookmark", bookmarkId, "confidence:", confidence);
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
});
