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
  /** Initial number of bookmarks to render before "Show more". 0 = show all. Default 50. */
  defaultPageSize: number;
  /** Setup flow completion gate for AI summary features. */
  onboardingCompleted: boolean;
  /** Timestamp when onboarding was completed. */
  onboardingCompletedAt?: number;
  /** User role/profile, e.g. "Product Manager". */
  userProfileRole: string;
  /** Free-form profile details to shape summary relevance. */
  userProfileDescription: string;
  /** How the user intends to use ZeroPin summaries. */
  userIntendedUse: string;
  /** Enables BYOK model calls for summaries. */
  summaryByokEnabled: boolean;
  /** Provider adapter used for BYOK calls. */
  summaryProvider: "openai" | "anthropic" | "gemini";
  /** Model id sent to provider. */
  summaryModel: string;
  /** Provider base URL (optional; defaults per provider). */
  summaryBaseUrl: string;
  /** API key for provider. Stored locally only. */
  summaryApiKey: string;
  /** Enables scheduled automated summaries. */
  summaryEnableScheduled: boolean;
  /** Summary cadence window for scheduled runs. */
  summaryFrequency: "daily" | "weekly" | "biweekly";
  /** Local time for scheduled run in HH:MM. */
  summaryTime: string;
  /** Controls expected verbosity of summary output. */
  summaryStyle: "concise" | "balanced" | "detailed";
  /** Hard cap for prompt/input payload size. */
  summaryInputTokenBudget: number;
  /** Reserved completion/output tokens. */
  summaryOutputTokenReserve: number;
  /** Max unique URLs enriched per folder, latest-first. */
  summaryMaxUrlsPerFolder: number;
}

const DEFAULT_PREFS: Prefs = {
  highlightDurationMs: 3000,
  snippetDismissMs: 12000,
  reminderNotificationEnabled: false,
  reminderNotificationHour: 9,
  unreadTrackingEnabled: false,
  unreadThresholdDays: 60,
  defaultPageSize: 50,
  onboardingCompleted: false,
  onboardingCompletedAt: undefined,
  userProfileRole: "",
  userProfileDescription: "",
  userIntendedUse: "",
  summaryByokEnabled: false,
  summaryProvider: "openai",
  summaryModel: "",
  summaryBaseUrl: "",
  summaryApiKey: "",
  summaryEnableScheduled: false,
  summaryFrequency: "weekly",
  summaryTime: "09:00",
  summaryStyle: "balanced",
  summaryInputTokenBudget: 20000,
  summaryOutputTokenReserve: 3000,
  summaryMaxUrlsPerFolder: 15,
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
