import { describe, it, expect } from "vitest";
import type { TagDef } from "./types";

// Ensure window.ai is absent so Gemini Nano path is skipped and heuristics run
(globalThis as any).window = {};

// Must import AFTER globals are set up
import { suggestTagIds } from "./aiTags";

function makeTag(id: string, name: string): TagDef {
  return { id, name, createdAt: 1000, updatedAt: 1000 };
}

describe("suggestTagIds", () => {
  it("returns [] when tagDefs is empty", async () => {
    const result = await suggestTagIds(
      { url: "https://github.com/foo/bar", title: "foo" },
      {}
    );
    expect(result).toEqual([]);
  });

  it("matches GitHub URL to dev-related tags (domain heuristics)", async () => {
    const tagDefs: Record<string, TagDef> = {
      t1: makeTag("t1", "dev"),
      t2: makeTag("t2", "recipes"),
    };
    const result = await suggestTagIds(
      { url: "https://github.com/some/repo", title: "Some Repo" },
      tagDefs
    );
    expect(result).toContain("t1");
    expect(result).not.toContain("t2");
  });

  it("matches YouTube URL to video-related tags", async () => {
    const tagDefs: Record<string, TagDef> = {
      v1: makeTag("v1", "video"),
      v2: makeTag("v2", "watch"),
      u1: makeTag("u1", "unrelated"),
    };
    const result = await suggestTagIds(
      { url: "https://www.youtube.com/watch?v=abc123", title: "Some Video" },
      tagDefs
    );
    expect(result).toContain("v1");
    expect(result).toContain("v2");
    expect(result).not.toContain("u1");
  });

  it("returns [] when URL does not match any domain pattern", async () => {
    const tagDefs: Record<string, TagDef> = {
      t1: makeTag("t1", "cooking"),
      t2: makeTag("t2", "travel"),
    };
    const result = await suggestTagIds(
      { url: "https://totally-random-site-xyz.com/page", title: "Random" },
      tagDefs
    );
    expect(result).toEqual([]);
  });

  it("is case-insensitive when matching tag names to keywords", async () => {
    const tagDefs: Record<string, TagDef> = {
      t1: makeTag("t1", "Dev"),
      t2: makeTag("t2", "CODE"),
    };
    const result = await suggestTagIds(
      { url: "https://stackoverflow.com/questions/1", title: "A Question" },
      tagDefs
    );
    expect(result).toContain("t1");
    expect(result).toContain("t2");
  });

  it("matches docs-related tags for documentation URLs", async () => {
    const tagDefs: Record<string, TagDef> = {
      d1: makeTag("d1", "docs"),
      d2: makeTag("d2", "reference"),
      x1: makeTag("x1", "social"),
    };
    const result = await suggestTagIds(
      { url: "https://docs.python.org/3/library/", title: "Python Docs" },
      tagDefs
    );
    expect(result).toContain("d1");
    expect(result).toContain("d2");
    expect(result).not.toContain("x1");
  });
});
