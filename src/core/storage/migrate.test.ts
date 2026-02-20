import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION } from "../types";
import { migrateState } from "./migrate";

describe("migrateState", () => {
  const baseState = {
    rootFolderId: "root",
    inboxFolderId: "inbox",
    folders: {
      root: { id: "root", parentId: null, name: "ZeroPin", sortKey: "m", createdAt: 1000, updatedAt: 1000 },
      inbox: { id: "inbox", parentId: "root", name: "Inbox", sortKey: "a", createdAt: 1000, updatedAt: 1000 },
    },
    bookmarks: {
      b1: { id: "b1", folderId: "inbox", type: "PAGE", name: "Example", url: "https://example.com", domain: "example.com", sortKey: "1", createdAt: 1000, updatedAt: 1000 },
    },
  };

  it("missing schemaVersion → treated as v0, migrated to current", () => {
    const raw = { ...baseState };
    const result = migrateState(raw);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("v0 state → gets bookmarks={} if missing, migrated to current", () => {
    const raw = { schemaVersion: 0, rootFolderId: "root", inboxFolderId: "inbox", folders: baseState.folders };
    const result = migrateState(raw);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.bookmarks).toEqual({});
  });

  it("v1 state → bookmarks get notes='' default", () => {
    const raw = { ...baseState, schemaVersion: 1 };
    const result = migrateState(raw);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.bookmarks["b1"].notes).toBe("");
  });

  it("v2 state → bookmarks get snippetHash=undefined", () => {
    const raw = {
      ...baseState,
      schemaVersion: 2,
      bookmarks: {
        b1: { ...baseState.bookmarks.b1, notes: "" },
      },
    };
    const result = migrateState(raw);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect("snippetHash" in result.bookmarks["b1"]).toBe(true);
  });

  it("v3 state → bookmarks get analytics defaults", () => {
    const raw = { ...baseState, schemaVersion: 3 };
    const result = migrateState(raw);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.bookmarks["b1"].openCount).toBe(0);
    expect(result.bookmarks["b1"].lastOpenedAt).toBe(0);
    expect(result.bookmarks["b1"].lastResolvedConfidence).toBeUndefined();
  });

  it("v4 state → migrated to current (folders get color field, inbox removed)", () => {
    const raw = { ...baseState, schemaVersion: 4 };
    const result = migrateState(raw);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.bookmarks["b1"].name).toBe("Example");
    expect("color" in result.folders["root"]).toBe(true);
  });

  it("v5 state → migrated to v6 (inbox folder removed, bookmarks moved to root)", () => {
    const raw = { ...baseState, schemaVersion: 5 };
    const result = migrateState(raw);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.bookmarks["b1"].folderId).toBe("root");
    expect(result.folders["inbox"]).toBeUndefined();
    expect(result.inboxFolderId).toBeUndefined();
  });

  it("future version (v99) → returned as-is, no downgrade", () => {
    const raw = { ...baseState, schemaVersion: 99, extraField: "future" } as any;
    const result = migrateState(raw);
    expect(result.schemaVersion).toBe(99);
    expect((result as any).extraField).toBe("future");
  });

  it("existing data preserved through full migration", () => {
    const raw = {
      schemaVersion: 0,
      rootFolderId: "root",
      inboxFolderId: "inbox",
      folders: {
        root: { id: "root", parentId: null, name: "ZeroPin", sortKey: "m", createdAt: 1000, updatedAt: 1000 },
        inbox: { id: "inbox", parentId: "root", name: "Inbox", sortKey: "a", createdAt: 1000, updatedAt: 1000 },
      },
      bookmarks: {
        b1: { id: "b1", folderId: "inbox", type: "SNIPPET", name: "Snippet", url: "https://example.com", domain: "example.com", sortKey: "1", createdAt: 2000, updatedAt: 2000, snippet: { text: "hello" } },
      },
    };
    const result = migrateState(raw);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.bookmarks["b1"].url).toBe("https://example.com");
    expect(result.bookmarks["b1"].snippet?.text).toBe("hello");
    expect(result.bookmarks["b1"].folderId).toBe("root");
    expect(result.folders["root"].name).toBe("ZeroPin");
    expect(result.folders["inbox"]).toBeUndefined();
  });

  it("idempotent — running twice produces same result", () => {
    const raw = { ...baseState, schemaVersion: 0 };
    const first = migrateState(raw);
    const second = migrateState({ ...first });
    expect(second).toEqual(first);
  });
});
