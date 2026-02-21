const PREFS_KEY = "zp_prefs";

export interface Prefs {
  /** Highlight fade duration in ms. Default 3000. Range 1000–10000. */
  highlightDurationMs: number;
  /** Snippet card auto-dismiss delay in ms. Default 12000. Range 5000–30000. */
  snippetDismissMs: number;
}

const DEFAULT_PREFS: Prefs = {
  highlightDurationMs: 3000,
  snippetDismissMs: 12000,
};

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (items) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve(items[key] as T | undefined);
    });
  });
}

function storageSet<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      resolve();
    });
  });
}

/** Returns stored prefs merged with defaults (missing keys fall back to defaults). */
export async function getPrefs(): Promise<Prefs> {
  const stored = await storageGet<Partial<Prefs>>(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(stored ?? {}) };
}

/** Merges partial prefs update into stored prefs and persists. */
export async function setPrefs(update: Partial<Prefs>): Promise<void> {
  const current = await getPrefs();
  await storageSet(PREFS_KEY, { ...current, ...update });
}
