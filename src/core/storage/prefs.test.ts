import { describe, it, expect, beforeEach } from "vitest";

// ── Mock chrome.storage.local ──

let store: Record<string, any> = {};

(globalThis as any).chrome = {
  storage: {
    local: {
      get(keys: string[], cb: (items: Record<string, any>) => void) {
        const result: Record<string, any> = {};
        for (const k of keys) {
          if (store[k] !== undefined) result[k] = store[k];
        }
        cb(result);
      },
      set(items: Record<string, any>, cb: () => void) {
        Object.assign(store, items);
        cb();
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: { lastError: null },
};

// Must import AFTER mock is set up
import { getPrefs, setPrefs } from "./prefs";

beforeEach(() => {
  store = {};
});

describe("getPrefs", () => {
  it("returns full defaults when nothing is stored", async () => {
    const p = await getPrefs();
    expect(p.highlightDurationMs).toBe(3000);
    expect(p.snippetDismissMs).toBe(12000);
    expect(p.reminderNotificationEnabled).toBe(false);
    expect(p.reminderNotificationHour).toBe(9);
  });

  it("returns stored values when present", async () => {
    store["zp_prefs"] = { highlightDurationMs: 5000, snippetDismissMs: 20000 };
    const p = await getPrefs();
    expect(p.highlightDurationMs).toBe(5000);
    expect(p.snippetDismissMs).toBe(20000);
  });

  it("falls back to default for any missing field", async () => {
    store["zp_prefs"] = { highlightDurationMs: 7000 };
    const p = await getPrefs();
    expect(p.highlightDurationMs).toBe(7000);
    expect(p.snippetDismissMs).toBe(12000); // default
  });
});

describe("setPrefs", () => {
  it("persists a partial update and leaves other fields at default", async () => {
    await setPrefs({ highlightDurationMs: 5000 });
    const p = await getPrefs();
    expect(p.highlightDurationMs).toBe(5000);
    expect(p.snippetDismissMs).toBe(12000);
  });

  it("persists both fields when both are provided", async () => {
    await setPrefs({ highlightDurationMs: 8000, snippetDismissMs: 25000 });
    const p = await getPrefs();
    expect(p.highlightDurationMs).toBe(8000);
    expect(p.snippetDismissMs).toBe(25000);
  });

  it("empty update leaves existing values unchanged", async () => {
    await setPrefs({ snippetDismissMs: 15000 });
    await setPrefs({});
    const p = await getPrefs();
    expect(p.snippetDismissMs).toBe(15000);
  });

  it("subsequent partial updates merge correctly", async () => {
    await setPrefs({ highlightDurationMs: 4000 });
    await setPrefs({ snippetDismissMs: 18000 });
    const p = await getPrefs();
    expect(p.highlightDurationMs).toBe(4000);
    expect(p.snippetDismissMs).toBe(18000);
  });

  it("persists reminderNotificationEnabled", async () => {
    await setPrefs({ reminderNotificationEnabled: true });
    const p = await getPrefs();
    expect(p.reminderNotificationEnabled).toBe(true);
  });

  it("persists reminderNotificationHour and leaves other fields at default", async () => {
    await setPrefs({ reminderNotificationHour: 8 });
    const p = await getPrefs();
    expect(p.reminderNotificationHour).toBe(8);
    expect(p.reminderNotificationEnabled).toBe(false);
    expect(p.highlightDurationMs).toBe(3000);
  });

  it("persists defaultPageSize", async () => {
    await setPrefs({ defaultPageSize: 100 });
    const p = await getPrefs();
    expect(p.defaultPageSize).toBe(100);
  });

  it("defaultPageSize falls back to 50 when unset", async () => {
    const p = await getPrefs();
    expect(p.defaultPageSize).toBe(50);
  });
});
