import { describe, expect, it } from "vitest";
import {
  enforceSummaryHardCap,
  getSummaryStyleCharLimits,
  MAX_SUMMARY_RUNS,
  buildNextSummaryTriggerMs,
  buildSummaryAlarmConfig,
  isSummaryInputBookmark,
  isSummaryConfigured,
  summaryScheduleEnabled,
  type SummaryRun,
  trimSummaryRuns,
} from "./summaries";
import type { Prefs } from "./storage/prefs";
import type { Bookmark } from "./types";

function makePrefs(overrides: Partial<Prefs> = {}): Prefs {
  return {
    highlightDurationMs: 3000,
    snippetDismissMs: 12000,
    reminderNotificationEnabled: false,
    reminderNotificationHour: 9,
    unreadTrackingEnabled: false,
    unreadThresholdDays: 60,
    defaultPageSize: 50,
    onboardingCompleted: true,
    onboardingCompletedAt: Date.now(),
    userProfileRole: "Engineer",
    userProfileDescription: "Focus on product + engineering outcomes.",
    userIntendedUse: "Weekly review",
    summaryByokEnabled: true,
    summaryProvider: "openai",
    summaryModel: "gpt-4.1-mini",
    summaryBaseUrl: "",
    summaryApiKey: "test-key",
    summaryEnableScheduled: true,
    summaryFrequency: "weekly",
    summaryTime: "09:00",
    summaryStyle: "balanced",
    summaryInputTokenBudget: 20000,
    summaryOutputTokenReserve: 3000,
    summaryMaxUrlsPerFolder: 15,
    ...overrides,
  };
}

describe("buildNextSummaryTriggerMs", () => {
  it("schedules later today when time is still ahead", () => {
    const now = new Date(2026, 2, 18, 8, 0, 0, 0).getTime();
    const nextMs = buildNextSummaryTriggerMs("09:30", "daily", now);
    const next = new Date(nextMs);
    expect(next.getDate()).toBe(18);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
  });

  it("schedules next day for daily when time already passed", () => {
    const now = new Date(2026, 2, 18, 10, 0, 0, 0).getTime();
    const nextMs = buildNextSummaryTriggerMs("09:30", "daily", now);
    const next = new Date(nextMs);
    expect(next.getDate()).toBe(19);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
  });

  it("schedules seven days later for weekly cadence", () => {
    const now = new Date(2026, 2, 18, 11, 0, 0, 0).getTime();
    const nextMs = buildNextSummaryTriggerMs("09:00", "weekly", now);
    const next = new Date(nextMs);
    expect(next.getDate()).toBe(25);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it("schedules fourteen days later for biweekly cadence", () => {
    const now = new Date(2026, 2, 18, 11, 0, 0, 0).getTime();
    const nextMs = buildNextSummaryTriggerMs("09:00", "biweekly", now);
    const next = new Date(nextMs);
    expect(next.getDate()).toBe(1);
    expect(next.getMonth()).toBe(3);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });
});

describe("summary configuration helpers", () => {
  it("requires onboarding + BYOK + model + api key", () => {
    expect(isSummaryConfigured(makePrefs())).toBe(true);
    expect(isSummaryConfigured(makePrefs({ onboardingCompleted: false }))).toBe(false);
    expect(isSummaryConfigured(makePrefs({ summaryByokEnabled: false }))).toBe(false);
    expect(isSummaryConfigured(makePrefs({ summaryModel: " " }))).toBe(false);
    expect(isSummaryConfigured(makePrefs({ summaryApiKey: " " }))).toBe(false);
  });

  it("enables schedule only when configured and toggle is on", () => {
    expect(summaryScheduleEnabled(makePrefs({ summaryEnableScheduled: true }))).toBe(true);
    expect(summaryScheduleEnabled(makePrefs({ summaryEnableScheduled: false }))).toBe(false);
    expect(summaryScheduleEnabled(makePrefs({ onboardingCompleted: false }))).toBe(false);
  });

  it("builds alarm config using cadence period", () => {
    const daily = buildSummaryAlarmConfig(makePrefs({ summaryFrequency: "daily" }));
    const weekly = buildSummaryAlarmConfig(makePrefs({ summaryFrequency: "weekly" }));
    const biweekly = buildSummaryAlarmConfig(makePrefs({ summaryFrequency: "biweekly" }));

    expect(daily?.periodInMinutes).toBe(1440);
    expect(weekly?.periodInMinutes).toBe(10080);
    expect(biweekly?.periodInMinutes).toBe(20160);
  });

  it("returns null config when schedule is disabled", () => {
    const disabled = buildSummaryAlarmConfig(makePrefs({ summaryEnableScheduled: false }));
    expect(disabled).toBeNull();
  });
});

describe("summary run retention", () => {
  it("trims runs to the latest configured limit", () => {
    const runs = Array.from({ length: MAX_SUMMARY_RUNS + 2 }, (_v, idx): SummaryRun => ({
      id: `run-${idx}`,
      runType: "scheduled",
      status: "completed",
      createdAt: Date.now() - idx * 1000,
      model: "gpt-4.1-mini",
      provider: "openai",
      folderCount: 1,
      snippetCount: 1,
      usedSnippetCount: 1,
      estimatedInputTokens: 100,
      outputReservedTokens: 3000,
      skippedUrls: [],
      outputText: "ok",
    }));

    const trimmed = trimSummaryRuns(runs);
    expect(trimmed).toHaveLength(MAX_SUMMARY_RUNS);
    expect(trimmed[0].id).toBe("run-0");
    expect(trimmed[MAX_SUMMARY_RUNS - 1].id).toBe(`run-${MAX_SUMMARY_RUNS - 1}`);
  });
});

describe("summary input eligibility", () => {
  it("accepts full-page bookmarks", () => {
    const page: Bookmark = {
      id: "b1",
      folderId: "f1",
      type: "PAGE",
      name: "Page only",
      url: "https://example.com/a",
      domain: "example.com",
      sortKey: "1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(isSummaryInputBookmark(page)).toBe(true);
  });

  it("accepts snippets with highlight text and rejects empty snippets", () => {
    const snippetWithText: Bookmark = {
      id: "b2",
      folderId: "f1",
      type: "SNIPPET",
      name: "Snippet",
      url: "https://example.com/b",
      domain: "example.com",
      sortKey: "2",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      snippet: { text: "Important highlighted line." },
    };
    const snippetEmpty: Bookmark = {
      id: "b3",
      folderId: "f1",
      type: "SNIPPET",
      name: "Empty snippet",
      url: "https://example.com/c",
      domain: "example.com",
      sortKey: "3",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      snippet: { text: "   " },
    };
    expect(isSummaryInputBookmark(snippetWithText)).toBe(true);
    expect(isSummaryInputBookmark(snippetEmpty)).toBe(false);
  });
});

describe("summary style character limits", () => {
  it("returns expected limits per style", () => {
    expect(getSummaryStyleCharLimits("concise")).toEqual({
      targetMin: 4000,
      targetMax: 6000,
      hardCap: 8000,
    });
    expect(getSummaryStyleCharLimits("balanced")).toEqual({
      targetMin: 8000,
      targetMax: 10000,
      hardCap: 12000,
    });
    expect(getSummaryStyleCharLimits("detailed")).toEqual({
      targetMin: 10000,
      targetMax: 12000,
      hardCap: 15000,
    });
  });

  it("enforces hard cap and appends truncation note", () => {
    const long = "a".repeat(9000);
    const clipped = enforceSummaryHardCap(long, "concise");
    expect(clipped.length).toBeLessThanOrEqual(8000);
    expect(clipped).toContain("[Summary truncated to 8000 characters.]");
  });
});
