# ZeroPin

A Chrome extension (Manifest V3) that saves and organizes web and AI bookmarks locally. Capture full pages or text snippets, highlight saved passages when revisited, and detect AI chat context from platforms like ChatGPT and Claude.

## Features

**Saving**
- Right-click "Save to ZeroPin" or press `Ctrl+Shift+P` (`Cmd+Shift+P` on Mac)
- Save full pages or selected text as snippet bookmarks
- Snippets are highlighted when the page is reopened
- YouTube Moment Pins: saving a YouTube watch page captures the current playback timestamp; the pin reopens the video at exactly that moment and displays a `▶ HH:MM` badge in the library
- AI chat detection: captures platform, role (user/assistant), and conversation metadata from ChatGPT, Claude, Gemini, Copilot, Poe, Perplexity, Grok, DeepSeek, and Mistral
- AI chat pins show a floating snippet card with auto-copy to clipboard (Ctrl+F / ⌘F to find, Ctrl+V / ⌘V to paste)
- Snippet card follows your selected theme (dark/light/system)

**Library**
- Folder hierarchy with collapsible tree, drag-and-drop reordering, and custom emoji icons
- Empty folder indicator — subtle grey dot on empty folder rows in the sidebar tree
- Search across name, URL, domain, snippet text, and notes with inline clear (×) button
- Multi-folder search scope — folder scope picker integrated inside the search bar; select folders from a tree view with parent/child indentation
- Parent folder auto-select — selecting a parent in search scope also selects all descendant folders
- Compact scope summary — shows filtered folders as `name1, name2 +N` (or `All folders`) under search
- Multi-tag intersection filtering — bookmark must match **all** selected tags to appear
- Sidebar tag narrowing — tag list automatically collapses to only tags present in the current result set, accounting for active search query, dashboard filter, and tag filters
- Page grouping by URL with collapsible groups
- Favourites — heart button on each card; dedicated chip on the health dashboard
- Notes per bookmark; notes chip on the health dashboard filters to bookmarks with saved notes
- Dead link detection — on-demand scan with progress indicator; chip filters to broken URLs
- Reminders with specific time — reminder picker includes a time input; quick presets default to 09:00; due reminders surfaced in the Reminders panel and popup badge
- Inline rename for bookmarks and folders (no modal dialog)
- Bulk select with bulk move, delete, and tag add/remove
- AI summaries (BYOK): instant per-bookmark, instant bulk selection, and scheduled daily/weekly/biweekly summaries
- Folder-segmented summary output with URL enrichment (latest-first URL cap per folder, retry + skip handling)
- Summary history retention: latest 3 runs kept locally; each run can be downloaded as `.txt`
- Optional "Listen" playback for summary text using `chrome.tts` local voices only (remote voices excluded)
- Date range filter
- Keyboard shortcuts: ↑ ↓ navigate · → open · ← delete · Enter open · E rename · Delete remove · ? shortcuts panel
- Command palette — `Ctrl+K` / `⌘K` fuzzy-search across bookmarks, folders, and quick actions
- Export/import library as JSON; import from browser bookmark HTML files (Chrome, Firefox, Safari, Edge)

**Popup**
- Compact toolbar popup with search and in-field folder scope filter
- Folder scope shown as compact summary (`All folders` or `name1, name2 +N`) below search
- Quick access to full Library
- Reminder badge when due reminders exist; due reminders listed inline

**Theme**
- Auto-detects system dark/light mode
- Manual override cycling: System → Dark → Light
- Persisted preference with migration from legacy format

**Onboarding & AI Setup**
- First-run setup captures user role/profile, intended usage, summary cadence/time, and BYOK provider settings
- Walkthrough includes a `Continue to Summary Setup` handoff into Library onboarding
- Provider-specific onboarding hints with direct links for generating API keys
- API keys are stored locally on-device (`chrome.storage.local`); ZeroPin does not run a backend and does not collect/share keys
- Summary features are gated until setup is completed

## AI Summary Setup (BYOK)

You can configure BYOK from onboarding or from `Settings -> Summary & AI`.

1. Choose provider: `OpenAI-compatible`, `Anthropic`, or `Gemini`.
2. Add your model ID and API key.
3. Keep `Base URL` empty unless you use a custom proxy or compatible endpoint.

Provider key/docs links used in onboarding:
- OpenAI key page: `https://platform.openai.com/api-keys`
- OpenAI docs: `https://platform.openai.com/docs/quickstart`
- Anthropic key page: `https://console.anthropic.com/settings/keys`
- Anthropic docs: `https://docs.anthropic.com/en/api/getting-started`
- Gemini key page: `https://aistudio.google.com/app/apikey`
- Gemini docs: `https://ai.google.dev/gemini-api/docs`

## Summary Storage Policy

- Summary runs are stored in `chrome.storage.local`.
- ZeroPin retains only the latest `3` summary runs and auto-removes older runs.
- Each summary run can be downloaded as a `.txt` file from the Summary Runs dialog.
- This keeps local extension storage usage predictable while still allowing long-term archiving via download.

## AI Summary Use Case, Logic, and Journey

### Primary Use Case

Users save many snippets during research/work and need periodic, actionable rollups instead of manually reviewing each snippet.

ZeroPin supports:
1. Scheduled summaries: `daily`, `weekly`, or `biweekly`
2. Instant single-bookmark summaries from each bookmark card
3. Instant bulk summaries from multi-select actions

### User Journey

1. Complete onboarding in Library with role/profile, intended usage, cadence/time, and BYOK settings.
2. Save snippets/bookmarks normally while browsing.
3. Trigger summary generation:
   - Scheduled: service worker alarm runs at configured cadence/time.
   - Instant: user clicks snippet-level or bulk "AI Summary".
4. ZeroPin builds payload folder-by-folder and sends it to the user's BYOK model.
5. User reads results in "Summary Runs", can listen via local device voice playback, and can download each run as `.txt`.

### What ZeroPin Sends to the AI

- User context: role, profile description, intended use.
- Run metadata: generated timestamp, timezone, frequency/style, input budget, output reserve.
- Folder payload: folder id/name with snippets in latest-first order.
- Snippet fields: id, title, URL, created timestamp, snippet text, notes, tags, favorite flag.
- Optional enrichment field: page excerpt from URL content (when available).
- Skipped URL list: passed for context/transparency.

### URL Enrichment Pipeline (V2 default for BYOK summaries)

For each folder:
- Uses unique snippet URLs, latest-first
- Enriches up to `summaryMaxUrlsPerFolder` (default `15`)
- Fetch timeout is 12s per attempt
- Retries after failure: 2 retries after initial attempt (`0ms`, `600ms`, `1600ms`)
- Only `text/html` responses are parsed
- Extracts text and attaches a focused excerpt near snippet/notes keywords

Known limitations:
- Cross-origin/blocked fetches are skipped
- JS-heavy pages may extract little/no content and may be skipped
- Logged-in or protected pages may return auth errors and be skipped

### Input Budget and Trimming Logic

To avoid provider input overflow:
- Prompt size is estimated (`~ chars / 4`)
- If over budget:
  1. Remove URL excerpts first (oldest snippets first)
  2. Remove oldest snippets until within budget

This keeps recent/high-signal snippets prioritized.

### Style-Based Output Length Limits

To keep summaries readable and predictable, ZeroPin applies style-based character targets and hard caps:
- `concise`: target `4,000–6,000`, hard cap `8,000`
- `balanced`: target `8,000–10,000`, hard cap `12,000`
- `detailed`: target `10,000–12,000`, hard cap `15,000`

If a provider response exceeds the style hard cap, ZeroPin truncates it before storing/displaying.

### Audio Narration Cleanup (No AI)

Summary audio uses local on-demand text cleanup before `chrome.tts`:
- strips markdown/list symbols and snippet-id artifacts
- removes raw URLs and noisy formatting
- normalizes punctuation for smoother speech
- applies an audio-specific narration cap for listenability

The cleaned narration text is generated at playback time and is not stored separately.

### Scheduled vs Instant Logic

- Scheduled runs select all `SNIPPET` bookmarks saved in the cadence window:
  - `daily` = last 1 day
  - `weekly` = last 7 days
  - `biweekly` = last 14 days
  - Output is one run with folder-by-folder summary sections.
- Instant runs (single/bulk) use only selected snippet IDs and apply the same enrichment, budget, and provider pipeline.

### Cost and Ownership Model

- ZeroPin does not broker model calls for summaries.
- Requests go directly to the user's configured provider with their API key.
- Provider usage/cost is owned by the user account tied to that key.

## Tech Stack

- **Runtime**: Chrome Extension Manifest V3
- **Framework**: React 19 + TypeScript (strict mode)
- **Styling**: Tailwind CSS v4, shadcn/ui (New York), Radix UI primitives
- **Icons**: lucide-react + custom BrandIcon SVG
- **DnD**: @atlaskit/pragmatic-drag-and-drop
- **Build**: Vite 7 (multi-entry: popup, library, walkthrough, background, contentScript)
- **Testing**: Vitest + jsdom (406 tests across 12 suites)
- **Storage**: chrome.storage.local with schema migrations (v0–v10)

## Getting Started

```bash
npm install
npm run build
```

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist/` folder

## Development

```bash
npm run dev       # Vite dev server (for UI development)
npm run build     # TypeScript check + production build
npm run lint      # ESLint
npm test          # Run all tests (406)
```

## Project Structure

```
src/
  main.tsx              # Popup entry point
  library.tsx           # Library page entry point
  walkthrough.tsx       # Walkthrough page entry point
  background.ts         # Service worker (context menus, commands, reminders)
  contentScript.ts      # Content script (selection, AI detection, highlighting)
  app/
    BrandIcon.tsx       # ZeroPin brand icon SVG component
    Toast.tsx           # Toast notification provider
    theme.ts            # Dark mode hook + ThemeContext
    hooks/
      useFilterPipeline.ts  # Derived filter state: search, tags, dashboard KPIs
      useBookmarkOps.ts     # Bookmark CRUD + drag-and-drop handlers
      useFolderOps.ts       # Folder CRUD handlers
      useLibraryState.ts    # chrome.storage state + prefs loading
    pages/
      Library.tsx       # Full library manager
      Walkthrough.tsx   # Interactive onboarding demo
  core/
    types.ts            # Bookmark, Folder, TagDef, LibraryState types
    constants.ts        # AI chat domain set (shared across content script + library)
    anchor.ts           # Text-quote anchoring for snippet highlights
    youtube.ts          # YouTube URL utilities and capture types
    aiTags.ts           # Heuristic + Gemini Nano tag suggestions
    summaries.ts        # BYOK summary pipeline, enrichment, scheduling helpers
    storage/
      chromeApi.ts      # Shared chrome.storage.local primitives
      local.ts          # CRUD operations + atomic write queue
      migrate.ts        # Schema migration framework (v0–v10)
      prefs.ts          # User preferences (theme, reminders, AI tags)
      importBrowser.ts  # Browser bookmark HTML parser (Chrome/Firefox/Safari/Edge)
  components/ui/        # shadcn/ui components
public/
  manifest.json         # Chrome extension manifest (MV3)
  icons/                # Extension icons (SVG source + PNGs)
scripts/
  generate-icons.mjs    # PNG generation from SVG source
```

## Future Roadmap

Features under consideration for future releases:

- **Annotations** — highlight specific passages within a saved snippet text using colour-coded ranges (yellow/green/pink/blue) with optional inline notes. Stored as character-offset ranges on the bookmark; rendered as coloured spans in the card.
- **Research Sessions** — a lightweight second organisational layer. Start a named session from the popup; all subsequent saves are tagged to it. Sessions appear as a collapsible panel in the library and auto-close after a period of inactivity.
- **Smart Collections** — saved filter presets that behave as dynamic folders. Define rules (tag = X AND domain = Y, isFavorite, date range); the collection shows a live matching count and filters the list when selected.

## Icon Generation

```bash
node scripts/generate-icons.mjs
```

Renders `scripts/icon.svg` to PNG at 16, 32, 48, and 128px into `public/icons/`.
