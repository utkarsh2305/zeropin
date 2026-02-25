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
- Multi-folder search scope — folder scope picker next to the search bar; select one or more folders to constrain results, rendered as a tree with 5 px per depth level
- Multi-tag intersection filtering — bookmark must match **all** selected tags to appear
- Sidebar tag narrowing — tag list automatically collapses to only tags present in the current result set, accounting for active search query, dashboard filter, and tag filters
- Page grouping by URL with collapsible groups
- Favourites — heart button on each card; dedicated chip on the health dashboard
- Notes per bookmark; notes chip on the health dashboard filters to bookmarks with saved notes
- Dead link detection — on-demand scan with progress indicator; chip filters to broken URLs
- Reminders with specific time — reminder picker includes a time input; quick presets default to 09:00; due reminders surfaced in the Reminders panel and popup badge
- Inline rename for bookmarks and folders (no modal dialog)
- Bulk select with bulk move, delete, and tag add/remove
- Date range filter
- Keyboard shortcuts: ↑ ↓ navigate · Enter open · E rename · Delete remove · ? shortcuts panel
- Export/import library as JSON; import from browser bookmark HTML files (Chrome, Firefox, Safari, Edge)

**Popup**
- Compact toolbar popup with search and current folder shortcut
- Quick access to full Library
- Reminder badge when due reminders exist; due reminders listed inline

**Theme**
- Auto-detects system dark/light mode
- Manual override cycling: System → Dark → Light
- Persisted preference with migration from legacy format

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

## Icon Generation

```bash
node scripts/generate-icons.mjs
```

Renders `scripts/icon.svg` to PNG at 16, 32, 48, and 128px into `public/icons/`.
