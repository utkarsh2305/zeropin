import type { TagDef, TagId } from "./types";

export interface SuggestInput {
  url: string;
  title: string;
  snippet?: string;
}

/**
 * Returns IDs of existing tags most relevant to this bookmark.
 * Tries Gemini Nano first (window.ai); falls back to domain heuristics.
 * Never creates new tags — only matches against tagDefs provided.
 */
export async function suggestTagIds(
  input: SuggestInput,
  tagDefs: Record<string, TagDef>
): Promise<TagId[]> {
  const tagList = Object.values(tagDefs);
  if (tagList.length === 0) return [];

  // 1. Try Gemini Nano
  const nanoIds = await tryGeminiNano(input, tagList);
  if (nanoIds.length > 0) return nanoIds;

  // 2. Fall back to domain heuristics
  return domainHeuristics(input.url, tagList);
}

async function tryGeminiNano(
  input: SuggestInput,
  tagList: TagDef[]
): Promise<TagId[]> {
  try {
    const ai = (window as any).ai;
    if (!ai?.languageModel) return [];

    const cap = await withTimeout(ai.languageModel.capabilities(), 2000) as any;
    if (!cap || cap.available === "no") return [];

    const tagNames = tagList.map((t) => t.name).join(", ");
    const session = await withTimeout(
      ai.languageModel.create({
        systemPrompt:
          "You suggest bookmark tags. Given a title and URL, return 2-4 relevant tags " +
          "chosen ONLY from the provided list. Output only the tag names, comma-separated, lowercase. No explanation.",
      }),
      3000
    ) as any;

    const prompt =
      `Title: "${input.title}"\nURL: ${input.url}` +
      (input.snippet ? `\nSnippet: "${input.snippet.slice(0, 200)}"` : "") +
      `\nAvailable tags: ${tagNames}`;

    const response: string = await withTimeout(session.prompt(prompt), 3000);
    session.destroy();

    const suggested = response
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    return tagList
      .filter((t) => suggested.includes(t.name.toLowerCase()))
      .map((t) => t.id);
  } catch {
    return [];
  }
}

// Domain pattern → keyword buckets that are matched against the user's existing tag names
const DOMAIN_PATTERNS: Array<{ test: RegExp; keywords: string[] }> = [
  {
    test: /github\.com|gitlab\.|bitbucket\.org|stackoverflow\.com|dev\.to|npmjs\.com|codepen\.io/i,
    keywords: ["dev", "code", "programming", "tech", "github", "engineering"],
  },
  {
    test: /youtube\.com|vimeo\.com|twitch\.tv|dailymotion\.com/i,
    keywords: ["video", "watch", "media", "tutorial"],
  },
  {
    test: /docs\.|documentation\.|readthedocs\.|developer\.|api\./i,
    keywords: ["docs", "reference", "documentation", "api"],
  },
  {
    test: /medium\.com|substack\.com|hashnode\.com|blogger\.com|wordpress\.com/i,
    keywords: ["article", "blog", "read", "writing"],
  },
  {
    test: /twitter\.com|x\.com|reddit\.com/i,
    keywords: ["social", "news", "community"],
  },
  {
    test: /bbc\.|cnn\.|nytimes\.com|theguardian\.|reuters\.|techcrunch\.|ycombinator\./i,
    keywords: ["news", "article", "read"],
  },
  {
    test: /figma\.com|dribbble\.com|behance\.net/i,
    keywords: ["design", "ui", "ux", "inspiration"],
  },
  {
    test: /arxiv\.org|scholar\.google\.|pubmed\.|researchgate\./i,
    keywords: ["research", "paper", "academic", "science"],
  },
  {
    test: /notion\.so|obsidian\.md|roamresearch\.|logseq\./i,
    keywords: ["notes", "productivity", "tools"],
  },
  {
    test: /amazon\.|shop\.|store\.|etsy\./i,
    keywords: ["shopping", "buy", "product"],
  },
];

function domainHeuristics(url: string, tagList: TagDef[]): TagId[] {
  let domain = "";
  try {
    domain = new URL(url).hostname;
  } catch {
    return [];
  }

  const matched = new Set<string>();
  for (const p of DOMAIN_PATTERNS) {
    if (p.test.test(domain)) {
      p.keywords.forEach((k) => matched.add(k));
    }
  }
  if (matched.size === 0) return [];

  return tagList
    .filter((t) =>
      [...matched].some(
        (kw) =>
          t.name.toLowerCase().includes(kw) ||
          kw.includes(t.name.toLowerCase())
      )
    )
    .map((t) => t.id);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("AI suggestion timeout")), ms)
    ),
  ]);
}
