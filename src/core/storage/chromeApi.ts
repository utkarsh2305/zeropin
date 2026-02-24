/** Shared Chrome extension storage primitives. */

export function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (items) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve(items[key] as T | undefined);
    });
  });
}

export function storageSet<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve();
    });
  });
}
