import { storageGet, storageSet } from "./chromeApi";

const PREFS_KEY = "zp_prefs";

export interface Prefs {
  /** Highlight fade duration in ms. Default 3000. Range 1000–10000. */
  highlightDurationMs: number;
  /** Snippet card auto-dismiss delay in ms. Default 12000. Range 5000–30000. */
  snippetDismissMs: number;
  /** Whether to fire a single batched OS notification when daily reminders are due. Default false (opt-in). */
  reminderNotificationEnabled: boolean;
  /** Hour of day (0–23) to fire the daily reminder notification. Default 9 (9 AM). */
  reminderNotificationHour: number;
  /** Whether to track when bookmarks are opened for the unread health stat. Default false (opt-in). */
  unreadTrackingEnabled: boolean;
  /** Number of days without opening before a bookmark is counted as unread. Default 60. */
  unreadThresholdDays: number;
}

const DEFAULT_PREFS: Prefs = {
  highlightDurationMs: 3000,
  snippetDismissMs: 12000,
  reminderNotificationEnabled: false,
  reminderNotificationHour: 9,
  unreadTrackingEnabled: false,
  unreadThresholdDays: 60,
};

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
