/**
 * Shared Chrome API mock factory for Vitest tests.
 * Creates a fresh in-memory store and mock per call — no state leaks between tests.
 *
 * Usage:
 *   const { chrome, store } = makeChromeMock();
 *   (globalThis as any).chrome = chrome;
 */
import { vi } from "vitest";

export interface ChromeMockResult {
  chrome: any;
  /** Direct access to the underlying in-memory store */
  store: Record<string, unknown>;
}

export function makeChromeMock(overrides?: Record<string, any>): ChromeMockResult {
  const store: Record<string, unknown> = {};

  const chrome = {
    storage: {
      local: {
        get: vi.fn((keys: string | string[], cb: (items: Record<string, any>) => void) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, any> = {};
          for (const k of keyArr) {
            if (store[k] !== undefined) result[k] = store[k];
          }
          cb(result);
        }),
        set: vi.fn((items: Record<string, any>, cb?: () => void) => {
          Object.assign(store, items);
          cb?.();
        }),
        remove: vi.fn((_keys: string | string[], cb?: () => void) => {
          const keyArr = Array.isArray(_keys) ? _keys : [_keys];
          for (const k of keyArr) delete store[k];
          cb?.();
        }),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      lastError: null as null | { message: string },
      sendMessage: vi.fn(),
      getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
    tabs: {
      create: vi.fn(),
      query: vi.fn(),
      sendMessage: vi.fn((_tabId: number, _msg: any, cb?: (r: any) => void) => cb?.(undefined)),
      get: vi.fn(),
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn((cb?: () => void) => cb?.()),
    },
    commands: {
      onCommand: { addListener: vi.fn() },
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    ...overrides,
  };

  return { chrome, store };
}
