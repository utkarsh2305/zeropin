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
- Folder hierarchy with collapsible tree and drag-and-drop reordering
- Search across name, URL, domain, snippet text, and notes
- Source filter: All / Web / AI Answers / AI Prompts (with domain-based fallback)
- Page grouping by URL with collapsible groups
- Inline rename, notes, bulk select, bulk move/delete
- Export/import library as JSON

**Popup**
- Compact toolbar popup with search, recent pins, and current folder shortcut
- Quick access to full Library

**Theme**
- Auto-detects system dark/light mode
- Manual override cycling: System > Dark > Light
- Persisted preference with migration from legacy format

## Tech Stack

- **Runtime**: Chrome Extension Manifest V3
- **Framework**: React 19 + TypeScript (strict mode)
- **Styling**: Tailwind CSS v4, shadcn/ui (New York), Radix UI primitives
- **Icons**: lucide-react + custom BrandIcon SVG
- **DnD**: @atlaskit/pragmatic-drag-and-drop
- **Build**: Vite 7 (multi-entry: popup, library, walkthrough, background, contentScript)
- **Testing**: Vitest + jsdom (136 tests)
- **Storage**: chrome.storage.local with schema migrations (v0-v5)

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
npm test          # Run all tests
```

## Project Structure

```
src/
  main.tsx              # Popup entry point
  library.tsx           # Library page entry point
  walkthrough.tsx       # Walkthrough page entry point
  background.ts         # Service worker (context menus, commands)
  contentScript.ts      # Content script (selection, AI detection, highlighting)
  app/
    BrandIcon.tsx       # ZeroPin brand icon SVG component
    Toast.tsx           # Toast notification provider
    theme.ts            # Dark mode hook + ThemeContext
    pages/
      Library.tsx       # Full library manager
      Walkthrough.tsx   # Interactive onboarding demo
  core/
    types.ts            # Bookmark, Folder, LibraryState types
    anchor.ts           # Text-quote anchoring for snippet highlights
    youtube.ts          # YouTube URL utilities and capture types
    storage/
      local.ts          # CRUD operations on chrome.storage.local
      migrate.ts        # Schema migration framework
  components/ui/        # shadcn/ui components
public/
  manifest.json         # Chrome extension manifest
  icons/                # Extension icons (SVG source + PNGs)
scripts/
  generate-icons.mjs    # PNG generation from SVG source
```

## Icon Generation

```bash
node scripts/generate-icons.mjs
```

Renders `scripts/icon.svg` to PNG at 16, 32, 48, and 128px into `public/icons/`.
