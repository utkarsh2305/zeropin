import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { getState, recordBookmarkOpen } from "./core/storage/local";
import { ThemeContext, useDarkMode } from "./app/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sun, Moon, Monitor, ExternalLink, Library, Folder, Search } from "lucide-react";
import { BrandIcon } from "./app/BrandIcon";
import type { Bookmark, LibraryState } from "./core/types";
import "./app.css";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function Popup() {
  const themeValue = useDarkMode();
  const { preference, toggle } = themeValue;
  const [state, setState] = useState<LibraryState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    getState().then(setState);
  }, []);

  // Derived values
  const allBookmarks = state ? Object.values(state.bookmarks) : [];
  const pinCount = allBookmarks.length;
  const folderCount = state ? Object.keys(state.folders).length : 0;

  const q = searchQuery.trim().toLowerCase();
  const isSearching = q.length > 0;
  const searchResults = isSearching
    ? allBookmarks
        .filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            b.url.toLowerCase().includes(q) ||
            b.domain.toLowerCase().includes(q) ||
            (b.snippet?.text ?? "").toLowerCase().includes(q) ||
            (b.notes ?? "").toLowerCase().includes(q)
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8)
    : [];
  const recentPins = [...allBookmarks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const displayList = isSearching ? searchResults : recentPins;

  // Current folder
  const currentFolder = state
    ? state.folders[state.lastUsedFolderId ?? ""] ??
      state.folders[state.inboxFolderId] ??
      state.folders[state.rootFolderId]
    : null;

  const openPin = (b: Bookmark) => {
    recordBookmarkOpen(b.id);
    if (b.type === "SNIPPET" && b.snippet) {
      chrome.tabs.create({ url: b.url }, (newTab) => {
        if (!newTab?.id) return;
        chrome.storage.local.set({
          ZP_HIGHLIGHT_REQUEST: {
            tabId: newTab.id,
            url: b.url,
            anchor: b.snippet,
            bookmarkId: b.id,
            timestamp: Date.now(),
          },
        });
      });
    } else {
      chrome.tabs.create({ url: b.url });
    }
  };

  const openCurrentFolder = () => {
    const folderId = currentFolder?.id ?? "";
    chrome.tabs.create({
      url: chrome.runtime.getURL(`library.html?folder=${folderId}`),
    });
  };

  const openLibrary = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
  };

  const themeIcon =
    preference === "system" ? <Monitor size={14} /> : preference === "dark" ? <Moon size={14} /> : <Sun size={14} />;
  const themeLabel =
    preference === "system" ? "System theme" : preference === "dark" ? "Dark mode" : "Light mode";

  // Loading skeleton
  if (!state) {
    return (
      <ThemeContext.Provider value={themeValue}>
        <TooltipProvider>
          <div className="w-100 bg-background text-foreground">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <BrandIcon size={18} />
                <span className="text-base font-semibold">ZeroPin</span>
              </div>
            </div>
            <div className="px-3 py-3 space-y-3">
              <div className="h-8 bg-muted/50 rounded-md animate-pulse" />
              <div className="h-6 bg-muted/50 rounded-md animate-pulse w-3/4" />
              <div className="space-y-2">
                <div className="h-12 bg-muted/50 rounded-md animate-pulse" />
                <div className="h-12 bg-muted/50 rounded-md animate-pulse" />
                <div className="h-12 bg-muted/50 rounded-md animate-pulse" />
              </div>
            </div>
          </div>
        </TooltipProvider>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={themeValue}>
      <TooltipProvider>
        <div className="w-100 bg-background text-foreground">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <div className="flex items-center gap-2">
              <BrandIcon size={18} />
              <span className="text-base font-semibold">ZeroPin</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {pinCount} pin{pinCount !== 1 ? "s" : ""} · {folderCount} folder{folderCount !== 1 ? "s" : ""}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggle}>
                    {themeIcon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{themeLabel}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search pins…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>

          {/* Current Folder shortcut */}
          <button
            onClick={openCurrentFolder}
            className="flex items-center gap-2 w-full px-4 py-2 text-left text-sm hover:bg-accent/50 transition-colors border-b border-border"
          >
            <Folder size={14} className="text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Current Folder:</span>
            <span className="font-medium truncate">{currentFolder?.name ?? "Library"}</span>
            <ExternalLink size={12} className="ml-auto text-muted-foreground shrink-0 opacity-50" />
          </button>

          {/* Pin list */}
          <div className="px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
              {isSearching ? `Search Results (${searchResults.length})` : "Recently Pinned"}
            </div>
            {displayList.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">
                {isSearching
                  ? "No matching pins found."
                  : "No pins yet. Select text, right-click, and Pin It."}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {displayList.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => openPin(b)}
                    className="flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent/50 transition-colors w-full"
                  >
                    <img
                      src={`https://www.google.com/s2/favicons?sz=16&domain=${b.domain}`}
                      alt=""
                      className="w-4 h-4 shrink-0 rounded-sm mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm truncate">{b.name}</span>
                        {b.type === "SNIPPET" && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-auto border-snippet text-snippet shrink-0">
                            snippet
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{relativeTime(b.createdAt)}</span>
                        <span className="truncate">{b.domain}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Open Full Library */}
          <div className="px-3 py-2.5 border-t border-border">
            <Button variant="outline" className="w-full gap-2" onClick={openLibrary}>
              <Library size={14} />
              Open Full Library
              <ExternalLink size={12} className="ml-auto opacity-50" />
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </ThemeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Popup />);
