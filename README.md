# ZeroPin

A Chrome extension to save and organize web bookmarks locally, with support for snippet bookmarks that capture selected text and can highlight it when revisited.

## Features

- Save full pages or text snippets from any webpage
- Snippet bookmarks highlight the saved text when reopened
- Organize bookmarks into folders with drag-and-drop
- Search, rename, and add notes to bookmarks
- Export/import your library as JSON
- Dark mode

## Development

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension in Chrome.

## Icon Generation

```bash
node scripts/generate-icons.mjs
```

Reads `scripts/icon.svg` and outputs PNGs at 16, 32, 48, 128 sizes to `public/icons/`.
