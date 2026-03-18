import type { Bookmark } from "./types";
import { getState } from "./storage/local";
import { storageGet, storageSet } from "./storage/chromeApi";
import { getPrefs, type Prefs } from "./storage/prefs";

const SUMMARY_RUNS_KEY = "zp_summary_runs";
export const MAX_SUMMARY_RUNS = 3;
const FETCH_TIMEOUT_MS = 12000;
const URL_FETCH_RETRY_DELAYS_MS = [0, 600, 1600];

export const SUMMARY_ALARM_NAME = "zp_summary_run";

export type SummaryRunType = "scheduled" | "bulk" | "single";
export type SummaryRunStatus = "completed" | "failed" | "skipped";
export type SummaryInputKind = "highlighted_snippet" | "page_bookmark";

export interface SummaryStyleCharLimits {
  targetMin: number;
  targetMax: number;
  hardCap: number;
}

export interface SummarySkippedUrl {
  url: string;
  reason: string;
  folderId: string;
  folderName: string;
}

export interface SummaryRun {
  id: string;
  runType: SummaryRunType;
  status: SummaryRunStatus;
  createdAt: number;
  completedAt?: number;
  windowFrom?: number;
  windowTo?: number;
  model: string;
  provider: Prefs["summaryProvider"];
  folderCount: number;
  snippetCount: number;
  usedSnippetCount: number;
  estimatedInputTokens: number;
  outputReservedTokens: number;
  skippedUrls: SummarySkippedUrl[];
  outputText?: string;
  error?: string;
}

type SummaryFolderPayload = {
  folderId: string;
  folderName: string;
  snippets: Array<{
    id: string;
    title: string;
    url: string;
    createdAt: string;
    inputType: SummaryInputKind;
    sourceType: Bookmark["type"];
    highlightedText: string;
    notes: string;
    tags: string[];
    isFavorite: boolean;
    pageExcerpt?: string;
  }>;
};

interface UrlEnrichmentResult {
  excerpt?: string;
  reason?: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function clip(text: string | undefined, maxChars: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}...` : trimmed;
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function bookmarkHasHighlight(bookmark: Bookmark): boolean {
  return Boolean((bookmark.snippet?.text ?? "").trim());
}

export function isSummaryInputBookmark(bookmark: Bookmark): boolean {
  if (bookmark.type === "PAGE") return true;
  return bookmarkHasHighlight(bookmark);
}

function summaryWindowDays(frequency: Prefs["summaryFrequency"]): number {
  if (frequency === "daily") return 1;
  if (frequency === "weekly") return 7;
  return 14;
}

function summaryPeriodMinutes(frequency: Prefs["summaryFrequency"]): number {
  if (frequency === "daily") return 1440;
  if (frequency === "weekly") return 10080;
  return 20160;
}

export function buildNextSummaryTriggerMs(
  summaryTime: string,
  frequency: Prefs["summaryFrequency"],
  nowMs = Date.now(),
): number {
  const [hhRaw, mmRaw] = summaryTime.split(":");
  const hh = Number.parseInt(hhRaw ?? "9", 10);
  const mm = Number.parseInt(mmRaw ?? "0", 10);
  const safeHour = Number.isFinite(hh) ? Math.min(23, Math.max(0, hh)) : 9;
  const safeMin = Number.isFinite(mm) ? Math.min(59, Math.max(0, mm)) : 0;

  const now = new Date(nowMs);
  const next = new Date(nowMs);
  next.setHours(safeHour, safeMin, 0, 0);

  const dayStep = summaryWindowDays(frequency);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + dayStep);
  }
  return next.getTime();
}

export function isSummaryConfigured(prefs: Prefs): boolean {
  return Boolean(
    prefs.onboardingCompleted &&
    prefs.summaryByokEnabled &&
    prefs.summaryApiKey.trim() &&
    prefs.summaryModel.trim(),
  );
}

export function summaryScheduleEnabled(prefs: Prefs): boolean {
  return prefs.summaryEnableScheduled && isSummaryConfigured(prefs);
}

export async function listSummaryRuns(): Promise<SummaryRun[]> {
  const runs = await storageGet<SummaryRun[]>(SUMMARY_RUNS_KEY);
  if (!Array.isArray(runs)) return [];
  const trimmed = trimSummaryRuns(runs);
  if (trimmed.length !== runs.length) {
    await storageSet(SUMMARY_RUNS_KEY, trimmed);
  }
  return trimmed;
}

export function trimSummaryRuns(runs: SummaryRun[]): SummaryRun[] {
  return runs.slice(0, MAX_SUMMARY_RUNS);
}

async function persistSummaryRun(run: SummaryRun): Promise<void> {
  const runs = await listSummaryRuns();
  const next = trimSummaryRuns([run, ...runs]);
  await storageSet(SUMMARY_RUNS_KEY, next);
}

export function getSummaryStyleCharLimits(style: Prefs["summaryStyle"]): SummaryStyleCharLimits {
  if (style === "concise") {
    return { targetMin: 4000, targetMax: 6000, hardCap: 8000 };
  }
  if (style === "detailed") {
    return { targetMin: 10000, targetMax: 12000, hardCap: 15000 };
  }
  return { targetMin: 8000, targetMax: 10000, hardCap: 12000 };
}

export function enforceSummaryHardCap(text: string, style: Prefs["summaryStyle"]): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const { hardCap } = getSummaryStyleCharLimits(style);
  if (trimmed.length <= hardCap) return trimmed;
  const note = `[Summary truncated to ${hardCap} characters.]`;
  const room = Math.max(0, hardCap - (note.length + 2));
  return `${trimmed.slice(0, room).trimEnd()}\n\n${note}`;
}

function buildSystemPrompt(style: Prefs["summaryStyle"]): string {
  const limits = getSummaryStyleCharLimits(style);
  const styleHint =
    style === "concise"
      ? "Keep it concise and highly actionable."
      : style === "detailed"
        ? "Provide detailed explanations and concrete action plans."
        : "Balance brevity with clear explanation.";
  return [
    "You are ZeroPin's summarization assistant.",
    "You must summarize bookmark inputs by folder using the provided payload only.",
    "Treat highlighted_snippet inputs as primary user intent evidence.",
    "Treat page_bookmark inputs as page-level summaries when no highlight exists.",
    "When pageExcerpt exists, use it as context only; do not override highlighted text.",
    "For each input, explicitly describe relation to article context using one of:",
    "supports | extends | contrasts | insufficient-context | page-level.",
    "Prefer evidence-backed claims and reference bookmark IDs in parentheses like (snippet: abc).",
    "Output markdown with these sections:",
    "1) Overall Summary",
    "2) Folder-by-Folder Summary",
    "3) Action Items",
    "4) Skipped URLs Notes",
    "Inside each folder, each input should include:",
    "- Highlighted Insight (or Page Takeaway)",
    "- Article Context",
    "- Relation Label",
    "- Why It Matters to User",
    "- Suggested Next Action",
    `Target summary length: ${limits.targetMin}-${limits.targetMax} characters.`,
    `Hard limit: do not exceed ${limits.hardCap} characters in total output.`,
    styleHint,
  ].join("\n");
}

function extractTextFromHtml(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const articleMatch = withoutScripts.match(/<article[\s\S]*?<\/article>/i);
  const candidate = articleMatch ? articleMatch[0] : withoutScripts;
  const noTags = candidate.replace(/<[^>]+>/g, " ");
  return noTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pickRelevantExcerpt(pageText: string, snippetText: string, notes: string): string {
  const maxChars = 1700;
  const seedWords = `${snippetText} ${notes}`
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 5)
    .slice(0, 10);
  const lower = pageText.toLowerCase();
  for (const word of seedWords) {
    const idx = lower.indexOf(word);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 500);
    return pageText.slice(start, start + maxChars);
  }
  return pageText.slice(0, maxChars);
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, { signal, credentials: "omit" });
}

async function enrichUrl(url: string, snippetText: string, notes: string): Promise<UrlEnrichmentResult> {
  let lastReason = "unknown";
  for (let i = 0; i < URL_FETCH_RETRY_DELAYS_MS.length; i++) {
    const delay = URL_FETCH_RETRY_DELAYS_MS[i];
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { reason: `auth_${res.status}` };
        }
        lastReason = `http_${res.status}`;
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return { reason: "non_html" };
      }
      const html = await res.text();
      const text = extractTextFromHtml(html);
      if (!text) {
        return { reason: "empty_extract" };
      }
      return { excerpt: pickRelevantExcerpt(text, snippetText, notes) };
    } catch (err) {
      const msg = String(err).toLowerCase();
      if (msg.includes("abort")) lastReason = "timeout";
      else if (msg.includes("failed to fetch")) lastReason = "fetch_failed";
      else lastReason = "network_error";
    }
  }
  return { reason: lastReason };
}

function normalizeBaseUrl(provider: Prefs["summaryProvider"], baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed) return trimmed;
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  if (provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  return "https://api.openai.com/v1";
}

function extractOpenAIText(data: any): string {
  const choice = data?.choices?.[0];
  if (!choice) return "";
  const content = choice.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("\n");
  }
  return "";
}

function extractAnthropicText(data: any): string {
  const parts = Array.isArray(data?.content) ? data.content : [];
  return parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}

function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}

async function callByokModel(
  prefs: Prefs,
  systemPrompt: string,
  payloadJson: string,
): Promise<string> {
  const provider = prefs.summaryProvider;
  const model = prefs.summaryModel.trim();
  const apiKey = prefs.summaryApiKey.trim();
  const base = normalizeBaseUrl(provider, prefs.summaryBaseUrl);

  if (provider === "anthropic") {
    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: prefs.summaryOutputTokenReserve,
        system: systemPrompt,
        messages: [{ role: "user", content: payloadJson }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Anthropic request failed (${res.status})`);
    }
    const text = extractAnthropicText(data);
    if (!text.trim()) throw new Error("Anthropic returned empty output");
    return text.trim();
  }

  if (provider === "gemini") {
    const modelPath = model.startsWith("models/") ? model.slice("models/".length) : model;
    const url = `${base}/models/${encodeURIComponent(modelPath)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${payloadJson}` }] }],
        generationConfig: {
          maxOutputTokens: prefs.summaryOutputTokenReserve,
          temperature: 0.2,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Gemini request failed (${res.status})`);
    }
    const text = extractGeminiText(data);
    if (!text.trim()) throw new Error("Gemini returned empty output");
    return text.trim();
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: prefs.summaryOutputTokenReserve,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: payloadJson },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenAI-compatible request failed (${res.status})`);
  }
  const text = extractOpenAIText(data);
  if (!text.trim()) throw new Error("Model returned empty output");
  return text.trim();
}

function collectScheduledBookmarks(
  bookmarks: Bookmark[],
  frequency: Prefs["summaryFrequency"],
): Bookmark[] {
  const now = Date.now();
  const windowMs = summaryWindowDays(frequency) * 24 * 60 * 60 * 1000;
  const fromTs = now - windowMs;
  return bookmarks
    .filter((b) => b.createdAt >= fromTs && isSummaryInputBookmark(b))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function buildSummaryPayload(
  bookmarks: Bookmark[],
  prefs: Prefs,
): Promise<{
  payload: Record<string, unknown>;
  estimatedTokens: number;
  skippedUrls: SummarySkippedUrl[];
  folderCount: number;
  usedSnippetCount: number;
}> {
  const state = await getState();
  const folders = state.folders;
  const grouped = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const arr = grouped.get(bookmark.folderId) ?? [];
    arr.push(bookmark);
    grouped.set(bookmark.folderId, arr);
  }

  const folderPayloads: SummaryFolderPayload[] = [];
  const skippedUrls: SummarySkippedUrl[] = [];
  const urlCache = new Map<string, UrlEnrichmentResult>();
  const maxUrlsPerFolder = Math.max(1, prefs.summaryMaxUrlsPerFolder);

  const folderEntries = [...grouped.entries()].sort((a, b) => {
    const an = folders[a[0]]?.name ?? "Unknown";
    const bn = folders[b[0]]?.name ?? "Unknown";
    return an.localeCompare(bn);
  });

  for (const [folderId, folderBookmarksRaw] of folderEntries) {
    const folderBookmarks = [...folderBookmarksRaw].sort((a, b) => b.createdAt - a.createdAt);
    const folderName = folders[folderId]?.name ?? "Unknown folder";
    const urlsForEnrichment = uniqueInOrder(folderBookmarks.map((s) => s.url)).slice(0, maxUrlsPerFolder);

    for (const url of urlsForEnrichment) {
      if (urlCache.has(url)) continue;
      const sampleBookmark = folderBookmarks.find((s) => s.url === url);
      const enriched = await enrichUrl(
        url,
        sampleBookmark?.snippet?.text ?? sampleBookmark?.name ?? "",
        sampleBookmark?.notes ?? "",
      );
      urlCache.set(url, enriched);
      if (!enriched.excerpt) {
        skippedUrls.push({
          url,
          reason: enriched.reason ?? "enrichment_failed",
          folderId,
          folderName,
        });
      }
    }

    const snippetsForFolder = folderBookmarks.map((bookmark) => {
      const enrichment = urlCache.get(bookmark.url);
      const hasHighlight = bookmarkHasHighlight(bookmark);
      const inputType: SummaryInputKind = hasHighlight ? "highlighted_snippet" : "page_bookmark";
      return {
        id: bookmark.id,
        title: clip(bookmark.name, 180),
        url: bookmark.url,
        createdAt: new Date(bookmark.createdAt).toISOString(),
        inputType,
        sourceType: bookmark.type,
        highlightedText: hasHighlight
          ? clip(bookmark.snippet?.text, 700)
          : clip(bookmark.name, 700),
        notes: clip(bookmark.notes, 400),
        tags: Array.isArray(bookmark.tags) ? bookmark.tags : [],
        isFavorite: Boolean(bookmark.isFavorite),
        ...(enrichment?.excerpt ? { pageExcerpt: clip(enrichment.excerpt, 1800) } : {}),
      };
    });

    folderPayloads.push({ folderId, folderName, snippets: snippetsForFolder });
  }

  const payload: Record<string, unknown> = {
    meta: {
      generatedAt: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      inputTokenBudget: prefs.summaryInputTokenBudget,
      outputTokenReserve: prefs.summaryOutputTokenReserve,
      frequency: prefs.summaryFrequency,
      style: prefs.summaryStyle,
    },
    userContext: {
      role: prefs.userProfileRole,
      profile: prefs.userProfileDescription,
      intendedUse: prefs.userIntendedUse,
    },
    folders: folderPayloads,
    skippedUrls,
  };

  // Deterministic budget enforcement:
  // 1) remove excerpts from oldest inputs
  // 2) remove oldest inputs
  let estimated = estimateTokens(JSON.stringify(payload));
  while (estimated > prefs.summaryInputTokenBudget) {
    let removedExcerpt = false;
    for (let i = folderPayloads.length - 1; i >= 0; i--) {
      const snippetsForFolder = folderPayloads[i].snippets;
      for (let j = snippetsForFolder.length - 1; j >= 0; j--) {
        if (!snippetsForFolder[j].pageExcerpt) continue;
        delete snippetsForFolder[j].pageExcerpt;
        removedExcerpt = true;
        break;
      }
      if (removedExcerpt) break;
    }
    if (removedExcerpt) {
      estimated = estimateTokens(JSON.stringify(payload));
      continue;
    }

    let removedInput = false;
    for (let i = folderPayloads.length - 1; i >= 0; i--) {
      const snippetsForFolder = folderPayloads[i].snippets;
      if (snippetsForFolder.length === 0) continue;
      snippetsForFolder.pop();
      removedInput = true;
      break;
    }
    if (!removedInput) break;
    estimated = estimateTokens(JSON.stringify(payload));
  }

  const usedSnippetCount = folderPayloads.reduce((acc, f) => acc + f.snippets.length, 0);

  return {
    payload,
    estimatedTokens: estimated,
    skippedUrls,
    folderCount: folderPayloads.length,
    usedSnippetCount,
  };
}

async function runSummaryInternal(
  runType: SummaryRunType,
  snippets: Bookmark[],
  prefs: Prefs,
  windowFrom?: number,
  windowTo?: number,
): Promise<SummaryRun> {
  const baseRun = {
    id: crypto.randomUUID(),
    runType,
    createdAt: Date.now(),
    model: prefs.summaryModel.trim(),
    provider: prefs.summaryProvider,
    snippetCount: snippets.length,
    outputReservedTokens: prefs.summaryOutputTokenReserve,
  };

  if (!isSummaryConfigured(prefs)) {
    const skipped: SummaryRun = {
      ...baseRun,
      status: "skipped",
      folderCount: 0,
      usedSnippetCount: 0,
      estimatedInputTokens: 0,
      skippedUrls: [],
      error: "BYOK setup is incomplete. Complete onboarding/settings first.",
      ...(windowFrom != null ? { windowFrom } : {}),
      ...(windowTo != null ? { windowTo } : {}),
    };
    await persistSummaryRun(skipped);
    return skipped;
  }

  if (snippets.length === 0) {
    const skipped: SummaryRun = {
      ...baseRun,
      status: "skipped",
      folderCount: 0,
      usedSnippetCount: 0,
      estimatedInputTokens: 0,
      skippedUrls: [],
      error: "No bookmarks found for this summary run.",
      ...(windowFrom != null ? { windowFrom } : {}),
      ...(windowTo != null ? { windowTo } : {}),
    };
    await persistSummaryRun(skipped);
    return skipped;
  }

  try {
    const { payload, estimatedTokens, skippedUrls, folderCount, usedSnippetCount } = await buildSummaryPayload(snippets, prefs);
    if (usedSnippetCount === 0) {
      const skipped: SummaryRun = {
        ...baseRun,
        status: "skipped",
        folderCount,
        usedSnippetCount,
        estimatedInputTokens: estimatedTokens,
        skippedUrls,
        error: "Input budget removed all inputs. Increase token budget.",
        ...(windowFrom != null ? { windowFrom } : {}),
        ...(windowTo != null ? { windowTo } : {}),
      };
      await persistSummaryRun(skipped);
      return skipped;
    }

    const rawOutputText = await callByokModel(
      prefs,
      buildSystemPrompt(prefs.summaryStyle),
      JSON.stringify(payload, null, 2),
    );
    const outputText = enforceSummaryHardCap(rawOutputText, prefs.summaryStyle);

    const run: SummaryRun = {
      ...baseRun,
      status: "completed",
      completedAt: Date.now(),
      folderCount,
      usedSnippetCount,
      estimatedInputTokens: estimatedTokens,
      skippedUrls,
      outputText,
      ...(windowFrom != null ? { windowFrom } : {}),
      ...(windowTo != null ? { windowTo } : {}),
    };
    await persistSummaryRun(run);
    return run;
  } catch (err) {
    const failed: SummaryRun = {
      ...baseRun,
      status: "failed",
      completedAt: Date.now(),
      folderCount: 0,
      usedSnippetCount: 0,
      estimatedInputTokens: 0,
      skippedUrls: [],
      error: String(err),
      ...(windowFrom != null ? { windowFrom } : {}),
      ...(windowTo != null ? { windowTo } : {}),
    };
    await persistSummaryRun(failed);
    return failed;
  }
}

export async function runScheduledSummary(prefsInput?: Prefs): Promise<SummaryRun | null> {
  const prefs = prefsInput ?? await getPrefs();
  if (!summaryScheduleEnabled(prefs)) return null;

  const state = await getState();
  const all = Object.values(state.bookmarks);
  const snippets = collectScheduledBookmarks(all, prefs.summaryFrequency);

  const windowTo = Date.now();
  const windowFrom = windowTo - summaryWindowDays(prefs.summaryFrequency) * 24 * 60 * 60 * 1000;
  return runSummaryInternal("scheduled", snippets, prefs, windowFrom, windowTo);
}

export async function runInstantSummary(
  bookmarkIds: string[],
  runType: "bulk" | "single",
  prefsInput?: Prefs,
): Promise<SummaryRun> {
  const prefs = prefsInput ?? await getPrefs();
  const state = await getState();
  const snippets = bookmarkIds
    .map((id) => state.bookmarks[id])
    .filter((b): b is Bookmark => Boolean(b && isSummaryInputBookmark(b)))
    .sort((a, b) => b.createdAt - a.createdAt);
  return runSummaryInternal(runType, snippets, prefs);
}

export function buildSummaryAlarmConfig(prefs: Prefs): { when: number; periodInMinutes: number } | null {
  if (!summaryScheduleEnabled(prefs)) return null;
  return {
    when: buildNextSummaryTriggerMs(prefs.summaryTime, prefs.summaryFrequency),
    periodInMinutes: summaryPeriodMinutes(prefs.summaryFrequency),
  };
}
